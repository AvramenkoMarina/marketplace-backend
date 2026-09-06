# Marketplace API — HW-09

Обраний варіант контрактної частини: **Б** — runtime-валідація на кордоні з `express-openapi-validator`.

Спека `openapi/openapi.yaml` — джерело правди. Сервер валідує запити й відповіді проти неї (`validateRequests` + `validateResponses`) і віддає помилки у `application/problem+json`.

## Стек

- OpenAPI 3.0.3
- express@4.22.2
- express-openapi-validator@5.6.2
- @redocly/cli@2.46.0

## Швидкий старт

```bash
npm install
npm start
```

Сервер слухає `http://localhost:3000` (або `PORT`).

## Ресурси в спеці

| Метод | Шлях | Примітка |
|--------|------|----------|
| `GET` | `/products` | cursor-пагінація (`limit`, `cursor` → `items`, `next_cursor`) |
| `GET` | `/products/{id}` | деталь товару |
| `GET` | `/orders` | cursor-пагінація |
| `POST` | `/orders` | обовʼязковий `Idempotency-Key` |
| `GET` | `/orders/{id}` | деталь замовлення |

Гроші — цілі копійки: `price_cents`, `total_cents` (`integer`).

## Перевірки (acceptance criteria)

### 1. Спека валідна

```bash
npx @redocly/cli@2.46.0 lint openapi/openapi.yaml
```

Очікуємо exit code 0 (warnings дозволені).

### 2. Обсяг спеки

```bash
npx @redocly/cli@2.46.0 bundle openapi/openapi.yaml -o spec.json

node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
```

Очікуємо: операцій ≥ 5 · ресурсів ≥ 2 · `required = true` · опис ≥ 40 символів.

Або однією командою: `npm run check:spec`.

### 3. Idempotency-Key / cursor / problem+json у спеці

```bash
grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```

Очікуємо відповідно ≥ 1, ≥ 1, ≥ 2.

### 4. Варіант Б — runtime-валідація

У окремому терміналі: `npm start`.

```bash
# без Idempotency-Key → 400 problem+json
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"product_id":"1","qty":1}]}'

# порожній items → 400
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[]}'

# валідний → 201
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[{"product_id":"1","qty":1}]}'
```

Очікувані `detail` від валідатора:

- `request/headers must have required property 'idempotency-key'`
- `request/body/items must NOT have fewer than 1 items`

### Додатково (idempotency semantics)

```bash
# replay того самого ключа + тіла → 201 + Idempotency-Replay: true
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[{"product_id":"1","qty":1}]}'

# той самий ключ, інше тіло → 422 problem+json
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: k1' \
  -d '{"items":[{"product_id":"2","qty":1}]}'
```

## Структура

```
openapi/openapi.yaml   # контракт
src/app.cjs            # Express + express-openapi-validator (in-memory)
scripts/check-spec.cjs # перевірка обсягу після bundle
README.md
package.json
```
