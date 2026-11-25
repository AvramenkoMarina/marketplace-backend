import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../config/env.schema';
import { DatabaseService } from '../database/database.service';
import {
  extensionFor,
  partCountFor,
  partSizeFor,
  PRESIGN_TTL_SECONDS,
  S3_MAX_PARTS,
  usesMultipart,
} from './constants';
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  createS3,
  ensureBucket,
  headObject,
  listAllParts,
  presignPut,
  presignUploadPart,
  readStorageSettings,
  type StorageSettings,
} from './client';

type IntentBody = {
  contentType?: unknown;
  filename?: unknown;
  size?: unknown;
};

type FileRow = {
  id: string;
  key: string;
  status: string;
  size: string | null;
  upload_id: string | null;
  content_type: string;
  idempotency_key: string | null;
};

export type PartUrl = { partNumber: number; url: string };

export type IntentResult = {
  id: string;
  key: string;
  expiresIn: number;
  mode: 'single' | 'multipart';
  url?: string;
  uploadId?: string;
  partSize?: number;
  parts?: PartUrl[];
};

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private s3?: S3Client;
  private settings?: StorageSettings;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async intent(
    userId: string,
    body: IntentBody,
    idempotencyKey: string | undefined,
  ): Promise<IntentResult> {
    const contentType = this.parseContentType(body?.contentType);
    const size = this.parseSize(body?.size);
    this.rejectFilenameAsKey(body?.filename);
    const idem = this.parseIdempotency(idempotencyKey);
    const client = this.client();
    const bucket = this.bucket();

    if (idem) {
      const existing = await this.findByIdempotency(userId, idem);
      if (existing) {
        this.assertSameIntent(existing, contentType, size);
        return this.present(existing);
      }
    }

    await ensureBucket(client, bucket);
    const ext = extensionFor(contentType);
    if (!ext) throw new BadRequestException('contentType is not allowed');
    const key = `uploads/${userId}/${randomUUID()}.${ext}`;
    const multipart = size !== undefined && usesMultipart(size);

    if (multipart) {
      const uploadId = await createMultipart(client, bucket, key, contentType);
      try {
        const row = await this.insertRow({
          key,
          userId,
          size: size ?? null,
          uploadId,
          contentType,
          idempotencyKey: idem,
        });
        this.logger.log(`intent fileId=${row.id} key=${row.key} mode=multipart`);
        return this.present(row);
      } catch (err) {
        await abortMultipart(client, bucket, key, uploadId).catch(() => undefined);
        if (idem && isUniqueViolation(err)) {
          const existing = await this.findByIdempotency(userId, idem);
          if (existing) {
            this.assertSameIntent(existing, contentType, size);
            return this.present(existing);
          }
        }
        throw err;
      }
    }

    try {
      const row = await this.insertRow({
        key,
        userId,
        size: size ?? null,
        uploadId: null,
        contentType,
        idempotencyKey: idem,
      });
      this.logger.log(`intent fileId=${row.id} key=${row.key} mode=single`);
      return this.present(row);
    } catch (err) {
      if (idem && isUniqueViolation(err)) {
        const existing = await this.findByIdempotency(userId, idem);
        if (existing) {
          this.assertSameIntent(existing, contentType, size);
          return this.present(existing);
        }
      }
      throw err;
    }
  }

  async commit(userId: string, fileId: unknown): Promise<{ id: string; key: string; size: number; status: string }> {
    const row = await this.owned(userId, fileId);
    const head = await headObject(this.client(), this.bucket(), row.key);
    if (head.status === 404) {
      throw new ConflictException('object is not in storage');
    }
    if (head.status !== 200 || head.size === undefined) {
      throw new ConflictException('object is not in storage');
    }
    if (row.size !== null && head.size !== Number(row.size)) {
      throw new ConflictException('object size does not match the intent');
    }
    await this.db.query(
      `UPDATE files SET status = 'COMPLETED', size = $2 WHERE id = $1 AND owner_id = $3`,
      [row.id, head.size, userId],
    );
    this.logger.log(`commit fileId=${row.id} key=${row.key} size=${head.size}`);
    return { id: row.id, key: row.key, size: head.size, status: 'COMPLETED' };
  }

  async complete(userId: string, fileId: unknown): Promise<{ id: string; etag: string }> {
    const row = await this.owned(userId, fileId);
    if (!row.upload_id) {
      throw new ConflictException('upload is not multipart');
    }
    const parts = await listAllParts(this.client(), this.bucket(), row.key, row.upload_id);
    if (parts.length === 0) {
      throw new ConflictException('no parts uploaded');
    }
    const etag = await completeMultipart(
      this.client(),
      this.bucket(),
      row.key,
      row.upload_id,
      parts,
    );
    this.logger.log(`complete fileId=${row.id} key=${row.key} parts=${parts.length}`);
    return { id: row.id, etag };
  }

  private async present(row: FileRow): Promise<IntentResult> {
    const client = this.client();
    const bucket = this.bucket();
    const base = {
      id: row.id,
      key: row.key,
      expiresIn: PRESIGN_TTL_SECONDS,
    };
    if (!row.upload_id) {
      const url = await presignPut(client, bucket, row.key, row.content_type, PRESIGN_TTL_SECONDS);
      return { ...base, mode: 'single', url };
    }
    const size = Number(row.size);
    const partSize = partSizeFor(size);
    const partCount = partCountFor(size);
    if (partCount > S3_MAX_PARTS) {
      throw new BadRequestException('object needs more than 10000 parts');
    }
    const parts: PartUrl[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      parts.push({
        partNumber,
        url: await presignUploadPart(
          client,
          bucket,
          row.key,
          row.upload_id,
          partNumber,
          PRESIGN_TTL_SECONDS,
        ),
      });
    }
    return {
      ...base,
      mode: 'multipart',
      uploadId: row.upload_id,
      partSize,
      parts,
    };
  }

  private async insertRow(input: {
    key: string;
    userId: string;
    size: number | null;
    uploadId: string | null;
    contentType: string;
    idempotencyKey: string | null;
  }): Promise<FileRow> {
    const inserted = await this.db.query<FileRow>(
      `INSERT INTO files (key, owner_id, status, size, upload_id, content_type, idempotency_key)
       VALUES ($1, $2, 'PENDING', $3, $4, $5, $6)
       RETURNING id::text AS id, key, status, size::text AS size, upload_id,
                 content_type, idempotency_key`,
      [
        input.key,
        input.userId,
        input.size,
        input.uploadId,
        input.contentType,
        input.idempotencyKey,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('insert did not return a file row');
    return row;
  }

  private async findByIdempotency(userId: string, key: string): Promise<FileRow | null> {
    const found = await this.db.query<FileRow>(
      `SELECT id::text AS id, key, status, size::text AS size, upload_id,
              content_type, idempotency_key
       FROM files
       WHERE owner_id = $1 AND idempotency_key = $2`,
      [userId, key],
    );
    return found.rows[0] ?? null;
  }

  private async owned(userId: string, fileId: unknown): Promise<FileRow> {
    if (typeof fileId !== 'string' || !/^\d+$/.test(fileId)) {
      throw new BadRequestException('id is required');
    }
    const found = await this.db.query<FileRow>(
      `SELECT id::text AS id, key, status, size::text AS size, upload_id,
              content_type, idempotency_key
       FROM files
       WHERE id = $1 AND owner_id = $2`,
      [fileId, userId],
    );
    const row = found.rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }

  private parseContentType(value: unknown): string {
    if (typeof value !== 'string' || !extensionFor(value)) {
      throw new BadRequestException('contentType is not allowed');
    }
    return value;
  }

  private parseSize(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException('size must be a non-negative integer');
    }
    return value;
  }

  private rejectFilenameAsKey(filename: unknown): void {
    if (filename === undefined || filename === null) return;
    if (typeof filename !== 'string') {
      throw new BadRequestException('filename must be a string');
    }
    if (filename.length > 1024) {
      throw new BadRequestException('filename is too long');
    }
  }

  private parseIdempotency(value: string | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > 200) {
      throw new BadRequestException('Idempotency-Key is too long');
    }
    return trimmed;
  }

  private assertSameIntent(row: FileRow, contentType: string, size: number | undefined): void {
    const storedSize = row.size === null ? undefined : Number(row.size);
    if (row.content_type !== contentType || storedSize !== size) {
      throw new ConflictException('Idempotency-Key was reused with a different request body');
    }
  }

  private client(): S3Client {
    if (!this.s3) {
      this.s3 = createS3(this.requireSettings());
    }
    return this.s3;
  }

  private bucket(): string {
    return this.requireSettings().bucket;
  }

  private requireSettings(): StorageSettings {
    if (!this.settings) {
      try {
        this.settings = readStorageSettings({
          STORAGE_ENDPOINT: this.config.get('STORAGE_ENDPOINT', { infer: true }),
          STORAGE_REGION: this.config.get('STORAGE_REGION', { infer: true }),
          STORAGE_ACCESS_KEY: this.config.get('STORAGE_ACCESS_KEY', { infer: true }),
          STORAGE_SECRET_KEY: this.config.get('STORAGE_SECRET_KEY', { infer: true }),
          STORAGE_BUCKET: this.config.get('STORAGE_BUCKET', { infer: true }),
        });
      } catch (err) {
        throw new ServiceUnavailableException(
          err instanceof Error ? err.message : 'storage is not configured',
        );
      }
    }
    return this.settings;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}
