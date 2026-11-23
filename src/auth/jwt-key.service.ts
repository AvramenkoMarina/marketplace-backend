import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import type { Env } from '../config/env.schema';
import { pemFromBase64, publicKeyFingerprint } from '../config/pem';
import {
  ACCESS_TTL_SECONDS,
  JWT_ALG,
  JWT_AUDIENCE,
  JWT_ISSUER,
  parseRole,
  type UserRole,
} from './constants';

export type AccessPrincipal = {
  sub: string;
  role: UserRole;
  jti: string;
  familyId: string;
  exp: number;
};

type KeyRing = {
  kid: string;
  fingerprint: string;
  privateKey: string;
  publicKeys: Map<string, string>;
};

@Injectable()
export class JwtKeyService implements OnModuleInit {
  private readonly logger = new Logger(JwtKeyService.name);
  private ring!: KeyRing;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.ring = loadRing(this.config);
    this.logger.log(
      `jwt signer kid=${this.ring.kid} fp=${this.ring.fingerprint}`,
    );
  }

  fingerprint(): string {
    return this.ring.fingerprint;
  }

  signAccess(input: {
    sub: string;
    role: UserRole;
    jti: string;
    familyId: string;
  }): string {
    return jwt.sign({ role: input.role, fid: input.familyId }, this.ring.privateKey, {
      algorithm: JWT_ALG,
      expiresIn: ACCESS_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: input.sub,
      jwtid: input.jti,
      keyid: this.ring.kid,
    });
  }

  verifyAccess(token: string): AccessPrincipal {
    const kid = kidOf(token);
    const key = this.ring.publicKeys.get(kid);
    if (!key) {
      throw new Error('unknown signing key');
    }
    // RFC 8725 §3.1: an explicit algorithm allowlist is the check that
    // stops algorithm confusion. The header's alg is not trusted.
    const payload = jwt.verify(token, key, {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof payload === 'string') {
      throw new Error('access token claims are incomplete');
    }
    const role = parseRole(payload.role);
    const familyId = payload.fid;
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.jti !== 'string' ||
      typeof familyId !== 'string' ||
      typeof payload.exp !== 'number' ||
      !role
    ) {
      throw new Error('access token claims are incomplete');
    }
    return {
      sub: payload.sub,
      role,
      jti: payload.jti,
      familyId,
      exp: payload.exp,
    };
  }
}

function kidOf(token: string): string {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('malformed access token');
  }
  return typeof decoded.header.kid === 'string' ? decoded.header.kid : '';
}

function loadRing(config: ConfigService<Env, true>): KeyRing {
  const kid = config.get('JWT_KID', { infer: true });
  const privateKey = requirePem(
    config.get('JWT_PRIVATE_KEY', { infer: true }),
    'JWT_PRIVATE_KEY',
  );
  const publicKey = requirePem(
    config.get('JWT_PUBLIC_KEY', { infer: true }),
    'JWT_PUBLIC_KEY',
  );
  const publicKeys = new Map<string, string>([[kid, publicKey]]);
  const previousKid = config.get('JWT_PREVIOUS_KID', { infer: true });
  const previousPublic = config.get('JWT_PREVIOUS_PUBLIC_KEY', { infer: true });
  if (previousKid || previousPublic) {
    if (!previousKid || !previousPublic) {
      throw new Error(
        'JWT_PREVIOUS_KID and JWT_PREVIOUS_PUBLIC_KEY must be set together',
      );
    }
    publicKeys.set(
      previousKid,
      requirePem(previousPublic, 'JWT_PREVIOUS_PUBLIC_KEY'),
    );
  }
  return {
    kid,
    fingerprint: publicKeyFingerprint(publicKey),
    privateKey,
    publicKeys,
  };
}

function requirePem(value: string, name: string): string {
  const pem = pemFromBase64(value);
  if (!pem) {
    throw new Error(`${name} must be a base64-encoded PEM`);
  }
  return pem;
}
