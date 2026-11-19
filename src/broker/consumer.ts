import type { ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import { closeQuietly, connectBroker } from './connection';
import { applyOrderPlacedEffect } from './effect-store';
import { parseOrderPlaced } from './order-placed';
import { declareTopology, WORK_QUEUE } from './topology';

/** 20 × ~10ms per INSERT stays far under the 30 minute consumer_timeout. */
export const PREFETCH = 20;

export type ConsumerStats = {
  delivered: number;
  effect: number;
  skipped: number;
  acked: number;
  rejected: number;
  redelivered: number;
};

export type ConsumerOptions = {
  /** Apply the effect, then leave the message unacked until the process dies. */
  holdAck?: boolean;
  timeoutMs?: number;
  stopWhen?: (stats: ConsumerStats) => boolean;
  onReady?: () => void;
};

export async function runConsumer(
  pool: Pool,
  options: ConsumerOptions = {},
): Promise<ConsumerStats> {
  const conn = await connectBroker();
  const channel = await conn.createChannel();
  const stats: ConsumerStats = {
    delivered: 0,
    effect: 0,
    skipped: 0,
    acked: 0,
    rejected: 0,
    redelivered: 0,
  };

  let finish: (err?: unknown) => void = (err) => {
    if (err) console.error(err instanceof Error ? err.message : err);
  };

  channel.on('error', (err: Error) => finish(err));

  try {
    await declareTopology(channel);
    await channel.prefetch(PREFETCH, false);

    const done = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = options.holdAck
        ? undefined
        : setTimeout(() => finish(new Error('consumer timed out')), options.timeoutMs ?? 20_000);

      finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      };

      let chain: Promise<void> = Promise.resolve();
      void channel
        .consume(
          WORK_QUEUE,
          (msg: ConsumeMessage | null) => {
            chain = chain
              .then(() => handleDelivery(msg))
              .catch((err: unknown) => finish(err));
          },
          { noAck: false },
        )
        .then(
          () => options.onReady?.(),
          (err: unknown) => finish(err),
        );

      async function handleDelivery(msg: ConsumeMessage | null): Promise<void> {
        if (!msg) {
          finish(new Error('broker cancelled the consumer'));
          return;
        }
        if (settled) return;

        stats.delivered += 1;
        if (msg.fields.redelivered) stats.redelivered += 1;

        const event = parseOrderPlaced(msg.content);
        if (!event) {
          channel.reject(msg, false);
          stats.rejected += 1;
        } else {
          const applied = await applyOrderPlacedEffect(pool, event);
          if (applied) stats.effect += 1;
          else stats.skipped += 1;
          if (options.holdAck) return;
          channel.ack(msg);
          stats.acked += 1;
        }

        if (options.stopWhen?.(stats)) finish();
      }
    });

    await done;
    return stats;
  } finally {
    if (!options.holdAck) {
      await closeQuietly(channel);
      await closeQuietly(conn);
    }
  }
}
