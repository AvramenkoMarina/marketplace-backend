/**
 * Avatar form: the user picks a file and submits within a couple of minutes.
 * A presigned URL cannot be revoked (no jti, no denylist), so the lifetime is
 * the only limit that still works. Two minutes covers the submit and one retry.
 * Seven days is the SigV4 ceiling, not a product decision: the URL is the
 * credential, and a line in an access log would keep write access for a week.
 */
export const PRESIGN_TTL_SECONDS = 120;

/** S3 rejects CompleteMultipartUpload above this many parts. */
export const S3_MAX_PARTS = 10_000;

/**
 * Every part except the last must be at least this big.
 * A smaller part makes CompleteMultipartUpload return EntityTooSmall.
 */
export const S3_MIN_PART_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/gzip': 'gz',
  'application/octet-stream': 'bin',
};

export function extensionFor(contentType: string): string | null {
  return EXTENSION_BY_TYPE[contentType] ?? null;
}

/**
 * Part size is derived from the object size. The 10_000-part cap means a part
 * is at least ceil(file / 10_000); the 5 MiB floor applies on top of that.
 * A fixed 5 MiB part would fail past 50 GiB.
 */
export function partSizeFor(fileSize: number): number {
  if (!Number.isInteger(fileSize) || fileSize <= 0) {
    throw new Error('file size must be a positive integer');
  }
  const byCap = Math.ceil(fileSize / S3_MAX_PARTS);
  return Math.max(S3_MIN_PART_BYTES, byCap);
}

/** Multipart once the object does not fit in a single minimum part. */
export function usesMultipart(fileSize: number): boolean {
  return fileSize > partSizeFor(fileSize);
}

export function partCountFor(fileSize: number): number {
  return Math.ceil(fileSize / partSizeFor(fileSize));
}

/** Public build artifacts. A year, and the name already changed if the bytes did. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
