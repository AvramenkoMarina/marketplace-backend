import { runDemo } from './broker/run-demo';
import { assertInvariant, printMetrics } from './outbox/demo-state';
import { durableRedis } from './redis/clients';
import {
  createSession,
  deleteSession,
  sessionExists,
  sessionTtl,
  touchSession,
} from './redis/session-store';

const REQUESTS = 3;
const PAUSE_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const writer = durableRedis();
  const reader = durableRedis();
  let sessionId = '';
  try {
    sessionId = await createSession(writer, 'hw23-buyer');
    await sleep(PAUSE_MS);
    const ttlBefore = await sessionTtl(reader, sessionId);
    const first = await touchSession(writer, sessionId);
    await touchSession(writer, sessionId);
    await touchSession(writer, sessionId);

    const metrics = {
      requests: REQUESTS,
      sessions: 1,
      'in-redis': (await sessionExists(reader, sessionId)) ? 1 : 0,
      'ttl-renewed': first.found && first.ttlAfter > ttlBefore ? 1 : 0,
    };
    printMetrics(metrics);
    assertInvariant(
      'demo:session',
      metrics.requests >= 3 &&
        metrics.sessions === 1 &&
        metrics['in-redis'] === 1 &&
        metrics['ttl-renewed'] === 1,
      metrics,
    );
  } finally {
    if (sessionId) await deleteSession(writer, sessionId).catch(() => undefined);
    writer.disconnect();
    reader.disconnect();
  }
}

runDemo(main);
