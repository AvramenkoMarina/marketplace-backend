import { createHash } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ASSET_CACHE_CONTROL } from './constants';

/** `app.css` + bytes → `assets/app.<sha256-8>.css`. The URL changes when the bytes do. */
export function hashedAssetKey(logicalName: string, body: Buffer): string {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8);
  const slash = logicalName.lastIndexOf('/');
  const baseName = slash >= 0 ? logicalName.slice(slash + 1) : logicalName;
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  const safeStem = stem.replace(/[^A-Za-z0-9_-]/g, '') || 'asset';
  return `assets/${safeStem}.${hash}${ext}`;
}

export async function publishAsset(
  client: S3Client,
  bucket: string,
  logicalName: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const key = hashedAssetKey(logicalName, body);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: ASSET_CACHE_CONTROL,
    }),
  );
  return key;
}
