import type { S3Client } from '@aws-sdk/client-s3';
import { abortMultipart, deleteObject } from './client';

type Row = { id: string; key: string; upload_id: string | null };

type Queryable = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

/**
 * PENDING rows older than a day are orphans: the client took a presigned URL
 * and never committed. Abort the multipart (it is billed with no object),
 * delete any stray object, then drop the row. A daily BullMQ repeatable on
 * the queue Redis from HW-23 should call this. It is not started by the API
 * process: demos must not depend on the queue being up.
 */
export async function sweepStalePending(
  db: Queryable,
  client: S3Client,
  bucket: string,
  olderThanHours = 24,
): Promise<number> {
  const found = await db.query<Row>(
    `SELECT id::text AS id, key, upload_id
     FROM files
     WHERE status = 'PENDING'
       AND created_at < now() - make_interval(hours => $1::int)`,
    [olderThanHours],
  );
  for (const row of found.rows) {
    if (row.upload_id) {
      await abortMultipart(client, bucket, row.key, row.upload_id).catch(() => undefined);
    }
    await deleteObject(client, bucket, row.key);
    await db.query(`DELETE FROM files WHERE id = $1 AND status = 'PENDING'`, [row.id]);
  }
  return found.rows.length;
}
