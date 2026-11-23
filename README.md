# Marketplace API

Курсовий проєкт: OpenAPI-контракт (HW-09) + Nest configuration & secrets (HW-11) + дата-шар Postgres (HW-12) + TypeORM entities, міграції та N+1 (HW-13) + конкурентний checkout (HW-14) + PgBouncer і backup/restore (HW-15) + інтеграційні тести, E2E і Pact (HW-16) + realtime-нотифікації статусу замовлення (HW-18) + async-події `order.placed` через RabbitMQ (HW-19) + transactional outbox і ідемпотентний ефект (HW-22) + Redis: кеш, сесії, ліміт і черга BullMQ (HW-23) + автентифікація, ротація refresh і RBAC (HW-24).

Головна таблиця: `orders`. Таблиця пошуку: `products`.

## Grading

Свіжий клон, чиста БД. Застосунок і демо ходять у Postgres через PgBouncer (порт хоста `6432`). Прямий порт Postgres — `5433`, лише для адмінського `psql`. RabbitMQ — образ `rabbitmq:4.2-management`, AMQP на порту хоста `5672` (не `15672`: там лише вебморда). Здоровʼя брокера в compose — `rabbitmq-diagnostics -q check_running`, бо між відкритим TCP-портом і готовим `basic.publish` є вікно `ECONNRESET`. Redis два: кеш `redis://127.0.0.1:16379` (`maxmemory 32mb`, `allkeys-lru`) і черга `redis://127.0.0.1:16380` (`noeviction`, AOF everysec). Порти навмисно не 6379/6380 і не з діапазону лекції 22300–22399. Сесії і лічильник ліміту лежать у черговому інстансі. `SKIP_VAULT=1` — у грейдера немає доступу до сховища: `DB_*`, `DATABASE_URL`, `BROKER_URL`, `REDIS_URL` і `REDIS_QUEUE_URL` уже в оточенні. `scripts/backup.sh` і `scripts/restore-drill.sh` читають `DATABASE_URL` з оточення; обгортка з `SKIP_VAULT=1` просто їх запускає.

```bash
docker compose up -d --wait

export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=marketplace DB_PASSWORD=marketplace_secret DB_NAME=marketplace

export DATABASE_URL=postgres://marketplace:marketplace_secret@127.0.0.1:6432/marketplace

export BROKER_URL=amqp://app:app@127.0.0.1:5672

export REDIS_URL=redis://127.0.0.1:16379

export REDIS_QUEUE_URL=redis://127.0.0.1:16380

export SKIP_VAULT=1    # у грейдера немає доступу до сховища

export DB_URL=postgresql://marketplace@127.0.0.1:6432/marketplace

printf '%s' 'marketplace_secret' > /tmp/marketplace_db_password

export DB_PASSWORD_FILE=/tmp/marketplace_db_password

# одноразова пара ES256 для прогону; PEM у base64, щоб багаторядковість не поїхала

node -e 'const {generateKeyPairSync}=require("node:crypto");
const k=generateKeyPairSync("ec",{namedCurve:"P-256",
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
const fs=require("node:fs");
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'

export JWT_KID=grader

export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"

export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"

export REFRESH_TOKEN_PEPPER=grader-pepper

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
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate
npm run demo:outbox
npm run demo:crash-write
npm run demo:crash-relay
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue
npm run demo:auth
npm run demo:reuse
npm run demo:rbac
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
npm run start:vault
```

Голий `npm start` навмисно падає з exit ≠ 0, якщо в оточенні немає ключа зі сховища, і називає змінну (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KID` або `REFRESH_TOKEN_PEPPER`). Дефолта у схемі немає.

API: `http://localhost:3000`

## Realtime (HW-18)

Збірка — `npm start`: `nest build` (tsc з метаданими декораторів) і `node dist/main.js`. `tsx` метадані не емітить, gateway і guard тоді не піднімаються.

Подія `order.status` народжується в `MarketplaceService.updateStatus`. `OrderEventsService` тримає `Subject` і буфер останніх подій; gateway кладе її в кімнату `orders:<id>`, SSE читає ту саму шину.

WebSocket: після `connect` клієнт шле `join` з `{ orderId }` і `auth: { userId }`. `userId` має збігатися з заголовком `X-User-Id`, з яким створили замовлення. Анонімний сокет і чуже замовлення в кімнату не потрапляють. Подія йде лише в `server.to('orders:<id>')`.

```bash
npm install
npm start
```

Інший термінал, коли API вже слухає `:3000`:

```bash
node scripts/realtime-demo.mjs; echo "exit=$?"
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"
```

Основний прогін: клієнти в різних кімнатах, очікування `A_RECEIVED=1`, `B_RECEIVED=0`, `exit=0`. `--same-room` садить обох у кімнату замовлення A, тоді успіх — це `B_RECEIVED=1`. Обидва прогони — той самий скрипт.

SSE і чотири зміни статусу (підставте id з відповіді POST):

```bash
ID=$(curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sse-demo' \
  -H 'X-User-Id: buyer-1' \
  -d '{"items":[{"product_id":"1","qty":1}]}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).id))')

curl -sN --max-time 2 -D - -o /dev/null "http://localhost:3000/orders/${ID}/events" | grep -i '^content-type'

for st in paid cancelled pending paid; do
  curl -s -X PATCH "http://localhost:3000/orders/${ID}" \
    -H 'Content-Type: application/json' \
    -d "{\"status\":\"${st}\"}" >/dev/null
done

curl -sN --max-time 2 -H 'Last-Event-ID: 3' "http://localhost:3000/orders/${ID}/events" | grep '^id:' | head -1
```

Перший `id:` після `Last-Event-ID: 3` більший за 3. Паралельно з відкритим потоком той самий PATCH дописує живу подію (`id:`, `event:`, `data:` зі `status` у JSON).

## Trade-offs: WebSocket vs SSE

Для нотифікацій «статус замовлення змінився» я лишив би SSE. Канал тут односторонній: клієнту не треба писати в нього нічого, крім підписки, а обрив уже лікує сам протокол — `retry:` і `Last-Event-ID`. WebSocket виправданий, коли клієнт часто шле дані тим самим з’єднанням; для цієї нотифікації друга сторона лише додає рукостиск і повторний `join` після реконнекту.

На двох інстансах кімнати socket.io і буфер SSE живуть у пам’яті процесу, тож клієнт на інстансі A не почує `emit` з інстансу B і не добере події з чужого буфера; це лікується Redis-адаптером socket.io і спільним журналом подій у Redis (лекція, крок 7).

| Критерій | WebSocket | SSE |
| --- | --- | --- |
| Напрям каналу | Двонаправлений: клієнт шле `join`, сервер шле `order.status` | Лише сервер → клієнт; зміна статусу лишається звичайним HTTP |
| Реконект/відновлення | socket.io піднімає сокет сам, але кімнату треба `join`-ити знову, а пропущені події протокол не досилає | Клієнт перевідкриває потік і шле `Last-Event-ID`; сервер віддає події з id більшим за цей номер |
| Вимоги до інфраструктури | HTTP Upgrade, довге з’єднання, sticky-сесія або спільний адаптер кімнат | Звичайний HTTP; проксі не має буферизувати `text/event-stream` |
| Ціна на подію | Після рукостискання кадр маленький, але конект і heartbeat висять навіть без подій | Текст у вже відкритій відповіді; дешевше за polling, без окремого протоколу |

## Async-події через RabbitMQ

Realtime з ДЗ #18 віддає статус тому, хто підключений зараз. `order.placed` іде іншим каналом: брокер тримає повідомлення, поки зʼявиться споживач. Продюсер більше не публікує з `checkout`: продаж і рядок outbox комітяться разом, а в брокер подію виносить relay (ДЗ #22). У тілі — контракт `eventId`, `type`, `occurredAt`, `data`. `eventId` стабільний: `order.placed:<id замовлення>`, за ним споживач впізнає дубль.

Топологію оголошує споживач і бутстрап демо, не продюсер. Topic-exchange `shop.events`, quorum-черга `shop.order.placed` з binding на `order.placed`, DLX `shop.events.dlx` і окрема черга `shop.order.placed.dlq` (`x-dead-letter-exchange` на робочій черзі). На exchange висить `alternate-exchange`: routing key без binding інакше зникає мовчки, а confirm продюсер все одно отримує. Публікація — `createConfirmChannel`, `waitForConfirms` і `mandatory: true`.

Споживач працює з `noAck: false` і робить `ack` лише після ефекту. Ефект — один `INSERT` у `order_placed_effects` з `ON CONFLICT (event_id) DO NOTHING`. Це ідемпотентна операція за природним ключем, не `qty = qty - 1` і не `Set` у памʼяті процесу: рядок переживає рестарт споживача. Ключ ідемпотентності тут не потрібен — повтор із тим самим `eventId` сам нічого не змінює.

prefetch=20, бо ефект — один INSERT: пʼять підтверджених публікацій до останнього ack зайняли 15 мс (близько 3 мс на подію), тож 20 × 3 мс = 60 мс, і це менше за стоковий consumer_timeout у 30 хвилин.

Отруєне тіло, яке не є контрактом `order.placed`, споживач відхиляє через `channel.reject(msg, false)`. Повідомлення йде в DLQ, а `x-first-death-reason` дорівнює `rejected`. На RabbitMQ 4.3 `reject` із `requeue=true` довів би quorum-повідомлення до `delivery_limit`, а `nack` із `requeue=true` лічильник не збільшує; для цього демо достатньо одного reject без повернення в чергу. Політику `dead-letter-strategy: at-least-once` без `overflow: reject-publish` брокер мовчки відкочує на at-most-once і пише про це лише в лог — лишив дефолт, його вистачає, щоб `rejected` зʼявився в окремій черзі.

Повторну доставку в `demo:duplicate` зроблено так: окремий процес застосовує ефект і не шле ack, батько посилає йому `SIGKILL`. Процес зникає, ОС закриває сокет, брокер повертає непідтверджене. Другий споживач бачить той самий `eventId`, вставка конфліктує, ефект лишається один. `channel.close()` для цього не брав: це коректне закриття, а падіння сервісу виглядає як зниклий процес.

Це at-least-once доставка, не exactly-once. Підтвердження брокера означає «я більше не вимагаю повтору», а не «ефект стався рівно один раз». Якщо процес гине після ефекту і до ack, те саме повідомлення приїде знову — `demo:duplicate` це й показує. Exactly-once доставки немає ні в кого. Результат один, бо до at-least-once додано ідемпотентний ефект: повтор не вставляє другий рядок.

Щілина між позначкою «вже оброблено» і окремим ефектом лишається, якщо комітити їх двома транзакціями. Ефект у `order_placed_effects` і рядок `processed_messages` пишуться одним COMMIT. Спільного COMMIT бази й брокера немає: його закриває outbox, не публікація зсередини транзакції продажу.

Брокер — RabbitMQ 4.2.9, образ `rabbitmq:4.2-management`. Серія 4.2 — LTS до 30.06.2030. Черги quorum: у них працює delivery-limit, а класичне дзеркалювання (`ha-mode`) з 4.0 прибране.

Прогін `demo:publish`:

```
published=5
delivered=5
effect=5
acked=5
dlq=0
prefetch=20
```

Прогін `demo:dlq`:

```
rejected=1
work=0
dlq=1
dlq-reason=rejected
effect=0
```

Прогін `demo:duplicate`:

```
deliveries=2
effect=1
skipped=1
```

## Outbox та ідемпотентність

Оформлення замовлення (`checkout`) пише бізнес-рядки і рядок `outbox` в одній транзакції TypeORM. У транзакції немає `publish`: брокер не відкочується разом із Postgres. У `payload` лежить контракт `toOrderPlacedEvent` (`eventId`, `type`, `occurredAt`, `data`), не ORM-сутність.

Relay на одному клієнті з пулу: `BEGIN` → `SELECT … WHERE published_at IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT N` → `publish` → `UPDATE published_at` → `COMMIT`. Частковий індекс `idx_outbox_unpublished` покриває лише `published_at IS NULL`.

Ідемпотентність на трьох рівнях:

1. Ефект — `INSERT` у `order_placed_effects` з `ON CONFLICT (event_id) DO NOTHING`. Повтор не робить `qty = qty - 1`.
2. Inbox — `processed_messages (message_id, consumer)` в тій самій транзакції, що й ефект. Обидва рядки або є, або їх немає.
3. `Idempotency-Key` на краю операції — рядок у `idempotency_keys`. Ключ називає намір клієнта. Хеш тіла зліпив би два легітимні однакові замовлення в одне, тому тіло в ключ не входить.

`demo:crash-relay` не шле `kill -9`. Після підтвердженого `publish` relay кидає виняток, і та сама транзакція робить `ROLLBACK` ще до `UPDATE published_at` (як крок 8 у коді лекції). Рядок лишається unpublished, тож наступний прохід публікує його вдруге.

Поміняти місцями `publish` і `UPDATE published_at` не можна. Якщо спершу позначити рядок винесеним, а потім публікувати, відмова publish лишає `published_at` заповненим, і relay цей рядок більше не візьме. Подія втрачена. Зворотний порядок дає дубль: брокер уже прийняв повідомлення, позначка не встигла, наступний poll віддасть те саме ще раз. Дубль знімає ідемпотентний ефект. Втрату не лікує нічого. Помилка publish теж не доводить, що брокера повідомлення не досягло: загубитись могла відповідь, тож «зловив помилку і відкотив» не стирає вже прийняту доставку.

`ORDER BY created_at, id` задає лише порядок вибірки. `SKIP LOCKED` роздає рядки різним воркерам, тож глобального порядку доставки немає. Для `order.placed` він не потрібен: у одного замовлення одна подія. Курсор «усі id більші за останній» був би хибним: identity-номер зʼявляється на `nextval`, а рядок стає видимим лише на `COMMIT`.

Опубліковані рядки не входять у частковий індекс, тож сам poll від них не повільнішає, але таблиця росте. Чистка — окремий прохід, який видаляє рядки з `published_at` старшим за 7 днів. Неопубліковані він не чіпає.

Колонки snake_case (`aggregate_type`, `aggregate_id`). У Debezium Outbox Event Router `route.by.field` за замовчуванням — `aggregatetype` без підкреслення. Перехід на CDC не змінює payload і консюмерів, але потребує `route.by.field=aggregate_type` і `table.field.event.key=aggregate_id`.

Прогін `demo:outbox` (два запити з одним `Idempotency-Key`):

```
requests=2
orders=1
outbox=1
published=1
deliveries=1
effect=1
processed=1
```

Прогін `demo:crash-write` (виняток після `INSERT` в outbox, обидва рядки зникають разом):

```
write-failed=1
orders=0
outbox=0
published=0
deliveries=0
effect=0
```

Прогін `demo:crash-relay` (та сама подія діставлена двічі, ефект один; `published` — це позначені рядки outbox, не кількість publish):

```
published=1
deliveries=2
applied=1
effect=1
processed=1
```

Повторний прогін усіх трьох дав ті самі числа.

## Redis: кеш, сесії, ліміти, черга

Два контейнери, бо політики памʼяті несумісні в одному процесі. `maxmemory` спільна на весь інстанс, тож `SELECT 1` їх не розведе. Кеш (`redis-cache`, порт хоста `16379`) має `maxmemory 32mb` і `allkeys-lru`. Черга (`redis-queue`, порт хоста `16380`) має `maxmemory-policy noeviction` і AOF `everysec`: BullMQ не працює, якщо Redis викидає ключі довільно.

Сесії і лічильник ліміту лежать у черговому інстансі, не в кеші. `allkeys-lru` колись викине сесію, і користувача розлогінить без способу це відтворити. Третій контейнер для цього не потрібен: черга якраз не витісняє ключі.

Картка товару (ціна, залишок, сума продажів) читається cache-aside. Промах іде в Postgres, влучання — лише в Redis. TTL = `300 + (індекс mod 61)` секунд, розкид 0…60, тож ключі одного прогріву не протухають в одну секунду. Запис у кеш обгорнутий: переповнений кеш не валить запит.

Лавину закриває single-flight лок: `SET lock NX PX`, решта чекає і перечитує кеш. Знімається лок лише свій, Lua compare-and-delete. Голий `DEL` зняв би чужий.

Сесія — рядок у Redis із rolling TTL (`GETEX`). Після рестарту процесу ключ лишається. Між запитами демо чекає 1.5 с, інакше TTL у секундах не встигає зменшитись.

Ліміт — ковзне вікно одним Lua-скриптом, спільний ключ на два поди. Сплеск на межі вікна не дозволяємо: фіксоване вікно пропустило б до двох лімітів за частку секунди, а три команди замість одного скрипта протікали б саме під навантаженням.

Черга BullMQ перераховує рейтинг поза HTTP. `attempts` 5, `backoff` exponential із jitter, `jobId` дедуплікує два `add` в одну задачу. `removeOnComplete` — за віком, не `true`, інакше дедуп вимикається. Планувальник — `upsertJobScheduler`, не `add` на кожен старт.

Прогін `demo:cache`:

```
cache-lru=1
cache-maxmemory=1
warmed=50
ttl-distinct=50
concurrent=20
db-calls=1
db-calls-warm=0
```

Прогін `demo:session`:

```
requests=3
sessions=1
in-redis=1
ttl-renewed=1
```

Прогін `demo:ratelimit`:

```
instances=2
limit=5
requests=8
allowed=5
blocked=3
status=429
retry-after=1
```

Прогін `demo:queue`:

```
queue-noeviction=1
attempts=3
completed=1
added=2
queued=1
schedulers=1
scheduled-runs=2
```

Повторний прогін дав ті самі числа.

Якщо stampede-лок зламається, два запити одночасно підуть у базу і прочитають картку двічі. Це прийнятно: лок тут оптимізація, а не захист інваріанта. Зіпсувати залишок або баланс він не може — їх рухає транзакція checkout. Найгірша ціна збою лока — зайвий SELECT і кілька центів, не подвійний продаж.

## Auth

Access-токен — JWT ES256 на 10 хвилин. Refresh — випадковий рядок на 30 днів; у `refresh_tokens` лежить лише HMAC-SHA256 від нього з перцем `REFRESH_TOKEN_PEPPER`, не сам токен. Успішний refresh виписує нову пару і ставить `used_at` на старий рядок. Усі refresh одного логіна мають спільний `family_id`. Повторне предʼявлення вже використаного refresh — сигнал компрометації (RFC 9700 §4.14.2): у тій самій транзакції `revoked_at` ставиться на всю сімʼю, у лог іде `family_id` і відбиток ключа, не токен. Вікна благодаті немає: щоб віддати ту саму нову пару вдруге, довелося б зберігати наступний refresh відкритим текстом. Клієнт серіалізує refresh — один запит у польоті.

Підпис — ES256 (ECDSA P-256), не RS256. OWASP позначає RS256 як Not recommended і радить ES256, PS256 або EdDSA. ES256 коротший, його підписує `node:crypto`, і верифікатор тримає явний allowlist `algorithms: ['ES256']` (RFC 8725 §3.1). Це відсікає algorithm confusion, включно з `alg: none` і підміною на HMAC. Спільного секрета HS256 немає, тож верифікатор не може виписати собі `role: admin`: у нього лише публічний ключ. PEM у змінних — один рядок base64.

Ротація ключа — overlap по `kid`. Підпис завжди йде поточним приватним ключем. Перевірка тримає мапу публічних ключів: поточний `JWT_KID` і, на час overlap, `JWT_PREVIOUS_KID` + `JWT_PREVIOUS_PUBLIC_KEY`. Спершу поруч зі старим зʼявляється новий публічний ключ, потім підпис перемикається на новий `kid`, і лише після того, як access-токени старого `kid` дожили до `exp` (не довше 10 хв), старий публічний ключ прибирається. Приватний ключ попереднього покоління застосунку не потрібен.

Логаут — це дві дії, бо токени різні за природою. Refresh — рядок у базі: досить `revoked_at` на сімʼю. Access самодостатній і живе до `exp`, тому його `jti` пишеться в `access_denylist` з `expires_at`, рівним `exp`. Обидва записи — один `COMMIT` у Postgres. Денилист не в Redis: інакше це був би dual write з ДЗ #22, і збій між сховищами лишив би access живим після логауту. Перевірка дивиться лише рядки з `expires_at > now()` і видаляє прострочені, тож запис не діє довше за життя токена і таблиця не росте безстроково.

Немає, протух, зіпсований або відкликаний токен — 401. Токен валідний, але прав немає — 403. Клієнт на 401 іде рефрешити, на 403 показує помилку.

Роль у access-токені — знімок `users.role` на момент випуску пари. `RolesGuard` читає лише токен і в базу за роллю не ходить. Розжалуваний адмін лишається адміном до `exp` цього access-токена. Наступний refresh уже візьме роль з бази. Це компроміс короткого TTL, не джерело правди.

Межа власності і ролі різна. `AuthGuard` і `RolesGuard` стоять до хендлера і бачать лише токен: чи є підпис, і чи роль `seller` або `admin` на `POST /account/products`. Замовлення в гарді немає, тож власність туди не кладеться — гард мусив би сам читати базу, а хендлер прочитав би її вдруге. `GET /account/orders/:id` спочатку вантажить замовлення в `MarketplaceService.getOwnedOrder` і вже там порівнює `order.userId` із `sub`. Свій id — 200, чужий під валідним токеном — 403. Ресурс із власником — замовлення (`/account/orders/{id}`). Запис лише для продавця або адміна — товар (`POST /account/products`). Публічні `POST /orders` і `GET /orders/{id}` лишились для контракту HW-09, realtime і e2e; грейдер читає статуси з демо, не з цих маршрутів.

| Змінна | Джерело | Навіщо |
|---|---|---|
| `JWT_PRIVATE_KEY` | сховище (#11) | підпис access-токенів, ES256 PKCS8 PEM у base64 |
| `JWT_PUBLIC_KEY` | сховище (#11) | перевірка підпису, ES256 SPKI PEM у base64 |
| `JWT_KID` | сховище (#11) | `kid` поточного ключа; у dev і prod різний |
| `REFRESH_TOKEN_PEPPER` | сховище (#11) | HMAC-перець хеша refresh-токена |
| `JWT_PREVIOUS_KID` | сховище (#11), лише на час overlap | `kid` попереднього публічного ключа |
| `JWT_PREVIOUS_PUBLIC_KEY` | сховище (#11), лише на час overlap | публічний ключ, яким ще перевіряються старі access |
| `DB_URL` | сховище (#11) | URL Postgres без пароля |
| `DB_PASSWORD_FILE` | сховище (#11) | файл із паролем БД |
| `DATABASE_URL` | compose / оточення | дев-креденшели для міграцій і демо, секретом не є |

Відбитки публічних ключів (SHA-256 від SPKI DER). Dev і prod — різні пари:

| Оточення | kid | відбиток |
|---|---|---|
| dev | `marketplace-dev-es256` | `a8bb371fb7a1855c4e3efb02f710a34e4668071ed78b2f656f55344ebac490ec` |
| prod | `marketplace-prod-es256` | `951091d526b6048a7af78ec4b0e213eb1c4da1fa5e322736491880b3ec701ea7` |

```bash
node -e 'const {createPublicKey,createHash}=require("node:crypto"); const pem=Buffer.from(process.env.JWT_PUBLIC_KEY,"base64"); const der=createPublicKey(pem).export({type:"spki",format:"der"}); console.log(createHash("sha256").update(der).digest("hex"))'
```

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
| `BROKER_URL` | ні | сховище | AMQP URL RabbitMQ, напр. `amqp://app:app@127.0.0.1:5672`. Порт `5672`, не `15672` |
| `REDIS_URL` | ні | сховище | Кеш Redis, `allkeys-lru`, напр. `redis://127.0.0.1:16379` |
| `REDIS_QUEUE_URL` | ні | сховище | Черга Redis, `noeviction`. Сесії і ліміт теж тут, напр. `redis://127.0.0.1:16380` |
| `JWT_KID` | так | сховище | Ідентифікатор поточного ключа підпису ES256 |
| `JWT_PRIVATE_KEY` | так | сховище | Приватний ключ ES256, PKCS8 PEM у base64. Дефолта немає |
| `JWT_PUBLIC_KEY` | так | сховище | Публічний ключ ES256, SPKI PEM у base64. Дефолта немає |
| `JWT_PREVIOUS_KID` | ні | сховище | Попередній `kid` на час overlap-ротації |
| `JWT_PREVIOUS_PUBLIC_KEY` | ні | сховище | Попередній публічний ключ ES256, base64 PEM |
| `REFRESH_TOKEN_PEPPER` | так | сховище | HMAC-перець хеша refresh-токена. Дефолта немає |

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

## Тестування

Команди з кореня, Docker має бути запущений:

```bash
npm run test:integration
npm run test:e2e
npm run test:contract
npm run verify:provider
```

`test:integration` — `UserRepository` і `OrderRepository` проти `postgres:16-alpine`, який піднімає `@testcontainers/postgresql`. `test:e2e` — повний `AppModule` без підмін провайдерів: `POST /orders` → `GET /orders/:id`, і `404` на невідоме замовлення. `test:contract` пише `pacts/MarketplaceWeb-MarketplaceAPI.json` (файл у git, щоб `verify:provider` працював і без попереднього прогону; CI генерує його знову). `verify:provider` ганяє справжній застосунок проти контракту. Jest має `reporters: ['default']` і `maxWorkers: 1`.

Ізоляція — транзакція і `ROLLBACK`. На сьют піднімається один контейнер, міграції проганяються один раз, а кожен тест бере `PoolClient`, робить `BEGIN` і віддає цей самий клієнт у репозиторій (йому достатньо `query()`). `afterEach` робить `ROLLBACK`, тож unique/FK і `COUNT(*)` не бачать рядків сусіднього тесту. Окремий контейнер на тест лише помножив би старт Postgres, а `TRUNCATE` комітив би зміни і ховав би пропущений rollback. Повторний `npm run test:integration && npm run test:integration` зелений без ручної чистки: другий прогін піднімає новий контейнер, а всередині прогону тести й так відкочуються.

`DATABASE_URL` тестам віддає `container.getConnectionUri()`. Застосунок як і раніше читає пароль з файла (`DB_URL` без пароля + `DB_PASSWORD_FILE`), тож testkit розкладає URI контейнера в ці дві змінні. Сховище для тестів не потрібне.

### Pact Broker

Локально брокер — сервіс `pact-broker` у `docker-compose.yml` (SQLite, порт `9292`, healthcheck на `127.0.0.1`).

```bash
docker compose up -d --wait
```

Код читає лише `process.env.PACT_BROKER_URL` і `process.env.PACT_BROKER_TOKEN`. Основний локальний шлях — обгортка з ДЗ #11: секрети `PACT_BROKER_URL` / `PACT_BROKER_TOKEN` лежать у сховищі dev і приїжджають так:

```bash
bash scripts/with-secrets.sh dev npm run verify:provider
```

Грейдер сховища не має. `SKIP_VAULT=1` змушує обгортку виконати команду як є, з уже заданим оточенням. Те саме без обгортки:

```bash
PACT_BROKER_URL=http://127.0.0.1:9292 PACT_PROVIDER_VERSION=1.0.0 npm run verify:provider
```

Без `PACT_BROKER_URL` верифікатор бере файл `pacts/*.json` і нічого не публікує. З адресою брокера вмикається `publishVerificationResult: true`. Токен у репозиторій не кладеться; для локального compose він не потрібен. У CI ті самі змінні — секрети GitHub. Job `contract` робить publish → verify → `can-i-deploy` і падає, якщо `deployable` не `true`. Тег `prod` ставиться на версію провайдера (`PACT_PROVIDER_VERSION`), не консюмера.

Гейт на локальному брокері (споживач `MarketplaceWeb` `1.0.0`, провайдер `MarketplaceAPI` `1.0.0`). Публікація `curl -X PUT` повернула **201**, верифікація з `PACT_BROKER_URL` — exit 0, тег `PUT .../versions/1.0.0/tags/prod` — **201**.

`can-i-deploy` між верифікацією і тегом (`"deployable":null`, `"unknown":1`):

```json
{"summary":{"deployable":null,"reason":"There is no verified pact between version 1.0.0 of MarketplaceWeb and the latest version of MarketplaceAPI with tag prod (no such version exists)","success":0,"failed":0,"unknown":1},"notices":[{"type":"error","text":"There is no verified pact between version 1.0.0 of MarketplaceWeb and the latest version of MarketplaceAPI with tag prod (no such version exists)"}],"matrix":[{"consumer":{"name":"MarketplaceWeb","version":{"number":"1.0.0","branch":null,"branches":[],"branchVersions":[],"environments":[],"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb/versions/1.0.0"}},"tags":[]},"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb"}}},"provider":{"name":"MarketplaceAPI","version":null,"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI"}}},"pact":{"createdAt":"2026-10-20T15:26:58+00:00","_links":{"self":{"href":"http://127.0.0.1:9292/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/version/1.0.0"}}},"verificationResult":null}]}
```

Та сама команда після тега `prod` (`"deployable":true`):

```json
{"summary":{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0},"notices":[{"type":"success","text":"All required verification results are published and successful"}],"matrix":[{"consumer":{"name":"MarketplaceWeb","version":{"number":"1.0.0","branch":null,"branches":[],"branchVersions":[],"environments":[],"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb/versions/1.0.0"}},"tags":[]},"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceWeb"}}},"provider":{"name":"MarketplaceAPI","version":{"number":"1.0.0","branch":"prod","branches":[{"name":"prod","latest":true,"_links":{"self":{"title":"Branch version","name":"prod","href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/branches/prod/versions/1.0.0"}}}],"branchVersions":[{"name":"prod","latest":true,"_links":{"self":{"title":"Branch version","name":"prod","href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/branches/prod/versions/1.0.0"}}}],"environments":[],"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/versions/1.0.0"}},"tags":[{"name":"prod","latest":true,"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI/versions/1.0.0/tags/prod"}}}]},"_links":{"self":{"href":"http://127.0.0.1:9292/pacticipants/MarketplaceAPI"}}},"pact":{"createdAt":"2026-10-20T15:26:58+00:00","_links":{"self":{"href":"http://127.0.0.1:9292/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/version/1.0.0"}}},"verificationResult":{"success":true,"verifiedAt":"2026-10-20T15:27:06+00:00","_links":{"self":{"href":"http://127.0.0.1:9292/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/pact-version/11489fd506e6e4f384dfcd7f4a1aa92ae50f8926/metadata/Y3ZuPTEuMC4w/verification-results/101"}}}}]}
```

## Ресурси API (OpenAPI)

| Метод | Шлях | Примітка |
|--------|------|----------|
| `GET` | `/products` | cursor-пагінація |
| `GET` | `/products/{id}` | |
| `GET` | `/orders` | cursor-пагінація |
| `POST` | `/orders` | обовʼязковий `Idempotency-Key` |
| `GET` | `/orders/{id}` | |
| `PATCH` | `/orders/{id}` | зміна статусу, подія `order.status` |
| `GET` | `/orders/{id}/events` | SSE `text/event-stream` |
| `POST` | `/auth/login` | пара access + refresh |
| `POST` | `/auth/refresh` | ротація; повтор уже використаного refresh відкликає сімʼю |
| `POST` | `/auth/logout` | `revoked_at` сімʼї і `jti` у денилист, 204 |
| `GET` | `/auth/me` | 200 з токеном, 401 без нього або після логауту |
| `POST` | `/account/orders` | замовлення власника з `sub` токена |
| `GET` | `/account/orders/{id}` | 200 власнику, 403 чужому валідному токену, 401 без токена |
| `POST` | `/account/products` | 201 продавцю або адміну, 403 покупцю |
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
