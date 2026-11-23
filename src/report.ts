import 'reflect-metadata';
import { createDataSource } from './data-source';
import { OrderItem } from './entities/order-item.entity';

type RevenueRow = {
  seller_id: string;
  seller_name: string;
  revenue_cents: string;
  paid_orders: string;
};

async function main(): Promise<void> {
  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    const rows: RevenueRow[] = await dataSource
      .getRepository(OrderItem)
      .createQueryBuilder('item')
      .innerJoin('item.order', 'ord')
      .innerJoin('item.product', 'product')
      .innerJoin('product.seller', 'seller')
      .select('seller.id', 'seller_id')
      .addSelect('seller.displayName', 'seller_name')
      .addSelect('SUM(item.qty * item.unitPriceCents)', 'revenue_cents')
      .addSelect('COUNT(DISTINCT ord.id)', 'paid_orders')
      .where('ord.status = :status', { status: 'paid' })
      .groupBy('seller.id')
      .addGroupBy('seller.displayName')
      .orderBy('SUM(item.qty * item.unitPriceCents)', 'DESC')
      .getRawMany();

    console.log('seller_id\tseller_name\trevenue_cents\tpaid_orders');
    for (const row of rows) {
      console.log(
        `${row.seller_id}\t${row.seller_name}\t${row.revenue_cents}\t${row.paid_orders}`,
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
