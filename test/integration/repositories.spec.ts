import { DatabaseError, type PoolClient } from 'pg';
import { OrderRepository } from '../../src/repositories/order.repository';
import { UserRepository } from '../../src/repositories/user.repository';
import { aProduct, aUser, anOrder } from './testkit/builders';
import { startPostgres, type RunningPostgres } from './testkit/postgres';

describe('repositories against postgres', () => {
  let db: RunningPostgres;

  beforeAll(async () => {
    db = await startPostgres();
  });

  afterAll(async () => {
    await db?.stop();
  });

  describe('UserRepository', () => {
    let client: PoolClient;
    let users: UserRepository;

    beforeEach(async () => {
      client = await db.pool.connect();
      await client.query('BEGIN');
      users = new UserRepository(client);
    });

    afterEach(async () => {
      if (!client) {
        return;
      }
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('inserts a user and finds them by email', async () => {
      const input = aUser();
      const created = await users.insert(input);

      expect(await users.findByEmail(input.email)).toEqual(created);
    });

    it('rejects a duplicate email with unique constraint 23505', async () => {
      const input = aUser();
      await users.insert(input);

      try {
        await users.insert(input);
        throw new Error('expected unique violation');
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        const dbErr = err as DatabaseError;
        expect(dbErr.code).toBe('23505');
        expect(dbErr.message).toMatch(/duplicate key value violates unique constraint/);
      }
    });

    it('updates the existing row on email conflict', async () => {
      const input = aUser({ displayName: 'Before' });
      await users.insert(input);

      const updated = await users.upsertByEmail({
        ...input,
        displayName: 'After',
        balanceCents: 10,
      });

      expect(updated.displayName).toBe('After');
      expect(updated.balanceCents).toBe(10);
      expect(await users.count()).toBe(1);
    });

    it('sees only the current transaction after earlier tests rolled back', async () => {
      await users.insert(aUser());
      expect(await users.count()).toBe(1);
    });
  });

  describe('OrderRepository', () => {
    let client: PoolClient;
    let users: UserRepository;
    let orders: OrderRepository;

    beforeEach(async () => {
      client = await db.pool.connect();
      await client.query('BEGIN');
      users = new UserRepository(client);
      orders = new OrderRepository(client);
    });

    afterEach(async () => {
      if (!client) {
        return;
      }
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('loads an order with its items through a JOIN', async () => {
      const seller = await users.insert(aUser());
      const buyer = await users.insert(aUser());
      const product = await orders.insertProduct({
        ...aProduct(),
        sellerId: seller.id,
      });
      const created = await orders.insert({
        ...anOrder({ totalCents: 3000 }),
        userId: buyer.id,
        items: [{ productId: product.id, qty: 2, unitPriceCents: 1500 }],
      });

      await expect(orders.findByIdWithItems(created.id)).resolves.toEqual({
        id: created.id,
        status: 'paid',
        totalCents: 3000,
        items: [{ productId: product.id, qty: 2, unitPriceCents: 1500 }],
      });
    });

    it('rejects an order that violates the user foreign key', async () => {
      try {
        await orders.insert({
          ...anOrder({ status: 'pending', totalCents: 100 }),
          userId: '999999999',
          items: [],
        });
        throw new Error('expected foreign key violation');
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        const dbErr = err as DatabaseError;
        expect(dbErr.code).toBe('23503');
        expect(dbErr.message).toMatch(/foreign key constraint/);
      }
    });

    it('aggregates paid revenue with SUM over a JOIN', async () => {
      const seller = await users.insert(aUser());
      const buyer = await users.insert(aUser());
      const product = await orders.insertProduct({
        ...aProduct({ priceCents: 2000 }),
        sellerId: seller.id,
      });
      await orders.insert({
        userId: buyer.id,
        status: 'paid',
        totalCents: 4000,
        items: [{ productId: product.id, qty: 2, unitPriceCents: 2000 }],
      });
      await orders.insert({
        userId: buyer.id,
        status: 'cancelled',
        totalCents: 2000,
        items: [{ productId: product.id, qty: 1, unitPriceCents: 2000 }],
      });

      await expect(orders.revenueBySeller()).resolves.toEqual([
        { sellerId: seller.id, revenueCents: 4000 },
      ]);
    });
  });
});
