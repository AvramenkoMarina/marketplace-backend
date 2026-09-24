-- Initial role password MUST match secrets/db_password.
-- After `docker compose down -v`, Postgres resets to POSTGRES_PASSWORD —
-- restore secrets/db_password to the same value or auth will fail.

SELECT 1;
