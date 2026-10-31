import type { NewOrder, NewProduct } from '../../../src/repositories/order.repository';
import type { NewUser } from '../../../src/repositories/user.repository';

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function aUser(overrides: Partial<NewUser> = {}): NewUser {
  const id = nextId('user');
  return {
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    balanceCents: 50_000,
    ...overrides,
  };
}

export function aProduct(
  overrides: Partial<Omit<NewProduct, 'sellerId'>> = {},
): Omit<NewProduct, 'sellerId'> {
  const id = nextId('product');
  return {
    name: `Product ${id}`,
    description: `Description for ${id}`,
    priceCents: 1_500,
    stock: 8,
    ...overrides,
  };
}

export function anOrder(
  overrides: Partial<Pick<NewOrder, 'status' | 'totalCents'>> = {},
): Pick<NewOrder, 'status' | 'totalCents'> {
  return {
    status: 'paid',
    totalCents: 1_500,
    ...overrides,
  };
}
