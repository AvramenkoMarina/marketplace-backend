import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type Part,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type StorageSettings = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type StorageEnv = {
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION?: string;
  STORAGE_ACCESS_KEY?: string;
  STORAGE_SECRET_KEY?: string;
  STORAGE_BUCKET?: string;
};

export function readStorageSettings(env: StorageEnv): StorageSettings {
  const accessKeyId = env.STORAGE_ACCESS_KEY?.trim() ?? '';
  const secretAccessKey = env.STORAGE_SECRET_KEY?.trim() ?? '';
  const bucket = env.STORAGE_BUCKET?.trim() ?? '';
  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY and STORAGE_BUCKET are required',
    );
  }
  const endpoint = env.STORAGE_ENDPOINT?.trim() || undefined;
  const region = env.STORAGE_REGION?.trim() || 'us-east-1';
  return { endpoint, region, accessKeyId, secretAccessKey, bucket };
}

export function createS3(settings: StorageSettings): S3Client {
  return new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: Boolean(settings.endpoint),
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    // Presign happens before the body exists. The SDK's default CRC32 is the
    // checksum of empty bytes and breaks strict S3-compatible stores.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export async function presignPut(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  expiresIn: number,
): Promise<string> {
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function presignUploadPart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn: number,
): Promise<string> {
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn },
  );
}

export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (err) {
    if (!isMissing(err) && statusOf(err) !== 403) {
      // A missing bucket on MinIO is 404. Anything else: try to create, then surface.
    }
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return;
    throw err;
  }
}

export async function createMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
): Promise<string> {
  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
  );
  if (!created.UploadId) {
    throw new Error('CreateMultipartUpload returned no upload id');
  }
  return created.UploadId;
}

export async function abortMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> {
  await client.send(
    new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
  );
}

export async function listAllParts(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<Part[]> {
  const parts: Part[] = [];
  let marker: string | undefined;
  for (;;) {
    const page = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }),
    );
    parts.push(...(page.Parts ?? []));
    if (!page.IsTruncated) break;
    marker = page.NextPartNumberMarker;
  }
  parts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
  return parts;
}

export async function completeMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  parts: Part[],
): Promise<string> {
  const done = await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          PartNumber: part.PartNumber,
          ETag: part.ETag,
        })),
      },
    }),
  );
  return done.ETag ?? '';
}

export type HeadResult = {
  status: number;
  size?: number;
  etag?: string;
  cacheControl?: string;
};

export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<HeadResult> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      status: head.$metadata.httpStatusCode ?? 200,
      size: head.ContentLength === undefined ? undefined : Number(head.ContentLength),
      etag: head.ETag,
      cacheControl: head.CacheControl,
    };
  } catch (err) {
    return { status: isMissing(err) ? 404 : statusOf(err) || 500 };
  }
}

export async function deleteObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch((err: unknown) => {
    if (!isMissing(err)) throw err;
  });
}

/** Abort every unfinished upload and delete objects under prefix. Demos start clean. */
export async function resetPrefix(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  for (;;) {
    const page = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    );
    for (const upload of page.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId) continue;
      if (prefix && !upload.Key.startsWith(prefix)) continue;
      await abortMultipart(client, bucket, upload.Key, upload.UploadId);
    }
    if (!page.IsTruncated) break;
    keyMarker = page.NextKeyMarker;
    uploadIdMarker = page.NextUploadIdMarker;
  }

  let token: string | undefined;
  for (;;) {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    const objects = (page.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects },
        }),
      );
    }
    if (!page.IsTruncated) break;
    token = page.NextContinuationToken;
  }
}

export function tamperObjectKey(presigned: string): string {
  const url = new URL(presigned);
  const segments = url.pathname.split('/');
  const last = segments.length - 1;
  segments[last] = `tampered-${segments[last]}`;
  url.pathname = segments.join('/');
  return url.toString();
}

export function isMissing(err: unknown): boolean {
  const name = (err as { name?: string }).name ?? '';
  if (name === 'NotFound' || name === 'NoSuchKey' || name === 'NoSuchBucket') return true;
  return statusOf(err) === 404;
}

function statusOf(err: unknown): number {
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return typeof status === 'number' ? status : 0;
}
