export const ACCESS_TTL_SECONDS = 10 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const JWT_ISSUER = 'marketplace-api';
export const JWT_AUDIENCE = 'marketplace-api';
export const JWT_ALG = 'ES256' as const;

export const USER_ROLES = ['buyer', 'seller', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function parseRole(value: unknown): UserRole | null {
  return typeof value === 'string' &&
    (USER_ROLES as readonly string[]).includes(value)
    ? (value as UserRole)
    : null;
}
