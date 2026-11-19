import { countEffects, createEffectPool } from './broker/effect-store';
import { publishRaw } from './broker/order-placed';
import { prepareDemo } from './broker/prepare';
import { runDemo } from './broker/run-demo';
import { DLQ, peekDlqReason, queueDepths, WORK_QUEUE } from './broker/topology';
import { waitUntil } from './broker/wait';
import { consumeUntil } from './demo-consume';

const REASONS = new Set(['rejected', 'expired', 'maxlen', 'delivery_limit']);

async function main(): Promise<void> {
  const pool = createEffectPool();
  try {
    await prepareDemo(pool);
    const { ready, consuming } = consumeUntil(pool, (stats) => stats.rejected >= 1);
    await ready;
    await publishRaw(Buffer.from('not-an-order'));
    const stats = await consuming;

    await waitUntil(
      'poison in dlq',
      async () => {
        const depths = await queueDepths([WORK_QUEUE, DLQ]);
        return depths[WORK_QUEUE] === 0 && (depths[DLQ] ?? 0) >= 1;
      },
      15_000,
    );
    const reason = await peekDlqReason();
    await waitUntil(
      'dlq depth settled',
      async () => {
        const depths = await queueDepths([WORK_QUEUE, DLQ]);
        return depths[WORK_QUEUE] === 0 && depths[DLQ] === 1;
      },
      10_000,
    );

    const depths = await queueDepths([WORK_QUEUE, DLQ]);
    const effect = await countEffects(pool);
    const work = depths[WORK_QUEUE] ?? -1;
    const dlq = depths[DLQ] ?? -1;

    console.log(`rejected=${stats.rejected}`);
    console.log(`work=${work}`);
    console.log(`dlq=${dlq}`);
    console.log(`dlq-reason=${reason}`);
    console.log(`effect=${effect}`);

    if (stats.rejected !== 1 || work !== 0 || dlq !== 1 || effect !== 0 || !REASONS.has(reason)) {
      throw new Error(
        `dlq invariant failed rejected=${stats.rejected} work=${work} dlq=${dlq} dlq-reason=${reason} effect=${effect}`,
      );
    }
  } finally {
    await pool.end();
  }
}

runDemo(main);
