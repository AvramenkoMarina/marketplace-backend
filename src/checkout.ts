import { DataSource } from 'typeorm';
import { queryRows } from './query-rows';

export class CheckoutRejected extends Error {
  constructor(readonly reason: 'stock' | 'funds') {
    super(reason === 'stock' ? 'Not enough stock' : 'Not enough balance');
    this.name = 'CheckoutRejected';
  }
}

export type CheckoutInput = {
  buyerId: string;
  productId: string;
  qty: number;
};

/**
 * One transaction: atomic stock decrement, balance debit, order, line, queue task.
 * A rejected stock or balance check throws and rolls the whole unit back.
 */
export async function checkout(
  dataSource: DataSource,
  input: CheckoutInput,
): Promise<{ orderId: string }> {
  if (input.qty <= 0) {
    throw new Error('qty must be positive');
  }

  return dataSource.transaction(async (manager) => {
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

    return { orderId };
  });
}
