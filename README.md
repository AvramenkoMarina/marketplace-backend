# Marketplace API

Курсовий проєкт: OpenAPI-контракт (HW-09) + Nest configuration & secrets (HW-11) + дата-шар Postgres (HW-12) + TypeORM entities, міграції та N+1 (HW-13) + конкурентний checkout (HW-14) + PgBouncer і backup/restore (HW-15).

Головна таблиця: `orders`. Таблиця пошуку: `products`.

## Grading

Свіжий клон, чиста БД. Застосунок і демо ходять у Postgres через PgBouncer (порт хоста `6432`). Прямий порт Postgres — `5433`, лише для адмінського `psql`. `SKIP_VAULT=1` — у грейдера немає доступу до сховища: `DB_*` і `DATABASE_URL` уже в оточенні. `scripts/backup.sh` і `scripts/restore-drill.sh` читають `DATABASE_URL` з оточення; обгортка з `SKIP_VAULT=1` просто їх запускає.

```bash
docker compose up -d --wait

export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=marketplace DB_PASSWORD=marketplace_secret DB_NAME=marketplace

export DATABASE_URL=postgres://marketplace:marketplace_secret@127.0.0.1:6432/marketplace

export SKIP_VAULT=1    # у грейдера немає доступу до сховища

bash scripts/with-secrets.sh dev bash scripts/backup.sh

bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh

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

Демо конкурентності — після перевірки сід-каунтів: `demo:race` додає своїх покупців і замовлення, тож 8/10/8/15 знімають до нього.

```bash
npm run demo:race
npm run demo:workers
npm run demo:retry
```

## TypeORM (HW-13)

`src/data-source.ts`: `synchronize: false`. Схему створює згенерована міграція `src/migrations/1792004809791-InitSchema.ts` (`migration:generate`), дописана вручну: індекси `created_at DESC, id DESC`, виразний індекс `lower(name)` і GIN по `search_vector`. `down()` знімає FK, індекси і таблиці.

Гроші — `integer` у копійках (`price_cents`, `total_cents`, `unit_price_cents`), не `numeric`/`float`. У ДЗ #12 ті самі суми були `numeric(12, 2)`; у data layer ДЗ #13 одиниця виміру — мінорна.

`order_items` — явна join-entity: на зв'язку лежать `qty` і `unit_price_cents` (ціна на момент покупки), не `@ManyToMany`.

### onDelete

- `order_items.order_id` → **CASCADE**: позиція не існує без замовлення, діти йдуть за батьком.
- `order_items.product_id` → **RESTRICT**: товар, який уже потрапив у замовлення, не можна стерти — у рядку лишається історична ціна, а посилання на товар захищене.
- `orders.user_id` і `products.seller_id` → **RESTRICT**: історія замовлень і каталог продавця не зникають разом із користувачем.
- `tasks.order_id` → **CASCADE** (колонка nullable): задача post-processing не переживає своє замовлення; воркер-демо вставляє задачі без замовлення.

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

## Конкурентність

Checkout (`src/checkout.ts`) — одна транзакція: атомарний `UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty RETURNING`, таке саме списання `balance_cents`, `INSERT` замовлення і позиції, `INSERT` задачі `order_postprocess`. Порожній `RETURNING` відкочує всю транзакцію, тож замовлення без товару чи без грошей не лишається.

Замість `SELECT … FOR UPDATE` і подальшого запису в JS стоїть один `UPDATE … WHERE stock >= $n RETURNING`: перевірка і блокування рядка відбуваються в одному операторі, між ними немає вікна для другого клієнта. `FOR UPDATE` теж був би коректний, але тоді залишок треба читати і писати окремо.

`npm run demo:race` — 50 паралельних checkout на товар зі `stock = 10`, по 1 штуці. Баланс кожного покупця `100000000` копійок, тож лімітує склад. Запуск: спроб **50**, успішних **10**, фінальний stock **0**, рядків із відʼємним stock **0**. Повторний запуск дав ті самі числа.

`npm run demo:workers` — 4 воркери, 20 задач по 80 мс, `SELECT … FOR UPDATE SKIP LOCKED`. Порожній результат означає «зараз ніхто не вільний», воркер питає `count(pending)` і виходить лише коли черга цього kind порожня. Запуск: w1–w4 по **5** задач, оброблено двічі **0**, час **446 мс** проти послідовних **1600 мс**.

`npm run demo:retry` — два конкурентні read-modify-write балансу під `REPEATABLE READ`. Другий коміт ловить `40001` (could not serialize access due to concurrent update), обгортка повторює транзакцію з початку, включно з `SELECT`. Запуск: **1** retry (`40001`, backoff 25 мс), фінальний `balance_cents` **200** при очікуваних **200**.

Повторюються лише `40001` (serialization failure) і `40P01` (deadlock). Це конфлікти, які Postgres просить переграти цілком. Будь-який інший код — справжня помилка даних чи схеми, її повтор не виправить.

## Data layer ops

`docker compose up -d --wait` піднімає Postgres і PgBouncer. Застосунок (`DB_URL` у `.env.example` і в сховищі dev/prod) ходить на порт **6432** — це PgBouncer, не Postgres. Пароль як і раніше в `secrets/db_password`, нового секрета немає: у сховищі змінюється лише хост/порт рядка підключення. Пряме підключення до Postgres лишається на порту хоста `5433` (`docker compose exec -T postgres psql -U marketplace -d marketplace`).

Бекап: `bash scripts/with-secrets.sh dev bash scripts/backup.sh`. Скрипт робить `pg_dump -Fc` і друкує шлях до `backups/marketplace-<дата>.dump`. Розклад — `backup.cron`, щоночі о 03:00. Відновлення: `bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh` піднімає порожній контейнер з новим volume, робить `pg_restore --no-owner` і друкує `MATCH`, якщо `count` і сума по `orders` збіглися. Протокол прогону: `RESTORE-DRILL.md`.

`pool_mode = transaction`, бо серверне зʼєднання зайняте лише на час транзакції: `default_pool_size = 8` обслуговує до `max_client_conn = 200`. Session mode тримав би бекенд на весь час клієнтського конекта, і пул з 8 вичерпався б уже на гонці checkout. Transaction mode ламає стан сесії між транзакціями: іменовані prepared statements (їх тримає `max_prepared_statements = 200`), session-level advisory locks (`pg_advisory_lock`, на відміну від `pg_advisory_xact_lock`) і `LISTEN`/`NOTIFY`. Тимчасові таблиці та `SET` без `LOCAL` теж не переживають повернення зʼєднання в пул.

Підняти базу: `docker compose up -d --wait`

Підключитись: `docker compose exec -T postgres psql -U marketplace -d marketplace`

Дев-креденшели стенда лежать у `docker-compose.yml` (`marketplace` / `marketplace_secret`, БД `marketplace`). Застосунок — порт хоста `6432` (PgBouncer), прямий Postgres — `5433`. Свіжий клон піднімає обидва сервіси без правок файлів. Пароль застосунку — окремо, зі сховища `secrets/db_password` (див. Configuration).

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
| `DB_URL` | так | сховище | URL **без пароля** через PgBouncer, напр. `postgresql://marketplace@localhost:6432/marketplace` |
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
