import { createHash } from 'node:crypto';

export type Product = {
  id: string;
  name: string;
  price_cents: number;
  createdAt: string;
};

export type OrderItem = {
  product_id: string;
  qty: number;
  unit_price_cents: number;
};

export type Order = {
  id: string;
  items: OrderItem[];
  total_cents: number;
  status: 'pending' | 'paid' | 'cancelled';
  createdAt: string;
};

export function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function encodeCursor({ createdAt, id }: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  let parsed: { createdAt?: string; id?: string } | null = null;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    typeof parsed.id !== 'string' ||
    typeof parsed.createdAt !== 'string' ||
    Number.isNaN(Date.parse(parsed.createdAt))
  ) {
    const err = new Error('cursor is not a valid opaque pagination token') as Error & {
      status?: number;
      title?: string;
    };
    err.status = 400;
    err.title = 'Bad Request';
    throw err;
  }
  return { createdAt: parsed.createdAt, id: parsed.id };
}

function compareDesc(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? 1 : -1;
  }
  return 0;
}

function isAfterCursor(
  item: { createdAt: string; id: string },
  cursor: { createdAt: string; id: string },
) {
  if (item.createdAt !== cursor.createdAt) {
    return item.createdAt < cursor.createdAt;
  }
  return item.id < cursor.id;
}

export function paginate<T extends { createdAt: string; id: string }, P>(
  list: T[],
  limit: number,
  cursor: string | undefined,
  toPublic: (item: T) => P,
): { items: P[]; next_cursor: string | null } {
  const sorted = [...list].sort(compareDesc);
  const filtered = cursor
    ? sorted.filter((item) => isAfterCursor(item, decodeCursor(cursor)))
    : sorted;
  const page = filtered.slice(0, limit);
  const next_cursor =
    filtered.length > limit
      ? encodeCursor({
          createdAt: page[page.length - 1].createdAt,
          id: page[page.length - 1].id,
        })
      : null;
  return { items: page.map(toPublic), next_cursor };
}

export function publicProduct(product: Product) {
  return {
    id: product.id,
    name: product.name,
    price_cents: product.price_cents,
  };
}

export function publicOrder(order: Order) {
  return {
    id: order.id,
    items: order.items,
    total_cents: order.total_cents,
    status: order.status,
  };
}
