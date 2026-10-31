import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootApp } from '../support/boot-app';
import { startPostgres, type RunningPostgres } from '../integration/testkit/postgres';

describe('orders e2e', () => {
  let db: RunningPostgres;
  let app: INestApplication;

  beforeAll(async () => {
    db = await startPostgres();
    app = await bootApp(db);
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('creates an order and reads it back', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-happy-path')
      .send({ items: [{ product_id: '1', qty: 2 }] })
      .expect(201);

    expect(created.body).toMatchObject({
      id: expect.any(String),
      total_cents: 259800,
      status: 'pending',
      items: [{ product_id: '1', qty: 2, unit_price_cents: 129900 }],
    });

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${created.body.id as string}`)
      .expect(200);

    expect(fetched.body).toEqual(created.body);
  });

  it('returns 404 when the order does not exist', async () => {
    await request(app.getHttpServer()).get('/orders/missing-order').expect(404);
  });
});
