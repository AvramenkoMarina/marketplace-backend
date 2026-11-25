import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('files')
export class StoredFile {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @Column({ type: 'text' })
  key!: string;

  @Column({ type: 'bigint', name: 'owner_id' })
  ownerId!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'bigint', nullable: true })
  size!: string | null;

  @Column({ type: 'text', name: 'upload_id', nullable: true })
  uploadId!: string | null;

  @Column({ type: 'text', name: 'content_type' })
  contentType!: string;

  @Column({ type: 'text', name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
