import { MigrationInterface, QueryRunner } from 'typeorm';
import { authDownStatements, authUpStatements } from '../auth/ddl';

export class AddAuthSessions1792400000000 implements MigrationInterface {
  name = 'AddAuthSessions1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of authUpStatements) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of authDownStatements) {
      await queryRunner.query(sql);
    }
  }
}
