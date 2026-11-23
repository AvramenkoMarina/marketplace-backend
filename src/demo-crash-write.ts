import 'reflect-metadata';
import { createEffectPool } from './broker/effect-store';
import { runDemo } from './broker/run-demo';
import { queueDepth, WORK_QUEUE } from './broker/topology';
import { CheckoutWriteFailed, checkout } from './checkout';
import { createDataSource } from './data-source';
import {
  assertInvariant,
  countBuyerEffects,
  countBuyerOrders,
  countBuyerOutbox,
  countBuyerPublished,
  prepareWorld,
  printMetrics,
} from './outbox/demo-state';

const IDEMPOTENCY_KEY = 'hw22-crash-write';

async function main(): Promise<void> {
  const dataSource = createDataSource({ poolSize: 4 });
  const pool = createEffectPool();
  try {
    await dataSource.initialize();
    const world = await prepareWorld(dataSource, pool, 'hw22-crash-write');
    let writeFailed = 0;
    try {
      await checkout(dataSource, {
        buyerId: world.buyerId,
        productId: world.productId,
        qty: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        crashAfterOutbox: true,
      });
    } catch (err) {
      if (!(err instanceof CheckoutWriteFailed)) throw err;
      writeFailed = 1;
    }

    const metrics = {
      'write-failed': writeFailed,
      orders: await countBuyerOrders(dataSource, world.buyerId),
      outbox: await countBuyerOutbox(dataSource, world.buyerId),
      published: await countBuyerPublished(dataSource, world.buyerId),
      deliveries: await queueDepth(WORK_QUEUE),
      effect: await countBuyerEffects(pool, world.buyerId),
    };
    printMetrics(metrics);
    assertInvariant(
      'demo:crash-write',
      metrics['write-failed'] === 1 &&
        metrics.orders === 0 &&
        metrics.outbox === 0 &&
        metrics.published === 0 &&
        metrics.deliveries === 0 &&
        metrics.effect === 0,
      metrics,
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
    await pool.end();
  }
}

runDemo(main);
