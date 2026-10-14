# Marketplace API

Курсовий проєкт: OpenAPI-контракт (HW-09) + Nest configuration & secrets (HW-11) + дата-шар Postgres (HW-12) + TypeORM entities, міграції та N+1 (HW-13).

Головна таблиця: `orders`. Таблиця пошуку: `products`.

## Grading

Свіжий клон, чиста БД. Дев-креденшели збігаються з `docker-compose.yml` (порт хоста `5433`). `SKIP_VAULT=1` — у грейдера немає доступу до сховища, значення `DB_*` уже в оточенні.

```bash
docker compose up -d --wait

export DB_HOST=127.0.0.1 DB_PORT=5433 DB_USER=marketplace DB_PASSWORD=marketplace_secret DB_NAME=marketplace

export SKIP_VAULT=1    # у грейдера немає доступу до сховища

npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed && npm run seed
npm run demo:nplus1
npm run report
```

Перевірка, що другий `npm run seed` нічого не додав (очікувані значення: users **8**, products **10**, orders **8**, order_items **15**):

```bash
docker compose exec -T postgres psql -U marketplace -d marketplace -c \
  "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS order_items;"
```

`npm run migrate` розрахований на порожню БД. Якщо том уже містить схему з ДЗ #12 (`db/schema.sql`), спочатку `docker compose down -v`, потім блок вище.

## TypeORM (HW-13)

`src/data-source.ts`: `synchronize: false`. Схему створює згенерована міграція `src/migrations/1792004809791-InitSchema.ts` (`migration:generate`), дописана вручну: індекси `created_at DESC, id DESC`, виразний індекс `lower(name)` і GIN по `search_vector`. `down()` знімає FK, індекси і таблиці.

Гроші — `integer` у копійках (`price_cents`, `total_cents`, `unit_price_cents`), не `numeric`/`float`. У ДЗ #12 ті самі суми були `numeric(12, 2)`; у data layer ДЗ #13 одиниця виміру — мінорна.

`order_items` — явна join-entity: на зв'язку лежать `qty` і `unit_price_cents` (ціна на момент покупки), не `@ManyToMany`.

### onDelete

- `order_items.order_id` → **CASCADE**: позиція не існує без замовлення, діти йдуть за батьком.
- `order_items.product_id` → **RESTRICT**: товар, який уже потрапив у замовлення, не можна стерти — у рядку лишається історична ціна, а посилання на товар захищене.
- `orders.user_id` і `products.seller_id` → **RESTRICT**: історія замовлень і каталог продавця не зникають разом із користувачем.

### Seed

`npm run seed` вставляє фіксовані рядки (8 користувачів, 10 товарів, 8 замовлень, 15 позицій). Повторний запуск шукає ті самі email, назви товарів і пару (покупець, `created_at`) і не дублює рядки.

### N+1

Запит домену: список замовлень разом із позиціями і товарами (граф `order → items → product`, два рівні). Лічильник — `QueryCountLogger` при `logging: ['query']`. Числа не змінюються для фікса, коли вибірка росте з 5 до 8.

| Стратегія | N=5 | N=8 |
|-----------|-----|-----|
| наївно (запит у циклі) | 16 | 24 |
| `leftJoinAndSelect` | 1 | 1 |
| `relationLoadStrategy: 'query'` | 5 | 5 |

Наївно: 1 запит за замовленнями + 1 на кожне замовлення за позиціями + 1 на кожну позицію за товаром. Для N=5 це 1+5+10=16, для N=8 це 1+8+15=24. Обидва ≥ N і ростуть разом із вибіркою. `leftJoinAndSelect` лишається 1. Окремі запити стратегії `query` — 1 + 2 × 2 рівні = 5, теж константа.

### Repository чи QueryBuilder

`Repository.find()` — коли результат є сутностями (або графом сутностей) і умову можна виразити через `where` / `relations`. `createQueryBuilder().getRawMany()` — коли потрібні агрегат, `GROUP BY` і JOIN, а рядка-entity на виході немає. Звіт `npm run report` — виторг оплачених замовлень по продавцях (`SUM(qty * unit_price_cents)`, `COUNT(DISTINCT order)`), його `find()` не виражає.

Підняти базу: `docker compose up -d --wait`

Підключитись: `docker compose exec -T postgres psql -U marketplace -d marketplace`

Дев-креденшели стенда лежать у `docker-compose.yml` (`marketplace` / `marketplace_secret`, БД `marketplace`, порт хоста `5433`). Свіжий клон піднімає Postgres без правок файлів. Пароль застосунку — окремо, зі сховища `secrets/db_password` (див. Configuration).

## Дата-шар (HW-12)

Порядок такий самий, як у грейдера. Команди з кореня репозиторію, після «Підключитись»:

```bash
docker compose exec -T postgres psql -U marketplace -d marketplace -v ON_ERROR_STOP=1 -f - < db/schema.sql
docker compose exec -T postgres psql -U marketplace -d marketplace -v ON_ERROR_STOP=1 -f - < db/seed.sql
docker compose exec -T postgres psql -U marketplace -d marketplace -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"
docker compose exec -T postgres psql -U marketplace -d marketplace -f - < db/indexes.sql
docker compose exec -T postgres psql -U marketplace -d marketplace -c "ANALYZE;"
docker compose exec -T postgres psql -U marketplace -d marketplace -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"
```

Те саме для `db/queries/q2.sql`, `q3.sql`, `q4.sql`. Для q4 EXPLAIN після індексу прогнати 2–3 рази. Звіт: `db/OPTIMIZATIONS.md`.

## Швидкий старт застосунку

```bash
cp .env.example .env
mkdir -p secrets
printf '%s' 'marketplace_secret' > secrets/db_password   # має збігатися з compose/init

npm install
npm start
```

API: `http://localhost:3000`

## Configuration

Усі змінні описані в `src/config/env.schema.ts` (zod) і проходять
`validate` у `ConfigModule.forRoot` **до** створення DI-графа.
У коді — лише `ConfigService<Env, true>`, без прямих `process.env`.

| Змінна | Обовʼязкова | Джерело | Опис |
|--------|-------------|----------|------|
| `NODE_ENV` | ні (default `development`) | процес / `.env` | `development` \| `test` \| `production` |
| `PORT` | ні (default `3000`) | процес / `.env` | HTTP-порт (`z.coerce.number`) |
| `DB_URL` | так | сховище | Postgres URL **без пароля**, напр. `postgresql://marketplace@localhost:5433/marketplace` |
| `DB_PASSWORD_FILE` | так | сховище | Шлях до файла-секрета з паролем БД (`secrets/db_password`) |

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
