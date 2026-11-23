import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = (await scryptAsync(
    password,
    Buffer.from(salt, 'base64url'),
    KEY_LEN,
  )) as Buffer;
  const expected = Buffer.from(hash, 'base64url');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
