import type { Pool } from 'pg';
import { runConsumer, type ConsumerStats } from './broker/consumer';

export function consumeUntil(
  pool: Pool,
  stopWhen: (stats: ConsumerStats) => boolean,
): { ready: Promise<void>; consuming: Promise<ConsumerStats> } {
  let markReady!: () => void;
  let failReady!: (err: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  const consuming = runConsumer(pool, { onReady: markReady, stopWhen });
  void consuming.then(
    () => undefined,
    (err: unknown) => failReady(err),
  );
  return { ready, consuming };
}
