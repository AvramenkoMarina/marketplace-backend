/** Snake_case on purpose. Debezium's default route.by.field is aggregatetype. */
export const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS "outbox" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "published_at" TIMESTAMP WITH TIME ZONE,
  "attempts" integer NOT NULL DEFAULT 0,
  CONSTRAINT "outbox_attempts_non_negative" CHECK ("attempts" >= 0),
  CONSTRAINT "PK_outbox_id" PRIMARY KEY ("id")
)`;

/** Relay scans only the unpublished tail. Published rows stay out of this index. */
export const OUTBOX_UNPUBLISHED_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS "idx_outbox_unpublished"
  ON "outbox" ("created_at", "id")
  WHERE "published_at" IS NULL`;

export const PROCESSED_MESSAGES_DDL = `
CREATE TABLE IF NOT EXISTS "processed_messages" (
  "message_id" text NOT NULL,
  "consumer" text NOT NULL,
  "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_processed_messages" PRIMARY KEY ("message_id", "consumer")
)`;

/** The client Idempotency-Key. It names the intent, not a hash of the body. */
export const IDEMPOTENCY_KEYS_DDL = `
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "key" text NOT NULL,
  "order_id" bigint NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key"),
  CONSTRAINT "FK_idempotency_keys_order"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
)`;
