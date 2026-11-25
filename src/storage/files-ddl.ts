export const filesUpStatements: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS files (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     key text NOT NULL,
     owner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     status text NOT NULL,
     size bigint,
     upload_id text,
     content_type text NOT NULL,
     idempotency_key text,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT files_status_check CHECK (status IN ('PENDING', 'COMPLETED')),
     CONSTRAINT files_key_unique UNIQUE (key)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS files_owner_idempotency_uidx
     ON files (owner_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS files_pending_created_idx
     ON files (created_at)
     WHERE status = 'PENDING'`,
];

export const filesDownStatements: readonly string[] = [
  `DROP TABLE IF EXISTS files`,
];
