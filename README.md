# Marketplace API

Курсовий проєкт: OpenAPI-контракт (HW-09) + Nest configuration & secrets (HW-11).

## Швидкий старт

```bash
cp .env.example .env
mkdir -p secrets
printf '%s' 'marketplace_secret' > secrets/db_password   # має збігатися з compose/init

docker compose up -d
npm install
npm start
```

API: `http://localhost:3000`

## Configuration

Усі змінні описані в `src/config/env.schema.ts` (zod) і проходять
`validate` у `ConfigModule.forRoot` **до** створення DI-графа.
У коді — лише `ConfigService<Env, true>`, без прямих `process.env`.

| Змінна | Обовʼязкова | Опис |
|--------|-------------|------|
| `NODE_ENV` | ні (default `development`) | `development` \| `test` \| `production` |
| `PORT` | ні (default `3000`) | HTTP-порт (`z.coerce.number`) |
| `DB_URL` | так | Postgres URL **без пароля**, напр. `postgresql://marketplace@localhost:5433/marketplace` |
| `DB_PASSWORD_FILE` | так | Шлях до файла-секрета з паролем БД |

Контракт для людей і CI: `.env.example` (у git). Реальний `.env` і `secrets/` — у `.gitignore`.

```bash
npm run check:env    # .env.example ↔ схема
npm run check:spec   # OpenAPI lint + обсяг
```

### Fail-fast

```bash
mv .env /tmp/marketplace.env
env -u DB_URL npm run start
# очікуємо exit ≠ 0 і згадку DB_URL у виводі
echo $?
mv /tmp/marketplace.env .env
```

`npm start` = `build && node dist/main.js` (не watch). Для розробки: `npm run start:dev`.

### Секрети і Docker

Пароль БД **не** в env і **не** в git / шарах образу:

- локально: `secrets/db_password`
- у `pg.Pool`: `password: async () => readFile(DB_PASSWORD_FILE)` на кожне нове зʼєднання
- `.dockerignore` виключає `.env` і `secrets/`

```bash
docker build -t myapp .
docker run --rm myapp ls -a /app          # є .env.example, немає .env і secrets/
docker run --rm myapp sh -c 'cat /app/.env' 2>&1
docker inspect --format '{{.Config.Env}}' myapp
```

### Ротація пароля БД без рестарту

1. Запусти Postgres і API (`docker compose up -d`, `npm start`).
2. Запамʼятай uptime:

```bash
curl -s http://localhost:3000/health
```

3. Ротація:

```bash
bash rotate.sh
```

Скрипт: `ALTER ROLE` → оновити `secrets/db_password` → `pg_terminate_backend`.

4. Перевір, що БД знову відповідає і процес живий:

```bash
curl -s http://localhost:3000/db/ping    # 200
curl -s http://localhost:3000/health     # uptime більший за попередній
```

Після `docker compose down -v` Postgres повертається до стартового пароля
`marketplace_secret` — віднови файл:

```bash
printf '%s' 'marketplace_secret' > secrets/db_password
```

## Ресурси API (OpenAPI)

| Метод | Шлях | Примітка |
|--------|------|----------|
| `GET` | `/products` | cursor-пагінація |
| `GET` | `/products/{id}` | |
| `GET` | `/orders` | cursor-пагінація |
| `POST` | `/orders` | обовʼязковий `Idempotency-Key` |
| `GET` | `/orders/{id}` | |
| `GET` | `/health` | uptime (сек) |
| `GET` | `/db/ping` | `SELECT 1` |

Гроші — цілі копійки: `price_cents`, `total_cents`.

Спека: `openapi/openapi.yaml`. Варіант контрактної частини HW-09: **Б** (`express-openapi-validator`).

## Структура HW-11

```
src/config/env.schema.ts      # zod + validate
scripts/check-env-example.mjs # npm run check:env
.env.example                  # контракт змінних
secrets/db_password           # локальний секрет (gitignore)
rotate.sh                     # ротація без рестарту
docker-compose.yml            # Postgres
Dockerfile + .dockerignore
```
