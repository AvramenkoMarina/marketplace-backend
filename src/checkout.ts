import { DataSource } from 'typeorm';
import { toOrderPlacedEvent } from './broker/order-placed';
import { queryRows } from './query-rows';

export class CheckoutRejected extends Error {
  constructor(readonly reason: 'stock' | 'funds') {
    super(reason === 'stock' ? 'Not enough stock' : 'Not enough balance');
    this.name = 'CheckoutRejected';
  }
}

/** Thrown inside the sale transaction, after the outbox insert, so both rows roll back. */
export class CheckoutWriteFailed extends Error {
  constructor() {
    super('checkout crashed after the outbox insert');
    this.name = 'CheckoutWriteFailed';
  }
}

export type CheckoutInput = {
  buyerId: string;
  productId: string;
  qty: number;
  /** Client Idempotency-Key. Names the intent, not a hash of the body. */
  idempotencyKey?: string;
  /** Fail the open transaction after the outbox insert. */
  crashAfterOutbox?: boolean;
};

export type CheckoutResult = {
  orderId: string;
  replay: boolean;
};

/**
 * One transaction: stock, balance, order, line, task, idempotency key, and the
 * outbox row. Nothing is published here. The broker cannot roll back with us.
 */
export async function checkout(
  dataSource: DataSource,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  if (input.qty <= 0) {
    throw new Error('qty must be positive');
  }

  return dataSource.transaction(async (manager) => {
    if (input.idempotencyKey) {
      const existing = queryRows<{ order_id: string }>(
        await manager.query(
          `SELECT order_id::text AS order_id
           FROM idempotency_keys
           WHERE "key" = $1`,
          [input.idempotencyKey],
        ),
      );
      if (existing.length > 0) {
        return { orderId: existing[0].order_id, replay: true };
      }
    }

    const stockRows = queryRows<{ id: string; price_cents: number }>(
      await manager.query(
        `UPDATE products
         SET stock = stock - $1
         WHERE id = $2 AND stock >= $1
         RETURNING id, price_cents`,
        [input.qty, input.productId],
      ),
    );
    if (stockRows.length === 0) {
      throw new CheckoutRejected('stock');
    }

    const unitPrice = Number(stockRows[0].price_cents);
    const total = unitPrice * input.qty;

    const balanceRows = queryRows<{ id: string }>(
      await manager.query(
        `UPDATE users
         SET balance_cents = balance_cents - $1
         WHERE id = $2 AND balance_cents >= $1
         RETURNING id`,
        [total, input.buyerId],
      ),
    );
    if (balanceRows.length === 0) {
      throw new CheckoutRejected('funds');
    }

    const orders = queryRows<{ id: string }>(
      await manager.query(
        `INSERT INTO orders (user_id, status, total_cents)
         VALUES ($1, 'paid', $2)
         RETURNING id`,
        [input.buyerId, total],
      ),
    );
    const orderId = orders[0].id;

    await manager.query(
      `INSERT INTO order_items (order_id, product_id, qty, unit_price_cents)
       VALUES ($1, $2, $3, $4)`,
      [orderId, input.productId, input.qty, unitPrice],
    );

    await manager.query(
      `INSERT INTO tasks (order_id, kind, status, processed)
       VALUES ($1, 'order_postprocess', 'pending', 0)`,
      [orderId],
    );

    if (input.idempotencyKey) {
      const claimed = queryRows<{ key: string }>(
        await manager.query(
          `INSERT INTO idempotency_keys ("key", order_id)
           VALUES ($1, $2)
           ON CONFLICT ("key") DO NOTHING
           RETURNING "key"`,
          [input.idempotencyKey, orderId],
        ),
      );
      if (claimed.length === 0) {
        throw new Error('idempotency key was claimed by a concurrent request');
      }
    }

    const event = toOrderPlacedEvent({
      id: orderId,
      buyerId: input.buyerId,
      productId: input.productId,
      qty: input.qty,
      totalCents: total,
    });
    await manager.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      ['order', orderId, event.type, JSON.stringify(event)],
    );

    if (input.crashAfterOutbox) {
      throw new CheckoutWriteFailed();
    }

    return { orderId, replay: false };
  });
}
