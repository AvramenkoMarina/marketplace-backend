import type { Queryable } from './queryable';

export type NewUser = {
  email: string;
  displayName: string;
  balanceCents: number;
};

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  balanceCents: number;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  balance_cents: number;
};

function mapUser(row: UserRow): UserRecord {
  return {
    id: String(row.id),
    email: row.email,
    displayName: row.display_name,
    balanceCents: Number(row.balance_cents),
  };
}

export class UserRepository {
  constructor(private readonly db: Queryable) {}

  async insert(user: NewUser): Promise<UserRecord> {
    const result = await this.db.query<UserRow>(
      `INSERT INTO users (email, display_name, balance_cents)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, balance_cents`,
      [user.email, user.displayName, user.balanceCents],
    );
    return mapUser(result.rows[0]);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.db.query<UserRow>(
      `SELECT id, email, display_name, balance_cents
       FROM users
       WHERE email = $1`,
      [email],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async upsertByEmail(user: NewUser): Promise<UserRecord> {
    const result = await this.db.query<UserRow>(
      `INSERT INTO users (email, display_name, balance_cents)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           balance_cents = EXCLUDED.balance_cents
       RETURNING id, email, display_name, balance_cents`,
      [user.email, user.displayName, user.balanceCents],
    );
    return mapUser(result.rows[0]);
  }

  async insertIgnoreConflict(user: NewUser): Promise<void> {
    await this.db.query(
      `INSERT INTO users (email, display_name, balance_cents)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [user.email, user.displayName, user.balanceCents],
    );
  }

  async count(): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM users`,
    );
    return Number(result.rows[0].count);
  }
}
