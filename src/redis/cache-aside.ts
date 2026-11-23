import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const TTL_BASE_SEC = 300;
const TTL_SPREAD_SEC = 60;
const LOCK_MS = 3_000;
const POLL_MS = 20;

const UNLOCK = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export type Cached<T> = {
  value: T;
  storedTtl: number | null;
};

export function jitteredTtl(salt: number): number {
  return TTL_BASE_SEC + (Math.abs(salt) % (TTL_SPREAD_SEC + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCache<T>(redis: Redis, key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

async function writeCache(redis: Redis, key: string, value: unknown, ttlSec: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch {
    // A full cache must not fail the request. The caller already has the value.
  }
}

async function unlock(redis: Redis, lockKey: string, token: string): Promise<void> {
  await redis.eval(UNLOCK, 1, lockKey, token);
}

async function loadAndStore<T>(
  redis: Redis,
  key: string,
  salt: number,
  load: () => Promise<T>,
): Promise<Cached<T>> {
  const value = await load();
  const storedTtl = jitteredTtl(salt);
  await writeCache(redis, key, value, storedTtl);
  return { value, storedTtl };
}

/**
 * Cache-aside with a single-flight lock. Waiters re-read the cache.
 * The lock is released only when the token still matches, so a late
 * owner cannot delete a lock that already belongs to someone else.
 * If the lock expires before the value is written, the next caller
 * loads the database again. That second read is the accepted failure mode.
 */
export async function cacheAside<T>(
  redis: Redis,
  key: string,
  salt: number,
  load: () => Promise<T>,
): Promise<Cached<T>> {
  const cached = await readCache<T>(redis, key);
  if (cached) return { value: cached, storedTtl: null };

  const token = randomUUID();
  const lockKey = `hw23:lock:${key}`;
  const acquired = await redis.set(lockKey, token, 'PX', LOCK_MS, 'NX');
  if (acquired === 'OK') {
    try {
      const again = await readCache<T>(redis, key);
      if (again) return { value: again, storedTtl: null };
      return await loadAndStore(redis, key, salt, load);
    } finally {
      await unlock(redis, lockKey, token);
    }
  }

  const deadline = Date.now() + LOCK_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const waited = await readCache<T>(redis, key);
    if (waited) return { value: waited, storedTtl: null };
  }

  return loadAndStore(redis, key, salt, load);
}
