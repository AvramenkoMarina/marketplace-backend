import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { DatabaseService } from '../database/database.service';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  parseRole,
  type UserRole,
} from './constants';
import { JwtKeyService, type AccessPrincipal } from './jwt-key.service';
import { verifyPassword } from './password';
import { hashRefreshToken, newRefreshToken } from './token-hash';

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
};

type RefreshOutcome =
  | { kind: 'invalid' }
  | { kind: 'reuse'; familyId: string }
  | { kind: 'ok'; pair: TokenPair };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly pepper: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly keys: JwtKeyService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const found = await this.db.query<{
      id: string;
      password_hash: string | null;
      role: string;
    }>(
      `SELECT id::text AS id, password_hash, role
       FROM users
       WHERE email = $1`,
      [email],
    );
    const user = found.rows[0];
    const role = parseRole(user?.role);
    const passwordOk = await verifyPassword(password, user?.password_hash ?? null);
    if (!user || !role || !passwordOk) {
      throw new UnauthorizedException();
    }
    return this.issuePair(user.id, role, randomUUID());
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = hashRefreshToken(refreshToken, this.pepper);
    const outcome = await this.db.transaction<RefreshOutcome>(async (client) => {
      const found = await client.query<{
        id: string;
        family_id: string;
        used_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
        user_id: string;
        role: string;
      }>(
        `SELECT t.id::text AS id,
                t.family_id::text AS family_id,
                t.used_at,
                t.revoked_at,
                t.expires_at,
                t.user_id::text AS user_id,
                u.role
         FROM refresh_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1
         FOR UPDATE OF t`,
        [hash],
      );
      const row = found.rows[0];
      if (!row) return { kind: 'invalid' };
      if (row.used_at) {
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = COALESCE(revoked_at, now())
           WHERE family_id = $1`,
          [row.family_id],
        );
        return { kind: 'reuse', familyId: row.family_id };
      }
      if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        return { kind: 'invalid' };
      }
      const role = parseRole(row.role);
      if (!role) return { kind: 'invalid' };
      await client.query(
        `UPDATE refresh_tokens SET used_at = now() WHERE id = $1`,
        [row.id],
      );
      const pair = await this.insertRefreshAndSign(
        client,
        row.user_id,
        role,
        row.family_id,
      );
      return { kind: 'ok', pair };
    });
    if (outcome.kind === 'reuse') {
      this.logger.warn(
        `refresh token reuse; family revoked family_id=${outcome.familyId} fp=${this.keys.fingerprint()}`,
      );
      throw new UnauthorizedException();
    }
    if (outcome.kind === 'invalid') {
      throw new UnauthorizedException();
    }
    return outcome.pair;
  }

  async logout(
    principal: AccessPrincipal,
    refreshToken: string | undefined,
  ): Promise<void> {
    const refreshHash = refreshToken
      ? hashRefreshToken(refreshToken, this.pepper)
      : null;
    await this.db.transaction(async (client) => {
      let familyId = principal.familyId;
      if (refreshHash) {
        const found = await client.query<{ family_id: string }>(
          `SELECT family_id::text AS family_id
           FROM refresh_tokens
           WHERE token_hash = $1
           FOR UPDATE`,
          [refreshHash],
        );
        if (found.rows[0]) familyId = found.rows[0].family_id;
      }
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE family_id = $1`,
        [familyId],
      );
      await this.denyAccess(client, principal);
    });
  }

  async verifyAccess(token: string): Promise<AccessPrincipal> {
    let principal: AccessPrincipal;
    try {
      principal = await this.keys.verifyAccess(token);
    } catch {
      throw new UnauthorizedException();
    }
    await this.db.query(`DELETE FROM access_denylist WHERE expires_at <= now()`);
    const denied = await this.db.query(
      `SELECT 1 FROM access_denylist WHERE jti = $1 AND expires_at > now()`,
      [principal.jti],
    );
    if ((denied.rowCount ?? 0) > 0) {
      throw new UnauthorizedException();
    }
    return principal;
  }

  private async issuePair(
    userId: string,
    role: UserRole,
    familyId: string,
  ): Promise<TokenPair> {
    return this.db.transaction((client) =>
      this.insertRefreshAndSign(client, userId, role, familyId),
    );
  }

  private async insertRefreshAndSign(
    client: {
      query: (
        text: string,
        params?: unknown[],
      ) => Promise<unknown>;
    },
    userId: string,
    role: UserRole,
    familyId: string,
  ): Promise<TokenPair> {
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, familyId, hashRefreshToken(refreshToken, this.pepper), expiresAt],
    );
    const accessToken = await this.keys.signAccess({
      sub: userId,
      role,
      jti: randomUUID(),
      familyId,
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
    };
  }

  private async denyAccess(
    client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
    principal: AccessPrincipal,
  ): Promise<void> {
    const expiresAt = new Date(principal.exp * 1000);
    if (expiresAt.getTime() <= Date.now()) return;
    await client.query(`DELETE FROM access_denylist WHERE expires_at <= now()`);
    await client.query(
      `INSERT INTO access_denylist (jti, expires_at)
       VALUES ($1, $2)
       ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [principal.jti, expiresAt],
    );
  }
}
