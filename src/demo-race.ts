import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CheckoutRejected, checkout } from './checkout';
import { createDataSource } from './data-source';
import { queryRows } from './query-rows';

const ATTEMPTS = 50;
const STOCK = 10;
const QTY = 1;
const PRICE_CENTS = 1000;
const BALANCE_CENTS = 100_000_000;
const SELLER_EMAIL = 'race-seller@seed.marketplace';
const PRODUCT_NAME = 'race-stock-item';

async function ensureUser(
  dataSource: DataSource,
  email: string,
  displayName: string,
): Promise<string> {
  const existing = queryRows<{ id: string }>(
    await dataSource.query(`SELECT id FROM users WHERE email = $1`, [email]),
  );
  if (existing.length > 0) {
    await dataSource.query(
      `UPDATE users SET balance_cents = $2 WHERE id = $1`,
      [existing[0].id, BALANCE_CENTS],
    );
    return existing[0].id;
  }
  const inserted = queryRows<{ id: string }>(
    await dataSource.query(
      `INSERT INTO users (email, display_name, balance_cents)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email, displayName, BALANCE_CENTS],
    ),
  );
  return inserted[0].id;
}

async function ensureProduct(
  dataSource: DataSource,
  sellerId: string,
): Promise<string> {
  const existing = queryRows<{ id: string }>(
    await dataSource.query(`SELECT id FROM products WHERE name = $1`, [
      PRODUCT_NAME,
    ]),
  );
  if (existing.length > 0) {
    await dataSource.query(
      `UPDATE products SET stock = $2, price_cents = $3 WHERE id = $1`,
      [existing[0].id, STOCK, PRICE_CENTS],
    );
    return existing[0].id;
  }
  const inserted = queryRows<{ id: string }>(
    await dataSource.query(
    `INSERT INTO products (seller_id, name, description, price_cents, stock)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      sellerId,
      PRODUCT_NAME,
      'Товар для гонки: рівно 10 одиниць на складі.',
      PRICE_CENTS,
      STOCK,
    ],
  ),
  );
  return inserted[0].id;
}

async function main(): Promise<void> {
  const dataSource = createDataSource({ poolSize: ATTEMPTS + 5 });
  await dataSource.initialize();
  try {
    const sellerId = await ensureUser(
      dataSource,
      SELLER_EMAIL,
      'Race Seller',
    );
    const productId = await ensureProduct(dataSource, sellerId);
    const buyerIds: string[] = [];
    for (let i = 1; i <= ATTEMPTS; i += 1) {
      buyerIds.push(
        await ensureUser(
          dataSource,
          `race-buyer-${i}@seed.marketplace`,
          `Race Buyer ${i}`,
        ),
      );
    }

    const results = await Promise.all(
      buyerIds.map(async (buyerId) => {
        try {
          await checkout(dataSource, { buyerId, productId, qty: QTY });
          return 'ok' as const;
        } catch (err) {
          if (err instanceof CheckoutRejected && err.reason === 'stock') {
            return 'rejected' as const;
          }
          throw err;
        }
      }),
    );

    const success = results.filter((result) => result === 'ok').length;
    const stockRows: Array<{ stock: number }> = await dataSource.query(
      `SELECT stock FROM products WHERE id = $1`,
      [productId],
    );
    const negativeRows: Array<{ n: number }> = await dataSource.query(
      `SELECT count(*)::int AS n FROM products WHERE stock < 0`,
    );
    const finalStock = Number(stockRows[0].stock);
    const negative = Number(negativeRows[0].n);

    console.log(`спроб: ${ATTEMPTS}`);
    console.log(`успішних: ${success}`);
    console.log(`фінальний stock: ${finalStock}`);
    console.log(`відʼємний stock: ${negative}`);

    if (
      ATTEMPTS < 50 ||
      success !== STOCK ||
      finalStock !== 0 ||
      negative !== 0
    ) {
      throw new Error(
        `race invariant failed: attempts=${ATTEMPTS} success=${success} stock=${finalStock} negative=${negative}`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
