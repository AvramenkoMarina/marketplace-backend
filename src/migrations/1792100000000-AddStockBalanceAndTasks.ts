import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStockBalanceAndTasks1792100000000 implements MigrationInterface {
  name = 'AddStockBalanceAndTasks1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "balance_cents" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "users_balance_non_negative" CHECK ("balance_cents" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0)`,
    );
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "order_id" bigint,
        "kind" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "processed" integer NOT NULL DEFAULT 0,
        "worker_id" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "tasks_status_check" CHECK ("status" IN ('pending', 'done')),
        CONSTRAINT "tasks_processed_non_negative" CHECK ("processed" >= 0),
        CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_pending" ON "tasks" ("id") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_tasks_order"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_tasks_pending"`);
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "products_stock_non_negative"`,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "users_balance_non_negative"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
  }
}
