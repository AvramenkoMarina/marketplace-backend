import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  IDEMPOTENCY_KEYS_DDL,
  OUTBOX_DDL,
  OUTBOX_UNPUBLISHED_INDEX_DDL,
  PROCESSED_MESSAGES_DDL,
} from '../outbox/ddl';

export class AddOutboxInboxAndIdempotency1792300000000 implements MigrationInterface {
  name = 'AddOutboxInboxAndIdempotency1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(OUTBOX_DDL);
    await queryRunner.query(OUTBOX_UNPUBLISHED_INDEX_DDL);
    await queryRunner.query(PROCESSED_MESSAGES_DDL);
    await queryRunner.query(IDEMPOTENCY_KEYS_DDL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "idempotency_keys"');
    await queryRunner.query('DROP TABLE IF EXISTS "processed_messages"');
    await queryRunner.query('DROP TABLE IF EXISTS "outbox"');
  }
}
