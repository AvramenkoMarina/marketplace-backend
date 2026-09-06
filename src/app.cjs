const crypto = require('crypto');
const path = require('path');
const express = require('express');
const OpenApiValidator = require('express-openapi-validator');

const PORT = process.env.PORT || 3000;

/** @type {Map<string, { id: string, name: string, price_cents: number, createdAt: string }>} */
const products = new Map([
  ['1', { id: '1', name: 'Notebook', price_cents: 129900, createdAt: '2026-01-01T10:00:01.000Z' }],
  ['2', { id: '2', name: 'USB-C Cable', price_cents: 1599, createdAt: '2026-01-01T10:00:02.000Z' }],
  ['3', { id: '3', name: 'Wireless Mouse', price_cents: 2499, createdAt: '2026-01-01T10:00:03.000Z' }],
  ['4', { id: '4', name: 'HDMI Adapter', price_cents: 1899, createdAt: '2026-01-01T10:00:04.000Z' }],
  ['5', { id: '5', name: 'Laptop Stand', price_cents: 4599, createdAt: '2026-01-01T10:00:05.000Z' }],
]);

/** @type {Map<string, object>} */
const orders = new Map();

/** @type {Map<string, { bodyHash: string, status: number, headers: object, body: object }>} */
const idempotencyStore = new Map();

let nextOrderId = 1;

function bodyHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/** Opaque cursor: createdAt + id (as on lecture — avoids offset drift). */
function encodeCursor({ createdAt, id }) {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    typeof parsed.id !== 'string' ||
    typeof parsed.createdAt !== 'string' ||
    Number.isNaN(Date.parse(parsed.createdAt))
  ) {
    const err = new Error('cursor is not a valid opaque pagination token');
    err.status = 400;
    err.title = 'Bad Request';
    throw err;
  }
  return parsed;
}

/** Newest first: createdAt DESC, id DESC as tie-breaker. */
function compareDesc(a, b) {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? 1 : -1;
  }
  return 0;
}

/** True if item is strictly after the cursor in DESC order (older / smaller). */
function isAfterCursor(item, cursor) {
  if (item.createdAt !== cursor.createdAt) {
    return item.createdAt < cursor.createdAt;
  }
  return item.id < cursor.id;
}

function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    price_cents: product.price_cents,
  };
}

function publicOrder(order) {
  return {
    id: order.id,
    items: order.items,
    total_cents: order.total_cents,
    status: order.status,
  };
}

function paginate(list, limit, cursor, toPublic) {
  const sorted = [...list].sort(compareDesc);
  const filtered = cursor
    ? sorted.filter((item) => isAfterCursor(item, decodeCursor(cursor)))
    : sorted;
  const page = filtered.slice(0, limit);
  const next_cursor =
    filtered.length > limit
      ? encodeCursor({ createdAt: page[page.length - 1].createdAt, id: page[page.length - 1].id })
      : null;
  return { items: page.map(toPublic), next_cursor };
}

function problem(res, status, title, detail, instance) {
  return res
    .status(status)
    .type('application/problem+json')
    .json({
      type: 'about:blank',
      title,
      status,
      detail,
      instance,
    });
}

function createApp() {
  const app = express();
  app.use(express.json({ strict: true }));

  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
    }),
  );

  app.get('/products', (req, res) => {
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    const cursor = req.query.cursor;
    res.json(paginate([...products.values()], limit, cursor, publicProduct));
  });

  app.get('/products/:id', (req, res) => {
    const product = products.get(req.params.id);
    if (!product) {
      return problem(res, 404, 'Not Found', `Product ${req.params.id} not found`, req.originalUrl);
    }
    return res.json(publicProduct(product));
  });

  app.get('/orders', (req, res) => {
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    const cursor = req.query.cursor;
    res.json(paginate([...orders.values()], limit, cursor, publicOrder));
  });

  app.get('/orders/:id', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order) {
      return problem(res, 404, 'Not Found', `Order ${req.params.id} not found`, req.originalUrl);
    }
    return res.json(publicOrder(order));
  });

  app.post('/orders', (req, res) => {
    const key = req.headers['idempotency-key'];
    const hash = bodyHash(req.body);
    const cached = idempotencyStore.get(key);

    if (cached) {
      if (cached.bodyHash !== hash) {
        return problem(
          res,
          422,
          'Unprocessable Entity',
          'Idempotency-Key was reused with a different request body',
          req.originalUrl,
        );
      }
      res.set('Idempotency-Replay', 'true');
      if (cached.headers.Location) {
        res.set('Location', cached.headers.Location);
      }
      return res.status(cached.status).json(cached.body);
    }

    const lineItems = [];
    let total_cents = 0;

    for (const item of req.body.items) {
      const product = products.get(item.product_id);
      if (!product) {
        return problem(
          res,
          404,
          'Not Found',
          `Product ${item.product_id} not found`,
          req.originalUrl,
        );
      }
      lineItems.push({
        product_id: product.id,
        qty: item.qty,
        unit_price_cents: product.price_cents,
      });
      total_cents += product.price_cents * item.qty;
    }

    const id = String(nextOrderId++);
    const order = {
      id,
      items: lineItems,
      total_cents,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    orders.set(id, order);

    const location = `/orders/${id}`;
    const body = publicOrder(order);
    const response = {
      status: 201,
      headers: { Location: location },
      body,
      bodyHash: hash,
    };
    idempotencyStore.set(key, response);

    res.set('Location', location);
    return res.status(201).json(body);
  });

  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    const detail = err.errors
      ? err.errors.map((e) => e.path + ' ' + e.message).join('; ') || err.message
      : err.message || 'Unexpected error';

    // express-openapi-validator puts a useful path+message in err.message already
    // (e.g. "request/headers must have required property 'idempotency-key'")
    const detailText = err.message || detail;

    return res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title:
          err.title ||
          err.name ||
          (status >= 500 ? 'Internal Server Error' : 'Bad Request'),
        status,
        detail: detailText,
        instance: req.originalUrl,
      });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Marketplace API listening on http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
