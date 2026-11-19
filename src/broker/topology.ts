import type { Channel, GetMessage } from 'amqplib';
import { closeQuietly, connectBroker, withBroker } from './connection';
import { EVENTS_EXCHANGE, ORDER_PLACED_KEY } from './names';

export const WORK_QUEUE = 'shop.order.placed';
export const DLQ = 'shop.order.placed.dlq';

const DLX_EXCHANGE = 'shop.events.dlx';
const UNROUTABLE_EXCHANGE = 'shop.unroutable';
export const UNROUTABLE_QUEUE = 'shop.unroutable';

const DEATH_REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit'] as const;
export type DeathReason = (typeof DEATH_REASONS)[number];

/** Consumer-side topology: exchange, binding, quorum queue, and a separate DLQ. */
export async function declareTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(UNROUTABLE_EXCHANGE, 'fanout', { durable: true });
  await channel.assertQueue(UNROUTABLE_QUEUE, {
    durable: true,
    arguments: quorumArgs(),
  });
  await channel.bindQueue(UNROUTABLE_QUEUE, UNROUTABLE_EXCHANGE, '');

  await channel.assertExchange(DLX_EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(DLQ, {
    durable: true,
    arguments: quorumArgs(),
  });
  await channel.bindQueue(DLQ, DLX_EXCHANGE, '#');

  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', {
    durable: true,
    alternateExchange: UNROUTABLE_EXCHANGE,
  });
  await channel.assertQueue(WORK_QUEUE, {
    durable: true,
    arguments: {
      ...quorumArgs(),
      'x-dead-letter-exchange': DLX_EXCHANGE,
      'x-dead-letter-routing-key': ORDER_PLACED_KEY,
    },
  });
  await channel.bindQueue(WORK_QUEUE, EVENTS_EXCHANGE, ORDER_PLACED_KEY);
}

export async function resetBroker(): Promise<void> {
  for (const queue of [WORK_QUEUE, DLQ, UNROUTABLE_QUEUE]) {
    await ignoringMissing((channel) => channel.deleteQueue(queue));
  }
  for (const exchange of [EVENTS_EXCHANGE, DLX_EXCHANGE, UNROUTABLE_EXCHANGE]) {
    await ignoringMissing((channel) => channel.deleteExchange(exchange));
  }

  await withBroker(async (conn) => {
    const channel = await conn.createChannel();
    try {
      await declareTopology(channel);
      await channel.purgeQueue(WORK_QUEUE);
      await channel.purgeQueue(DLQ);
      await channel.purgeQueue(UNROUTABLE_QUEUE);
    } finally {
      await closeQuietly(channel);
    }
  });
}

export async function queueDepth(queue: string): Promise<number> {
  const depths = await queueDepths([queue]);
  return depths[queue] ?? 0;
}

export async function queueDepths(queues: readonly string[]): Promise<Record<string, number>> {
  return withBroker(async (conn) => {
    const channel = await conn.createChannel();
    try {
      const depths: Record<string, number> = {};
      for (const queue of queues) {
        const info = await channel.checkQueue(queue);
        depths[queue] = info.messageCount;
      }
      return depths;
    } finally {
      await closeQuietly(channel);
    }
  });
}

/** Read x-death / x-first-death-reason, then put the message back so the depth stays. */
export async function peekDlqReason(): Promise<DeathReason> {
  return withBroker(async (conn) => {
    const channel = await conn.createChannel();
    channel.on('error', () => undefined);
    try {
      const msg = await channel.get(DLQ, { noAck: false });
      if (!msg) throw new Error('DLQ is empty');
      const reason = readDeathReason(msg);
      channel.nack(msg, false, true);
      if (!reason) {
        throw new Error(`x-death has no known reason: ${JSON.stringify(msg.properties.headers)}`);
      }
      return reason;
    } finally {
      await closeQuietly(channel);
    }
  });
}

function readDeathReason(msg: GetMessage): DeathReason | null {
  const headers = msg.properties.headers;
  if (!headers) return null;
  const direct = asReason(headers['x-first-death-reason']);
  if (direct) return direct;
  const death = headers['x-death'] as Array<{ reason?: unknown }> | undefined;
  if (!Array.isArray(death)) return null;
  for (const entry of death) {
    const reason = asReason(entry?.reason);
    if (reason) return reason;
  }
  return null;
}

function asReason(value: unknown): DeathReason | null {
  const text = typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : null;
  if (text && (DEATH_REASONS as readonly string[]).includes(text)) {
    return text as DeathReason;
  }
  return null;
}

function quorumArgs(): Record<string, unknown> {
  return {
    'x-queue-type': 'quorum',
    'x-quorum-initial-group-size': 1,
  };
}

async function ignoringMissing(run: (channel: Channel) => Promise<unknown>): Promise<void> {
  const conn = await connectBroker();
  try {
    const channel = await conn.createChannel();
    channel.on('error', () => undefined);
    try {
      await run(channel);
    } catch {
      // 404: the queue or exchange was not declared yet.
    } finally {
      await closeQuietly(channel);
    }
  } finally {
    await closeQuietly(conn);
  }
}
