import type { DataSource } from 'typeorm';
import { queryRows } from '../query-rows';

export type ProductCard = {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
  soldQty: number;
  lineCount: number;
};

type CardRow = {
  id: string;
  name: string;
  price_cents: number;
  stock: number;
  sold_qty: number;
  line_count: number;
};

const CARD_SQL = `
SELECT p.id::text AS id,
       p.name,
       p.price_cents,
       p.stock,
       COALESCE(SUM(oi.qty), 0)::int AS sold_qty,
       COUNT(oi.id)::int AS line_count
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
WHERE p.id = $1
GROUP BY p.id, p.name, p.price_cents, p.stock
`;

/** Counts SQL executions of the product-card query, not cache lookups. */
export class ProductCardReader {
  dbCalls = 0;

  constructor(private readonly db: DataSource) {}

  async load(id: string): Promise<ProductCard> {
    this.dbCalls += 1;
    const rows = queryRows<CardRow>(await this.db.query(CARD_SQL, [id]));
    const row = rows[0];
    if (!row) {
      throw new Error(`product ${id} not found`);
    }
    return {
      id: row.id,
      name: row.name,
      priceCents: Number(row.price_cents),
      stock: Number(row.stock),
      soldQty: Number(row.sold_qty),
      lineCount: Number(row.line_count),
    };
  }
}
