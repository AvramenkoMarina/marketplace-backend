import 'reflect-metadata';
import { runDemo } from './broker/run-demo';
import { assertInvariant, printMetrics } from './outbox/demo-state';
import { queryRows } from './query-rows';
import { cacheAside } from './redis/cache-aside';
import { cacheRedis, redisConfig } from './redis/clients';
import { ProductCardReader } from './redis/product-card';
import { createDataSource } from './data-source';

const WARMED = 50;
const CONCURRENT = 20;
const WARM_READS = 100;
const STAMPEDE_HOLD_MS = 200;
const SELLER_EMAIL = 'hw23-cache-seller@marketplace.test';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardKey(id: string): string {
  return `hw23:card:${id}`;
}

async function main(): Promise<void> {
  const redis = cacheRedis();
  const dataSource = createDataSource({ poolSize: 4 });
  const ids: string[] = [];
  try {
    const policy = await redisConfig(redis, 'maxmemory-policy');
    const maxmemory = Number(await redisConfig(redis, 'maxmemory'));
    const cacheLru = policy.length > 0 && policy !== 'noeviction' ? 1 : 0;
    const cacheMaxmemory = maxmemory > 0 ? 1 : 0;

    await dataSource.initialize();
    const sellerId = await ensureSeller(dataSource);
    for (let i = 0; i < WARMED; i += 1) {
      ids.push(await ensureProduct(dataSource, sellerId, i));
    }
    if (ids.length > 0) {
      await redis.del(...ids.flatMap((id) => [cardKey(id), `hw23:lock:${cardKey(id)}`]));
    }

    const reader = new ProductCardReader(dataSource);
    const ttls = new Set<number>();
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const filled = await cacheAside(redis, cardKey(id), i, () => reader.load(id));
      if (filled.storedTtl !== null) ttls.add(filled.storedTtl);
    }

    const target = ids[0];
    await redis.del(cardKey(target));
    reader.dbCalls = 0;
    await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        cacheAside(redis, cardKey(target), 0, async () => {
          const card = await reader.load(target);
          await sleep(STAMPEDE_HOLD_MS);
          return card;
        }),
      ),
    );
    const dbCalls = reader.dbCalls;

    reader.dbCalls = 0;
    for (let i = 0; i < WARM_READS; i += 1) {
      await cacheAside(redis, cardKey(target), 0, () => reader.load(target));
    }
    const dbCallsWarm = reader.dbCalls;

    const metrics = {
      'cache-lru': cacheLru,
      'cache-maxmemory': cacheMaxmemory,
      warmed: ids.length,
      'ttl-distinct': ttls.size,
      concurrent: CONCURRENT,
      'db-calls': dbCalls,
      'db-calls-warm': dbCallsWarm,
    };
    printMetrics(metrics);
    assertInvariant(
      'demo:cache',
      cacheLru === 1 &&
        cacheMaxmemory === 1 &&
        metrics.warmed >= 50 &&
        metrics['ttl-distinct'] >= 5 &&
        metrics.concurrent >= 20 &&
        metrics['db-calls'] === 1 &&
        metrics['db-calls-warm'] === 0,
      metrics,
    );
  } finally {
    if (ids.length > 0 && redis.status !== 'end') {
      await redis.del(...ids.flatMap((id) => [cardKey(id), `hw23:lock:${cardKey(id)}`])).catch(() => undefined);
    }
    redis.disconnect();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

async function ensureSeller(dataSource: ReturnType<typeof createDataSource>): Promise<string> {
  const existing = queryRows<{ id: string }>(
    await dataSource.query(`SELECT id::text AS id FROM users WHERE email = $1`, [SELLER_EMAIL]),
  );
  if (existing.length > 0) return existing[0].id;
  const inserted = queryRows<{ id: string }>(
    await dataSource.query(
      `INSERT INTO users (email, display_name, balance_cents)
       VALUES ($1, $2, 0)
       RETURNING id::text AS id`,
      [SELLER_EMAIL, 'HW-23 cache seller'],
    ),
  );
  return inserted[0].id;
}

async function ensureProduct(
  dataSource: ReturnType<typeof createDataSource>,
  sellerId: string,
  index: number,
): Promise<string> {
  const name = `hw23-cache-item-${index}`;
  const existing = queryRows<{ id: string }>(
    await dataSource.query(`SELECT id::text AS id FROM products WHERE name = $1`, [name]),
  );
  if (existing.length > 0) return existing[0].id;
  const inserted = queryRows<{ id: string }>(
    await dataSource.query(
      `INSERT INTO products (seller_id, name, description, price_cents, stock)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text AS id`,
      [sellerId, name, 'Картка товару для cache-aside демо.', 1500 + index, 20 + index],
    ),
  );
  return inserted[0].id;
}

runDemo(main);
