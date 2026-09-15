import { Injectable, NotFoundException } from '@nestjs/common';
import {
  bodyHash,
  paginate,
  publicOrder,
  publicProduct,
  type Order,
  type Product,
} from './marketplace.util';

@Injectable()
export class MarketplaceService {
  private readonly products = new Map<string, Product>([
    ['1', { id: '1', name: 'Notebook', price_cents: 129900, createdAt: '2026-01-01T10:00:01.000Z' }],
    ['2', { id: '2', name: 'USB-C Cable', price_cents: 1599, createdAt: '2026-01-01T10:00:02.000Z' }],
    ['3', { id: '3', name: 'Wireless Mouse', price_cents: 2499, createdAt: '2026-01-01T10:00:03.000Z' }],
    ['4', { id: '4', name: 'HDMI Adapter', price_cents: 1899, createdAt: '2026-01-01T10:00:04.000Z' }],
    ['5', { id: '5', name: 'Laptop Stand', price_cents: 4599, createdAt: '2026-01-01T10:00:05.000Z' }],
  ]);

  private readonly orders = new Map<string, Order>();
  private readonly idempotencyStore = new Map<
    string,
    { bodyHash: string; status: number; headers: Record<string, string>; body: unknown }
  >();
  private nextOrderId = 1;

  listProducts(limit: number, cursor?: string) {
    return paginate([...this.products.values()], limit, cursor, publicProduct);
  }

  getProduct(id: string) {
    const product = this.products.get(id);
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return publicProduct(product);
  }

  listOrders(limit: number, cursor?: string) {
    return paginate([...this.orders.values()], limit, cursor, publicOrder);
  }

  getOrder(id: string) {
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return publicOrder(order);
  }

  createOrder(
    key: string,
    body: { items: { product_id: string; qty: number }[] },
  ): {
    status: number;
    headers: Record<string, string>;
    body: ReturnType<typeof publicOrder>;
    replay: boolean;
  } {
    const hash = bodyHash(body);
    const cached = this.idempotencyStore.get(key);

    if (cached) {
      if (cached.bodyHash !== hash) {
        const err = new Error(
          'Idempotency-Key was reused with a different request body',
        ) as Error & { status?: number; title?: string };
        err.status = 422;
        err.title = 'Unprocessable Entity';
        throw err;
      }
      return {
        status: cached.status,
        headers: {
          ...cached.headers,
          'Idempotency-Replay': 'true',
        },
        body: cached.body as ReturnType<typeof publicOrder>,
        replay: true,
      };
    }

    const lineItems: Order['items'] = [];
    let total_cents = 0;

    for (const item of body.items) {
      const product = this.products.get(item.product_id);
      if (!product) {
        throw new NotFoundException(`Product ${item.product_id} not found`);
      }
      lineItems.push({
        product_id: product.id,
        qty: item.qty,
        unit_price_cents: product.price_cents,
      });
      total_cents += product.price_cents * item.qty;
    }

    const id = String(this.nextOrderId++);
    const order: Order = {
      id,
      items: lineItems,
      total_cents,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.orders.set(id, order);

    const location = `/orders/${id}`;
    const responseBody = publicOrder(order);
    this.idempotencyStore.set(key, {
      status: 201,
      headers: { Location: location },
      body: responseBody,
      bodyHash: hash,
    });

    return {
      status: 201,
      headers: { Location: location },
      body: responseBody,
      replay: false,
    };
  }
}
