import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { OrderItem } from '../../../src/entities/order-item.entity';
import { Order } from '../../../src/entities/order.entity';
import { Product } from '../../../src/entities/product.entity';
import { Task } from '../../../src/entities/task.entity';
import { User } from '../../../src/entities/user.entity';
import { AddStockBalanceAndTasks1792100000000 } from '../../../src/migrations/1792100000000-AddStockBalanceAndTasks';
import { InitSchema1792004809791 } from '../../../src/migrations/1792004809791-InitSchema';

export type RunningPostgres = {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  connectionUri: string;
  passwordFile: string;
  stop: () => Promise<void>;
};

export async function startPostgres(): Promise<RunningPostgres> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('marketplace')
    .withUsername('marketplace')
    .withPassword('marketplace_secret')
    .start();

  try {
    return await connectMigrated(container);
  } catch (err) {
    await container.stop();
    throw err;
  }
}

async function connectMigrated(
  container: StartedPostgreSqlContainer,
): Promise<RunningPostgres> {
  const connectionUri = container.getConnectionUri();
  const passwordDir = mkdtempSync(join(tmpdir(), 'marketplace-db-'));
  const passwordFile = join(passwordDir, 'db_password');
  writeFileSync(passwordFile, container.getPassword(), 'utf8');

  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    synchronize: false,
    entities: [User, Product, Order, OrderItem, Task],
    migrations: [
      InitSchema1792004809791,
      AddStockBalanceAndTasks1792100000000,
    ],
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }

  const pool = new Pool({ connectionString: connectionUri });

  return {
    container,
    pool,
    connectionUri,
    passwordFile,
    stop: async () => {
      await pool.end();
      rmSync(passwordDir, { recursive: true, force: true });
      await container.stop();
    },
  };
}

export function applyAppDatabaseEnv(db: RunningPostgres): void {
  const user = db.container.getUsername();
  const host = db.container.getHost();
  const port = db.container.getPort();
  const database = db.container.getDatabase();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = db.connectionUri;
  process.env.DB_URL = `postgresql://${encodeURIComponent(user)}@${host}:${port}/${database}`;
  process.env.DB_PASSWORD_FILE = db.passwordFile;
}
