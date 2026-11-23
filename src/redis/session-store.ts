import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const TTL_SEC = 30;

export type SessionTouch = {
  found: boolean;
  ttlAfter: number;
};

function keyOf(id: string): string {
  return `hw23:session:${id}`;
}

export async function createSession(redis: Redis, userId: string): Promise<string> {
  const id = randomUUID();
  await redis.set(keyOf(id), JSON.stringify({ userId }), 'EX', TTL_SEC);
  return id;
}

/** Read the session and roll its TTL forward. A miss does not create one. */
export async function touchSession(redis: Redis, id: string): Promise<SessionTouch> {
  const key = keyOf(id);
  const value = await redis.getex(key, 'EX', TTL_SEC);
  if (value === null) {
    return { found: false, ttlAfter: -2 };
  }
  const ttlAfter = await redis.ttl(key);
  return { found: true, ttlAfter };
}

export async function sessionTtl(redis: Redis, id: string): Promise<number> {
  return redis.ttl(keyOf(id));
}

export async function sessionExists(redis: Redis, id: string): Promise<boolean> {
  return (await redis.exists(keyOf(id))) === 1;
}

export async function deleteSession(redis: Redis, id: string): Promise<void> {
  await redis.del(keyOf(id));
}
