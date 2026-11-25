import { MigrationInterface, QueryRunner } from 'typeorm';
import { filesDownStatements, filesUpStatements } from '../storage/files-ddl';

export class AddFiles1792500000000 implements MigrationInterface {
  name = 'AddFiles1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of filesUpStatements) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of filesDownStatements) {
      await queryRunner.query(sql);
    }
  }
}
