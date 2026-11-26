import { flushTraces } from './otel';
import express from 'express';
import { metricsHandler, observabilityMiddleware } from './http';
import { authLog, logger } from './logger';
import { controllerCreateOrder, controllerGetOrder } from './order-flow';

export function startObserveServer(port: number): void {
  const app = express();
  app.use(express.json({ strict: true }));
  app.get('/metrics', (req, res, next) => {
    metricsHandler(req, res).catch(next);
  });
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.post('/debug/flush', (req, res, next) => {
    flushTraces()
      .then(() => {
        res.status(204).end();
      })
      .catch(next);
  });
  app.use(observabilityMiddleware);

  app.get('/orders/:id', (req, res) => {
    const id = req.params.id;
    try {
      const order = controllerGetOrder(
        id,
        (orderId) => ({ id: orderId, status: 'pending' as const }),
        { fail: req.header('x-demo-fail') === '1' },
      );
      res.status(200).json(order);
    } catch {
      res.status(500).json({ error: 'demo failure' });
    }
  });

  app.post('/orders', (req, res) => {
    const key = req.header('idempotency-key');
    if (!key) {
      res.status(400).json({ error: 'Idempotency-Key required' });
      return;
    }
    const order = controllerCreateOrder(() => ({ id: '1', status: 'pending' as const }));
    res.status(201).json(order);
  });

  app.post('/auth/login', (req, res) => {
    const email =
      req.body && typeof req.body === 'object' && typeof req.body.email === 'string'
        ? req.body.email
        : undefined;
    authLog.info({ email }, 'login');
    res.status(401).json({ error: 'unauthorized' });
  });

  const server = app.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actual = typeof address === 'object' && address ? address.port : port;
    logger.info({ layer: 'process', listenPort: actual }, 'listening');
  });
}
