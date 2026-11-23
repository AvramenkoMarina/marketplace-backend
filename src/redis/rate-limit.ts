import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const SLIDE = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = 1
  if oldest[2] ~= nil then
    local waitMs = tonumber(oldest[2]) + window - now
    if waitMs > 0 then
      retry = math.ceil(waitMs / 1000)
      if retry < 1 then retry = 1 end
    end
  end
  return {0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

export type LimitDecision = {
  allowed: boolean;
  retryAfter: number;
  status: number;
};

/**
 * One sliding window, one Lua script. Two processes share the key,
 * so neither keeps a counter of its own.
 */
export class SlidingWindowLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async consume(key: string): Promise<LimitDecision> {
    const raw = (await this.redis.eval(
      SLIDE,
      1,
      key,
      Date.now(),
      this.windowMs,
      this.limit,
      `${Date.now()}-${randomUUID()}`,
    )) as [number, number];
    const allowed = Number(raw[0]) === 1;
    const retryAfter = Number(raw[1]);
    return {
      allowed,
      retryAfter: allowed ? 0 : Math.max(1, retryAfter),
      status: allowed ? 200 : 429,
    };
  }
}
