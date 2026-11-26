import { SpanStatusCode, trace } from '@opentelemetry/api';
import { controllerLog, repoLog, serviceLog } from './logger';

const tracer = trace.getTracer('marketplace-orders');

function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const record = err as { status?: unknown; statusCode?: unknown; getStatus?: () => number };
  if (typeof record.getStatus === 'function') {
    const value = record.getStatus();
    return typeof value === 'number' ? value : undefined;
  }
  if (typeof record.status === 'number') return record.status;
  if (typeof record.statusCode === 'number') return record.statusCode;
  return undefined;
}

function repoCall<T>(spanName: string, orderId: string | undefined, message: string, work: () => T): T {
  return tracer.startActiveSpan(spanName, (span) => {
    try {
      repoLog.info(orderId ? { orderId } : {}, message);
      return work();
    } catch (err) {
      const status = statusOf(err);
      if (status !== undefined && status >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'HTTP 500' });
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

function serviceGetOrder<T>(id: string, load: (id: string) => T): T {
  serviceLog.info({ orderId: id }, 'get order');
  return repoCall('orders.repo.read', id, 'get order', () => load(id));
}

export function controllerGetOrder<T>(
  id: string,
  load: (id: string) => T,
  options: { fail?: boolean } = {},
): T {
  controllerLog.info({ orderId: id }, 'get order');
  const value = serviceGetOrder(id, load);
  if (options.fail) {
    trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR, message: 'HTTP 500' });
    const error = new Error('order read failed') as Error & { statusCode: number; status: number };
    error.statusCode = 500;
    error.status = 500;
    throw error;
  }
  return value;
}

function serviceCreateOrder<T>(work: () => T): T {
  serviceLog.info('create order');
  return repoCall('orders.repo.insert', undefined, 'create order', work);
}

export function controllerCreateOrder<T>(work: () => T): T {
  controllerLog.info('create order');
  return serviceCreateOrder(work);
}
