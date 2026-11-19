import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source';
import { queryRows } from './query-rows';
import { withRetry } from './retry';

const DELTA = 100;
const EMAIL = 'retry-counter@seed.marketplace';

async function ensureCounter(dataSource: DataSource): Promise<string> {
  const existing: Array<{ id: string }> = await dataSource.query(
    `SELECT id FROM users WHERE email = $1`,
    [EMAIL],
  );
  if (existing.length > 0) {
    await dataSource.query(
      `UPDATE users SET balance_cents = 0 WHERE id = $1`,
      [existing[0].id],
    );
    return existing[0].id;
  }
  const inserted: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO users (email, display_name, balance_cents)
     VALUES ($1, $2, 0)
     RETURNING id`,
    [EMAIL, 'Retry Counter'],
  );
  return inserted[0].id;
}

async function main(): Promise<void> {
  const dataSource = createDataSource({ poolSize: 4 });
  await dataSource.initialize();
  try {
    const userId = await ensureCounter(dataSource);
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let retries = 0;

    async function transfer(): Promise<void> {
      await withRetry(async () => {
        await dataSource.transaction('REPEATABLE READ', async (manager) => {
          const rows: Array<{ balance_cents: number }> = await manager.query(
            `SELECT balance_cents FROM users WHERE id = $1`,
            [userId],
          );
          if (arrived < 2) {
            arrived += 1;
            if (arrived === 2) {
              release();
            }
            await bothRead;
          }
          const next = Number(rows[0].balance_cents) + DELTA;
          await manager.query(
            `UPDATE users SET balance_cents = $1 WHERE id = $2`,
            [next, userId],
          );
        });
      }, (message) => {
        retries += 1;
        console.log(message);
      });
    }

    await Promise.all([transfer(), transfer()]);

    const after: Array<{ balance_cents: number }> = await dataSource.query(
      `SELECT balance_cents FROM users WHERE id = $1`,
      [userId],
    );
    const balance = Number(after[0].balance_cents);
    const expected = DELTA * 2;
    console.log(`retry-ів: ${retries}`);
    console.log(`фінальний balance_cents: ${balance}`);
    console.log(`очікувано: ${expected}`);

    if (retries < 1 || balance !== expected) {
      throw new Error(
        `retry invariant failed: retries=${retries} balance=${balance} expected=${expected}`,
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
