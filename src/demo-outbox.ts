import 'reflect-metadata';
import { runConsumer } from './broker/consumer';
import { createEffectPool } from './broker/effect-store';
import { runDemo } from './broker/run-demo';
import { checkout } from './checkout';
import { createDataSource } from './data-source';
import {
  assertInvariant,
  buyerOrderIds,
  countBuyerEffects,
  countBuyerOrders,
  countBuyerOutbox,
  countBuyerPublished,
  countProcessedForOrders,
  prepareWorld,
  printMetrics,
} from './outbox/demo-state';
import { relayOutbox } from './outbox/relay';

const IDEMPOTENCY_KEY = 'hw22-demo-outbox';

async function main(): Promise<void> {
  const dataSource = createDataSource({ poolSize: 4 });
  const pool = createEffectPool();
  try {
    await dataSource.initialize();
    const world = await prepareWorld(dataSource, pool, 'hw22-outbox');
    const first = await checkout(dataSource, {
      buyerId: world.buyerId,
      productId: world.productId,
      qty: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const second = await checkout(dataSource, {
      buyerId: world.buyerId,
      productId: world.productId,
      qty: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    if (first.replay || !second.replay || first.orderId !== second.orderId) {
      throw new Error('same Idempotency-Key produced two orders');
    }

    await relayOutbox(pool, { aggregateIds: [first.orderId] });
    const stats = await runConsumer(pool, {
      stopWhen: (state) => state.acked >= 1,
    });
    const orderIds = await buyerOrderIds(dataSource, world.buyerId);
    const metrics = {
      requests: 2,
      orders: await countBuyerOrders(dataSource, world.buyerId),
      outbox: await countBuyerOutbox(dataSource, world.buyerId),
      published: await countBuyerPublished(dataSource, world.buyerId),
      deliveries: stats.delivered,
      effect: await countBuyerEffects(pool, world.buyerId),
      processed: await countProcessedForOrders(pool, orderIds),
    };
    printMetrics(metrics);
    assertInvariant(
      'demo:outbox',
      metrics.requests === 2 &&
        metrics.orders === 1 &&
        metrics.outbox === 1 &&
        metrics.published === 1 &&
        metrics.deliveries === 1 &&
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
