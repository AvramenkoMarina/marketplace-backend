import type { Queryable } from './queryable';

export type OrderStatus = 'pending' | 'paid' | 'cancelled';

export type NewProduct = {
  sellerId: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
};

export type NewOrderItem = {
  productId: string;
  qty: number;
  unitPriceCents: number;
};

export type NewOrder = {
  userId: string;
  status: OrderStatus;
  totalCents: number;
  items: NewOrderItem[];
};

export type OrderWithItems = {
  id: string;
  status: OrderStatus;
  totalCents: number;
  items: NewOrderItem[];
};

export type SellerRevenue = {
  sellerId: string;
  revenueCents: number;
};

type ProductRow = { id: string };
type OrderRow = { id: string; status: OrderStatus; total_cents: number };
type JoinRow = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  product_id: string;
  qty: number;
  unit_price_cents: number;
};
type RevenueRow = { seller_id: string; revenue_cents: number };

export class OrderRepository {
  constructor(private readonly db: Queryable) {}

  async insertProduct(product: NewProduct): Promise<{ id: string }> {
    const result = await this.db.query<ProductRow>(
      `INSERT INTO products (seller_id, name, description, price_cents, stock)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        product.sellerId,
        product.name,
        product.description,
        product.priceCents,
        product.stock,
      ],
    );
    return { id: String(result.rows[0].id) };
  }

  async insertProductIfAbsent(product: NewProduct): Promise<void> {
    await this.db.query(
      `INSERT INTO products (seller_id, name, description, price_cents, stock)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM products WHERE seller_id = $1 AND name = $2
       )`,
      [
        product.sellerId,
        product.name,
        product.description,
        product.priceCents,
        product.stock,
      ],
    );
  }

  async insert(order: NewOrder): Promise<{ id: string }> {
    const created = await this.db.query<OrderRow>(
      `INSERT INTO orders (user_id, status, total_cents)
       VALUES ($1, $2, $3)
       RETURNING id, status, total_cents`,
      [order.userId, order.status, order.totalCents],
    );
    const id = String(created.rows[0].id);

    for (const item of order.items) {
      await this.db.query(
        `INSERT INTO order_items (order_id, product_id, qty, unit_price_cents)
         VALUES ($1, $2, $3, $4)`,
        [id, item.productId, item.qty, item.unitPriceCents],
      );
    }

    return { id };
  }

  async findByIdWithItems(id: string): Promise<OrderWithItems | null> {
    const result = await this.db.query<JoinRow>(
      `SELECT o.id,
              o.status,
              o.total_cents,
              oi.product_id,
              oi.qty,
              oi.unit_price_cents
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1
       ORDER BY oi.id`,
      [id],
    );
    if (result.rows.length === 0) {
      return null;
    }

    const first = result.rows[0];
    return {
      id: String(first.id),
      status: first.status,
      totalCents: Number(first.total_cents),
      items: result.rows.map((row) => ({
        productId: String(row.product_id),
        qty: Number(row.qty),
        unitPriceCents: Number(row.unit_price_cents),
      })),
    };
  }

  async revenueBySeller(): Promise<SellerRevenue[]> {
    const result = await this.db.query<RevenueRow>(
      `SELECT p.seller_id,
              SUM(oi.qty * oi.unit_price_cents)::int AS revenue_cents
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.status = 'paid'
       GROUP BY p.seller_id
       ORDER BY p.seller_id`,
    );
    return result.rows.map((row) => ({
      sellerId: String(row.seller_id),
      revenueCents: Number(row.revenue_cents),
    }));
  }
}
