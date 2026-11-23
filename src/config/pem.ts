import {
  createHash,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';

export function pemFromBase64(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let pem: string;
  try {
    pem = Buffer.from(trimmed, 'base64').toString('utf8');
  } catch {
    return null;
  }
  if (!pem.includes('-----BEGIN') || !pem.includes('-----END')) return null;
  return pem;
}

function isP256(pem: string, kind: 'private' | 'public'): boolean {
  try {
    const key = kind === 'private' ? createPrivateKey(pem) : createPublicKey(pem);
    return (
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
    );
  } catch {
    return false;
  }
}

export function isEs256PrivateKeyPem(value: string): boolean {
  const pem = pemFromBase64(value);
  return pem !== null && isP256(pem, 'private');
}

export function isEs256PublicKeyPem(value: string): boolean {
  const pem = pemFromBase64(value);
  return pem !== null && isP256(pem, 'public');
}

export function publicKeyFingerprint(pem: string): string {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}
