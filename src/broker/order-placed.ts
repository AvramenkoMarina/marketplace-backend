import type { ConsumeMessage } from 'amqplib';
import { closeQuietly, connectBroker } from './connection';
import { EVENTS_EXCHANGE, ORDER_PLACED_KEY } from './names';

export type OrderPlacedData = {
  orderId: string;
  buyerId: string;
  productId: string;
  qty: number;
  totalCents: number;
};

/** Contract of order.placed. eventId is stable so a redelivery is recognizable. */
export type OrderPlacedEvent = {
  eventId: string;
  type: 'order.placed';
  occurredAt: string;
  data: OrderPlacedData;
};

export type OrderPlacedSource = {
  id: string;
  buyerId: string;
  productId: string;
  qty: number;
  totalCents: number;
  occurredAt?: string;
};

/** Public contract for one placed order. Callers pass fields, not an ORM entity. */
export function toOrderPlacedEvent(order: OrderPlacedSource): OrderPlacedEvent {
  return orderPlacedEvent({
    eventId: `order.placed:${order.id}`,
    occurredAt: order.occurredAt,
    orderId: order.id,
    buyerId: order.buyerId,
    productId: order.productId,
    qty: order.qty,
    totalCents: order.totalCents,
  });
}

export function orderPlacedEvent(input: {
  eventId: string;
  occurredAt?: string;
  orderId: string;
  buyerId: string;
  productId: string;
  qty: number;
  totalCents: number;
}): OrderPlacedEvent {
  return {
    eventId: input.eventId,
    type: 'order.placed',
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    data: {
      orderId: input.orderId,
      buyerId: input.buyerId,
      productId: input.productId,
      qty: input.qty,
      totalCents: input.totalCents,
    },
  };
}

export function parseOrderPlaced(body: Buffer): OrderPlacedEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.type !== 'order.placed') return null;
  if (!nonEmpty(value.eventId) || !nonEmpty(value.occurredAt)) return null;
  if (Number.isNaN(Date.parse(value.occurredAt))) return null;
  if (!isRecord(value.data)) return null;

  const data = value.data;
  if (!nonEmpty(data.orderId) || !nonEmpty(data.buyerId) || !nonEmpty(data.productId)) {
    return null;
  }
  if (!positiveInt(data.qty) || !nonNegativeInt(data.totalCents)) return null;

  return {
    eventId: value.eventId,
    type: 'order.placed',
    occurredAt: value.occurredAt,
    data: {
      orderId: data.orderId,
      buyerId: data.buyerId,
      productId: data.productId,
      qty: data.qty,
      totalCents: data.totalCents,
    },
  };
}

/**
 * Confirm-channel publish into the topic exchange.
 * The publisher does not declare queues: a missing binding is the consumer's concern.
 * mandatory plus the return listener fails the call when the broker hands the message back.
 */
export async function publishOrderPlaced(event: OrderPlacedEvent): Promise<void> {
  await publishConfirmed([event]);
}

export async function publishOrderPlacedEvents(events: readonly OrderPlacedEvent[]): Promise<number> {
  await publishConfirmed(events);
  return events.length;
}

export async function publishRaw(body: Buffer): Promise<void> {
  await publishConfirmed(undefined, [{ body, messageId: undefined }]);
}

async function publishConfirmed(
  events?: readonly OrderPlacedEvent[],
  raw?: { body: Buffer; messageId: string | undefined }[],
): Promise<void> {
  const frames =
    raw ??
    (events ?? []).map((event) => ({
      body: Buffer.from(JSON.stringify(event)),
      messageId: event.eventId,
    }));

  const conn = await connectBroker();
  try {
    const channel = await conn.createConfirmChannel();
    const returned: string[] = [];
    let brokerError: Error | undefined;
    channel.on('error', (err: Error) => {
      brokerError = err;
    });
    channel.on('return', (msg: ConsumeMessage) => {
      returned.push(msg.fields.routingKey || '(empty)');
    });

    for (const frame of frames) {
      const accepted = channel.publish(EVENTS_EXCHANGE, ORDER_PLACED_KEY, frame.body, {
        persistent: true,
        mandatory: true,
        contentType: 'application/json',
        type: ORDER_PLACED_KEY,
        ...(frame.messageId ? { messageId: frame.messageId } : {}),
      });
      if (!accepted) {
        await new Promise<void>((resolve) => channel.once('drain', resolve));
      }
    }

    try {
      await channel.waitForConfirms();
    } catch (err) {
      throw brokerError ?? err;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (returned.length > 0) {
      throw new Error(`unroutable publish returned by the broker: ${returned.join(',')}`);
    }
    await closeQuietly(channel);
  } finally {
    await closeQuietly(conn);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
