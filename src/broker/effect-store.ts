import { Pool, type PoolClient } from 'pg';
import { PROCESSED_MESSAGES_DDL } from '../outbox/ddl';
import { ORDER_PLACED_EFFECTS_DDL } from './effects-ddl';
import type { OrderPlacedEvent } from './order-placed';

/** Inbox consumer name for order.placed. One row per (message, consumer). */
export const ORDER_PLACED_CONSUMER = 'order.placed';

export function createEffectPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({ connectionString, max: 4 });
  }

  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME;
  const password = process.env.DB_PASSWORD;
  const port = Number(process.env.DB_PORT || 5432);
  if (!host || !user || !database || !password) {
    throw new Error(
      'DATABASE_URL or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME are required',
    );
  }

  return new Pool({ host, port, user, password, database, max: 4 });
}

export async function ensureEffectsTable(pool: Pool): Promise<void> {
  await pool.query(ORDER_PLACED_EFFECTS_DDL);
  await pool.query(PROCESSED_MESSAGES_DDL);
}

export async function clearEffects(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM order_placed_effects');
  await pool.query('DELETE FROM processed_messages');
}

/**
 * Apply the effect and mark the message in one transaction.
 * The effect insert is idempotent on event_id. The inbox insert is idempotent
 * on (message_id, consumer). A second delivery changes neither row.
 */
export async function applyOrderPlacedEffect(
  pool: Pool,
  event: OrderPlacedEvent,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const effect = await client.query(
      `INSERT INTO order_placed_effects
         (event_id, order_id, buyer_id, product_id, qty, total_cents, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.data.orderId,
        event.data.buyerId,
        event.data.productId,
        event.data.qty,
        event.data.totalCents,
        event.occurredAt,
      ],
    );
    await client.query(
      `INSERT INTO processed_messages (message_id, consumer)
       VALUES ($1, $2)
       ON CONFLICT (message_id, consumer) DO NOTHING`,
      [event.eventId, ORDER_PLACED_CONSUMER],
    );
    await client.query('COMMIT');
    return effect.rowCount === 1;
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection is already unusable.
  }
}

export async function countEffects(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM order_placed_effects',
  );
  return Number(result.rows[0]?.n ?? 0);
}
