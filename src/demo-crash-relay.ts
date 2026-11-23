import 'reflect-metadata';
import { runConsumer } from './broker/consumer';
import { createEffectPool } from './broker/effect-store';
import { runDemo } from './broker/run-demo';
import { queueDepth, WORK_QUEUE } from './broker/topology';
import { checkout } from './checkout';
import { createDataSource } from './data-source';
import {
  assertInvariant,
  buyerOrderIds,
  countBuyerEffects,
  countBuyerPublished,
  countBuyerUnpublished,
  countProcessedForOrders,
  prepareWorld,
  printMetrics,
} from './outbox/demo-state';
import { RelayCrashed, relayOutbox } from './outbox/relay';

const IDEMPOTENCY_KEY = 'hw22-crash-relay';

async function main(): Promise<void> {
  const dataSource = createDataSource({ poolSize: 4 });
  const pool = createEffectPool();
  try {
    await dataSource.initialize();
    const world = await prepareWorld(dataSource, pool, 'hw22-crash-relay');
    const placed = await checkout(dataSource, {
      buyerId: world.buyerId,
      productId: world.productId,
      qty: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    try {
      await relayOutbox(pool, {
        aggregateIds: [placed.orderId],
        crashAfterPublish: true,
      });
      throw new Error('relay returned after publish instead of crashing');
    } catch (err) {
      if (!(err instanceof RelayCrashed)) throw err;
    }

    const stillPending = await countBuyerUnpublished(dataSource, world.buyerId);
    if (stillPending !== 1) {
      throw new Error(`published_at changed across the crash, unpublished=${stillPending}`);
    }

    await relayOutbox(pool, { aggregateIds: [placed.orderId] });
    const queued = await queueDepth(WORK_QUEUE);
    if (queued < 2) {
      throw new Error(`broker has ${queued} messages after the second publish`);
    }

    const stats = await runConsumer(pool, {
      timeoutMs: 20_000,
      stopWhen: (state) => state.acked >= 2,
    });
    const orderIds = await buyerOrderIds(dataSource, world.buyerId);
    const metrics = {
      published: await countBuyerPublished(dataSource, world.buyerId),
      deliveries: stats.delivered,
      applied: stats.effect,
      effect: await countBuyerEffects(pool, world.buyerId),
      processed: await countProcessedForOrders(pool, orderIds),
    };
    printMetrics(metrics);
    assertInvariant(
      'demo:crash-relay',
      metrics.published === 1 &&
        metrics.deliveries >= 2 &&
        metrics.applied === 1 &&
        metrics.effect === 1 &&
        metrics.processed === 1,
      metrics,
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
    await pool.end();
  }
}

runDemo(main);
