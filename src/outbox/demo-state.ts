import type { Pool } from 'pg';
import type { DataSource } from 'typeorm';
import { ORDER_PLACED_CONSUMER, ensureEffectsTable } from '../broker/effect-store';
import { resetBroker } from '../broker/topology';
import { queryRows } from '../query-rows';

const STOCK = 50;
const PRICE_CENTS = 2500;
const BALANCE_CENTS = 100_000_000;

export type DemoWorld = {
  buyerId: string;
  productId: string;
};

/** Fresh buyer, product, empty outbox/effects for that buyer, empty broker. */
export async function prepareWorld(
  dataSource: DataSource,
  pool: Pool,
  tag: string,
): Promise<DemoWorld> {
  await ensureEffectsTable(pool);
  const sellerId = await ensureUser(
    dataSource,
    `${tag}-seller@demo.marketplace`,
    `${tag} seller`,
  );
  const buyerId = await ensureUser(
    dataSource,
    `${tag}-buyer@demo.marketplace`,
    `${tag} buyer`,
  );
  const productId = await ensureProduct(dataSource, sellerId, `${tag}-item`);
  await dataSource.query(`UPDATE users SET balance_cents = $2 WHERE id = $1`, [
    buyerId,
    BALANCE_CENTS,
  ]);
  await dataSource.query(
    `UPDATE products SET stock = $2, price_cents = $3 WHERE id = $1`,
    [productId, STOCK, PRICE_CENTS],
  );
  await clearBuyer(dataSource, pool, buyerId);
  await resetBroker();
  return { buyerId, productId };
}

export async function countBuyerOrders(dataSource: DataSource, buyerId: string): Promise<number> {
  return scalar(dataSource, `SELECT count(*)::int AS n FROM orders WHERE user_id = $1`, [buyerId]);
}

export async function countBuyerOutbox(dataSource: DataSource, buyerId: string): Promise<number> {
  return scalar(
    dataSource,
    `SELECT count(*)::int AS n FROM outbox WHERE payload->'data'->>'buyerId' = $1`,
    [buyerId],
  );
}

export async function countBuyerPublished(dataSource: DataSource, buyerId: string): Promise<number> {
  return scalar(
    dataSource,
    `SELECT count(*)::int AS n
     FROM outbox
     WHERE payload->'data'->>'buyerId' = $1
       AND published_at IS NOT NULL`,
    [buyerId],
  );
}

export async function countBuyerUnpublished(
  dataSource: DataSource,
  buyerId: string,
): Promise<number> {
  return scalar(
    dataSource,
    `SELECT count(*)::int AS n
     FROM outbox
     WHERE payload->'data'->>'buyerId' = $1
       AND published_at IS NULL`,
    [buyerId],
  );
}

export async function buyerOrderIds(dataSource: DataSource, buyerId: string): Promise<string[]> {
  const rows = queryRows<{ id: string }>(
    await dataSource.query(`SELECT id::text AS id FROM orders WHERE user_id = $1 ORDER BY id`, [
      buyerId,
    ]),
  );
  return rows.map((row) => row.id);
}

export async function countBuyerEffects(pool: Pool, buyerId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM order_placed_effects WHERE buyer_id = $1`,
    [buyerId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function countProcessedForOrders(pool: Pool, orderIds: readonly string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const messageIds = orderIds.map((id) => `order.placed:${id}`);
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM processed_messages
     WHERE consumer = $2
       AND message_id = ANY($1::text[])`,
    [messageIds, ORDER_PLACED_CONSUMER],
  );
  return Number(result.rows[0]?.n ?? 0);
}

export function printMetrics(metrics: Record<string, number>): void {
  for (const [key, value] of Object.entries(metrics)) {
    console.log(`${key}=${value}`);
  }
}

export function assertInvariant(
  name: string,
  ok: boolean,
  metrics: Record<string, number>,
): void {
  if (ok) return;
  const rendered = Object.entries(metrics)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  throw new Error(`${name} invariant failed: ${rendered}`);
}

async function clearBuyer(dataSource: DataSource, pool: Pool, buyerId: string): Promise<void> {
  const orderIds = await buyerOrderIds(dataSource, buyerId);
  if (orderIds.length > 0) {
    const messageIds = orderIds.map((id) => `order.placed:${id}`);
    await pool.query(
      `DELETE FROM processed_messages
       WHERE consumer = $2 AND message_id = ANY($1::text[])`,
      [messageIds, ORDER_PLACED_CONSUMER],
    );
  }
  await pool.query(`DELETE FROM order_placed_effects WHERE buyer_id = $1`, [buyerId]);
  await dataSource.query(`DELETE FROM outbox WHERE payload->'data'->>'buyerId' = $1`, [buyerId]);
  await dataSource.query(`DELETE FROM orders WHERE user_id = $1`, [buyerId]);
}

async function ensureUser(
  dataSource: DataSource,
  email: string,
  displayName: string,
): Promise<string> {
  const existing = queryRows<{ id: string }>(
    await dataSource.query(`SELECT id::text AS id FROM users WHERE email = $1`, [email]),
  );
  if (existing.length > 0) return existing[0].id;
  const inserted = queryRows<{ id: string }>(
    await dataSource.query(
      `INSERT INTO users (email, display_name, balance_cents)
       VALUES ($1, $2, $3)
       RETURNING id::text AS id`,
      [email, displayName, BALANCE_CENTS],
    ),
  );
  return inserted[0].id;
}

async function ensureProduct(
  dataSource: DataSource,
  sellerId: string,
  name: string,
): Promise<string> {
  const existing = queryRows<{ id: string }>(
    await dataSource.query(`SELECT id::text AS id FROM products WHERE name = $1`, [name]),
  );
  if (existing.length > 0) return existing[0].id;
  const inserted = queryRows<{ id: string }>(
    await dataSource.query(
      `INSERT INTO products (seller_id, name, description, price_cents, stock)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text AS id`,
      [sellerId, name, 'Товар для демо transactional outbox.', PRICE_CENTS, STOCK],
    ),
  );
  return inserted[0].id;
}

async function scalar(dataSource: DataSource, sql: string, params: unknown[]): Promise<number> {
  const rows = queryRows<{ n: number }>(await dataSource.query(sql, params));
  return Number(rows[0]?.n ?? 0);
}
