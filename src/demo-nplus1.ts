import 'reflect-metadata';
import { DataSource, In } from 'typeorm';
import { createDataSource } from './data-source';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { QueryCountLogger } from './logging/query-count.logger';

const SAMPLE_SIZES = [5, 8];

async function orderIds(dataSource: DataSource, n: number): Promise<string[]> {
  const rows: Array<{ id: string }> = await dataSource.query(
    'SELECT id FROM orders ORDER BY id ASC LIMIT $1',
    [n],
  );
  return rows.map((row) => row.id);
}

async function loadNaive(dataSource: DataSource, ids: string[]): Promise<number> {
  const orders = await dataSource.getRepository(Order).find({
    where: { id: In(ids) },
    order: { id: 'ASC' },
  });
  const products = dataSource.getRepository(Product);
  let lineCount = 0;

  for (const order of orders) {
    const rows: Array<{ product_id: string }> = await dataSource.query(
      'SELECT product_id FROM order_items WHERE order_id = $1',
      [order.id],
    );
    for (const row of rows) {
      lineCount += 1;
      await products.findOneByOrFail({ id: row.product_id });
    }
  }

  return lineCount;
}

async function loadJoined(dataSource: DataSource, n: number): Promise<number> {
  const orders = await dataSource
    .getRepository(Order)
    .createQueryBuilder('ord')
    .leftJoinAndSelect('ord.items', 'item')
    .leftJoinAndSelect('item.product', 'product')
    .where(
      'ord.id IN (SELECT id FROM orders ORDER BY id ASC LIMIT :n)',
      { n },
    )
    .orderBy('ord.id', 'ASC')
    .getMany();

  return orders.reduce((sum, order) => sum + order.items.length, 0);
}

async function loadQueryStrategy(
  dataSource: DataSource,
  ids: string[],
): Promise<number> {
  const orders = await dataSource.getRepository(Order).find({
    where: { id: In(ids) },
    relations: { items: { product: true } },
    relationLoadStrategy: 'query',
    order: { id: 'ASC' },
  });
  return orders.reduce((sum, order) => sum + order.items.length, 0);
}

async function measure(
  dataSource: DataSource,
  logger: QueryCountLogger,
  label: string,
  run: () => Promise<number>,
): Promise<number> {
  logger.reset();
  console.log(`\n=== ${label} ===`);
  const lines = await run();
  console.log(`${label}: queries=${logger.queries} lines=${lines}`);
  return logger.queries;
}

async function main(): Promise<void> {
  const logger = new QueryCountLogger();
  const dataSource = createDataSource({
    logging: ['query'],
    logger,
  });
  await dataSource.initialize();
  try {
    for (const n of SAMPLE_SIZES) {
      const ids = await orderIds(dataSource, n);
      if (ids.length < n) {
        throw new Error(
          `Need at least ${n} orders to measure N+1, found ${ids.length}. Run npm run seed.`,
        );
      }

      const naive = await measure(
        dataSource,
        logger,
        `до (наївно, N=${n})`,
        () => loadNaive(dataSource, ids),
      );
      const fixed = await measure(
        dataSource,
        logger,
        `після (leftJoinAndSelect, N=${n})`,
        () => loadJoined(dataSource, n),
      );
      const separate = await measure(
        dataSource,
        logger,
        `relationLoadStrategy=query, N=${n}`,
        () => loadQueryStrategy(dataSource, ids),
      );

      console.log(
        `summary N=${n} до=${naive} після=${fixed} queryStrategy=${separate}`,
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
