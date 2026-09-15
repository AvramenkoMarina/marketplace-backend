import { readFile } from 'node:fs/promises';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import type { Env } from '../config/env.schema';

function parseDbUrl(dbUrl: string): {
  host: string;
  port: number;
  user: string;
  database: string;
} {
  const url = new URL(dbUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    database: url.pathname.replace(/^\//, ''),
  };
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(private readonly config: ConfigService<Env, true>) {
    const passwordFile = this.config.get('DB_PASSWORD_FILE', { infer: true });
    const db = parseDbUrl(this.config.get('DB_URL', { infer: true }));

    this.pool = new Pool({
      host: db.host,
      port: db.port,
      user: db.user,
      database: db.database,
      password: async () => {
        const raw = await readFile(passwordFile, 'utf8');
        const password = raw.trim();
        if (!password) {
          throw new Error(`DB password file is empty: ${passwordFile}`);
        }
        return password;
      },
    });

    this.pool.on('error', (err) => {
      this.logger.warn(`Idle pool client error (expected after rotation): ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
      this.logger.log('Postgres pool ready');
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      const dbUrl = this.config.get('DB_URL', { infer: true });
      throw new Error(
        `Postgres is unreachable (${dbUrl}). ` +
          `Run: docker compose up -d && ensure secrets/db_password matches the DB password.\n` +
          `Cause: ${cause || 'connection failed'}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }
}
