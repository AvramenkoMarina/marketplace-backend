import { runDemo } from './broker/run-demo';
import { assertInvariant, printMetrics } from './outbox/demo-state';
import { durableRedis } from './redis/clients';
import { SlidingWindowLimiter } from './redis/rate-limit';

const LIMIT = 5;
const WINDOW_MS = 10_000;
const REQUESTS = 8;
const KEY = 'hw23:rl:demo';

async function main(): Promise<void> {
  const podA = durableRedis();
  const podB = durableRedis();
  const limiters = [
    new SlidingWindowLimiter(podA, LIMIT, WINDOW_MS),
    new SlidingWindowLimiter(podB, LIMIT, WINDOW_MS),
  ];
  try {
    await podA.del(KEY);
    const decisions = [];
    for (let i = 0; i < REQUESTS; i += 1) {
      decisions.push(await limiters[i % limiters.length].consume(KEY));
    }
    const allowed = decisions.filter((decision) => decision.allowed).length;
    const blocked = decisions.filter((decision) => !decision.allowed);
    const lastBlocked = blocked[blocked.length - 1];
    const metrics = {
      instances: limiters.length,
      limit: LIMIT,
      requests: REQUESTS,
      allowed,
      blocked: blocked.length,
      status: lastBlocked?.status ?? 200,
      'retry-after': lastBlocked && lastBlocked.retryAfter > 0 ? 1 : 0,
    };
    printMetrics(metrics);
    assertInvariant(
      'demo:ratelimit',
      metrics.instances >= 2 &&
        metrics.limit > 0 &&
        metrics.allowed === metrics.limit &&
        metrics.blocked >= 1 &&
        metrics.status === 429 &&
        metrics['retry-after'] === 1,
      metrics,
    );
  } finally {
    await podA.del(KEY).catch(() => undefined);
    podA.disconnect();
    podB.disconnect();
  }
}

runDemo(main);
