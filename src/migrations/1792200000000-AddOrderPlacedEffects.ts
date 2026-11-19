import { MigrationInterface, QueryRunner } from 'typeorm';
import { ORDER_PLACED_EFFECTS_DDL } from '../broker/effects-ddl';

export class AddOrderPlacedEffects1792200000000 implements MigrationInterface {
  name = 'AddOrderPlacedEffects1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(ORDER_PLACED_EFFECTS_DDL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "order_placed_effects"');
  }
}
