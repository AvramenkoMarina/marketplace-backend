import { PREFETCH, type ConsumerStats } from './broker/consumer';
import { countEffects, createEffectPool } from './broker/effect-store';
import { orderPlacedEvent, publishOrderPlacedEvents } from './broker/order-placed';
import { prepareDemo } from './broker/prepare';
import { runDemo } from './broker/run-demo';
import { DLQ, queueDepth, UNROUTABLE_QUEUE } from './broker/topology';
import { consumeUntil } from './demo-consume';

const PUBLISH_COUNT = 5;

async function main(): Promise<void> {
  const pool = createEffectPool();
  try {
    await prepareDemo(pool);
    const events = Array.from({ length: PUBLISH_COUNT }, (_, index) => {
      const n = index + 1;
      return orderPlacedEvent({
        eventId: `order.placed:demo-publish-${n}`,
        occurredAt: '2026-11-19T12:00:00.000Z',
        orderId: `demo-publish-${n}`,
        buyerId: 'buyer-demo',
        productId: 'product-demo',
        qty: 1,
        totalCents: 1000 + n,
      });
    });

    const { ready, consuming } = consumeUntil(
      pool,
      (stats: ConsumerStats) => stats.acked >= PUBLISH_COUNT,
    );
    await ready;
    const published = await publishOrderPlacedEvents(events);
    const stats = await consuming;
    const effect = await countEffects(pool);
    const dlq = await queueDepth(DLQ);
    const unroutable = await queueDepth(UNROUTABLE_QUEUE);

    console.log(`published=${published}`);
    console.log(`delivered=${stats.delivered}`);
    console.log(`effect=${effect}`);
    console.log(`acked=${stats.acked}`);
    console.log(`dlq=${dlq}`);
    console.log(`prefetch=${PREFETCH}`);

    if (
      published !== PUBLISH_COUNT ||
      stats.delivered !== PUBLISH_COUNT ||
      stats.effect !== PUBLISH_COUNT ||
      effect !== PUBLISH_COUNT ||
      stats.acked !== PUBLISH_COUNT ||
      stats.rejected !== 0 ||
      dlq !== 0 ||
      unroutable !== 0 ||
      PREFETCH < 1 ||
      PREFETCH > 2000
    ) {
      throw new Error(
        `publish invariant failed published=${published} delivered=${stats.delivered} memoryEffect=${stats.effect} effect=${effect} acked=${stats.acked} rejected=${stats.rejected} dlq=${dlq} unroutable=${unroutable}`,
      );
    }
  } finally {
    await pool.end();
  }
}

runDemo(main);
