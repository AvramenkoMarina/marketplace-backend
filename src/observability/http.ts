import { context } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';
import { requestContext, type RequestStore } from './context';
import { logger } from './logger';
import { httpDuration, httpRequests, registry } from './metrics';
import { pathOnly, templateRoute } from './route';

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function quietPath(url: string): boolean {
  return (
    url === '/health' ||
    url === '/metrics' ||
    url === '/debug/flush' ||
    url.startsWith('/socket.io')
  );
}

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const url = pathOnly(req);
  if (quietPath(url)) {
    next();
    return;
  }

  const store: RequestStore = {
    userId: headerValue(req.headers['x-user-id']),
    tenant: headerValue(req.headers['x-tenant']) ?? 'marketplace',
    idempotencyKey: headerValue(req.headers['idempotency-key']),
  };

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: templateRoute(req),
      status: String(res.statusCode),
    };
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    httpRequests.inc(labels);
    httpDuration.observe(labels, seconds);
  });

  const active = context.active();
  const isAuth = url.startsWith('/auth/');
  requestContext.run(store, () => {
    context.with(active, () => {
      logger.info(
        {
          layer: 'http',
          req: {
            method: req.method,
            url,
            headers: {
              authorization: req.headers.authorization,
            },
            ...(isAuth ? { body: req.body } : {}),
          },
        },
        'request',
      );
      next();
    });
  });
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
