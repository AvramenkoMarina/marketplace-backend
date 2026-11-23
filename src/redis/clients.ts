import Redis from 'ioredis';

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function openRedis(url: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 2 });
  redis.on('error', () => {
    // The command that failed rejects; an unhandled 'error' event would crash the process.
  });
  return redis;
}

export function cacheRedis(): Redis {
  return openRedis(requireEnv('REDIS_URL'));
}

export function durableRedis(): Redis {
  return openRedis(requireEnv('REDIS_QUEUE_URL'));
}

export async function redisConfig(redis: Redis, name: string): Promise<string> {
  const raw: unknown = await redis.config('GET', name);
  if (Array.isArray(raw)) {
    return String(raw[1] ?? '');
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (name in record) return String(record[name] ?? '');
    const first = Object.values(record)[0];
    return first === undefined ? '' : String(first);
  }
  return String(raw ?? '');
}
