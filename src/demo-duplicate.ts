import { type ChildProcess, spawn } from 'node:child_process';
import { runConsumer } from './broker/consumer';
import { countEffects, createEffectPool, ensureEffectsTable } from './broker/effect-store';
import { orderPlacedEvent, publishOrderPlaced } from './broker/order-placed';
import { prepareDemo } from './broker/prepare';
import { runDemo } from './broker/run-demo';
import { queueDepth, WORK_QUEUE } from './broker/topology';
import { delay, waitUntil } from './broker/wait';

const EVENT_ID = 'order.placed:demo-duplicate';

async function hold(): Promise<void> {
  const pool = createEffectPool();
  await ensureEffectsTable(pool);
  await runConsumer(pool, { holdAck: true });
}

async function main(): Promise<void> {
  const pool = createEffectPool();
  let child: ChildProcess | undefined;
  try {
    await prepareDemo(pool);
    await publishOrderPlaced(
      orderPlacedEvent({
        eventId: EVENT_ID,
        occurredAt: '2026-11-19T12:00:00.000Z',
        orderId: 'demo-duplicate',
        buyerId: 'buyer-demo',
        productId: 'product-demo',
        qty: 1,
        totalCents: 2500,
      }),
    );

    child = spawn(process.execPath, [process.argv[1] ?? '', '--hold'], {
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', (err) => {
      console.error(err.message);
    });

    await waitUntil('held effect', async () => (await countEffects(pool)) === 1, 20_000);
    await delay(200);
    if (!child.pid) throw new Error('consumer pid missing');
    process.kill(child.pid, 'SIGKILL');
    await exited(child);

    await waitUntil('redelivery queued', async () => (await queueDepth(WORK_QUEUE)) >= 1, 20_000);

    const second = await runConsumer(pool, {
      stopWhen: (stats) => stats.acked >= 1,
    });
    const effect = await countEffects(pool);
    const deliveries = 1 + second.delivered;
    const skipped = second.skipped;

    console.log(`deliveries=${deliveries}`);
    console.log(`effect=${effect}`);
    console.log(`skipped=${skipped}`);

    if (deliveries < 2 || effect !== 1 || skipped < 1 || second.redelivered < 1) {
      throw new Error(
        `duplicate invariant failed deliveries=${deliveries} effect=${effect} skipped=${skipped} redelivered=${second.redelivered}`,
      );
    }
  } finally {
    if (child && child.exitCode === null && !child.killed && child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // The process is already gone.
      }
    }
    await pool.end();
  }
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    setTimeout(() => reject(new Error('killed consumer did not exit')), 5_000);
  });
}

if (process.argv.includes('--hold')) {
  hold().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  runDemo(main);
}
