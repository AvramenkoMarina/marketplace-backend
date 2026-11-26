import { trace } from '@opentelemetry/api';
import pino from 'pino';
import { requestContext } from './context';

/**
 * Paths are exact. fast-redact does not guess: `password` does not hide
 * `req.body.password`, and a nested auth body stays visible unless listed.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.body.password',
  'req.body.refresh_token',
  'req.body.access_token',
  'headers.authorization',
  'body.password',
  'body.refresh_token',
  'body.access_token',
  'password',
  'refresh_token',
  'access_token',
  'authorization',
  '*.password',
  '*.refresh_token',
  '*.access_token',
  '*.authorization',
  '*.headers.authorization',
  '*.body.password',
  '*.body.refresh_token',
];

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'marketplace-api' },
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
      remove: false,
    },
    mixin() {
      const spanContext = trace.getActiveSpan()?.spanContext();
      const store = requestContext.getStore();
      return {
        trace_id: spanContext?.traceId,
        span_id: spanContext?.spanId,
        ...(store?.userId ? { userId: store.userId } : {}),
        ...(store?.tenant ? { tenant: store.tenant } : {}),
        ...(store?.idempotencyKey ? { idempotencyKey: store.idempotencyKey } : {}),
      };
    },
  },
  pino.destination({ dest: 1, sync: true }),
);

export const controllerLog = logger.child({ layer: 'orders.controller' });
export const serviceLog = logger.child({ layer: 'orders.service' });
export const repoLog = logger.child({ layer: 'orders.repo' });
export const authLog = logger.child({ layer: 'auth.controller' });
