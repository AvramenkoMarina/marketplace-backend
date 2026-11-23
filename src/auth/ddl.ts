export const authUpStatements: readonly string[] = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'buyer'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`,
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
       ALTER TABLE users
         ADD CONSTRAINT users_role_check
         CHECK (role IN ('buyer', 'seller', 'admin'));
     END IF;
   END $$`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     family_id uuid NOT NULL,
     token_hash text NOT NULL,
     used_at timestamptz,
     revoked_at timestamptz,
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_uidx
     ON refresh_tokens (token_hash)`,
  `CREATE INDEX IF NOT EXISTS refresh_tokens_family_id_idx
     ON refresh_tokens (family_id)`,
  `CREATE TABLE IF NOT EXISTS access_denylist (
     jti text PRIMARY KEY,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS access_denylist_expires_at_idx
     ON access_denylist (expires_at)`,
];

export const authDownStatements: readonly string[] = [
  `DROP TABLE IF EXISTS access_denylist`,
  `DROP TABLE IF EXISTS refresh_tokens`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
  `ALTER TABLE users DROP COLUMN IF EXISTS password_hash`,
  `ALTER TABLE users DROP COLUMN IF EXISTS role`,
];
