import { Pool } from 'pg';
import { ORDER_PLACED_EFFECTS_DDL } from './effects-ddl';
import type { OrderPlacedEvent } from './order-placed';

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
}

export async function clearEffects(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM order_placed_effects');
}

/** Insert the effect once. A repeated eventId is a no-op, not a second effect. */
export async function applyOrderPlacedEffect(
  pool: Pool,
  event: OrderPlacedEvent,
): Promise<boolean> {
  const result = await pool.query(
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
  return result.rowCount === 1;
}

export async function countEffects(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM order_placed_effects',
  );
  return Number(result.rows[0]?.n ?? 0);
}
