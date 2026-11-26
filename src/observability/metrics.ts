import { Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const REQUEST_COUNTER = 'http_requests_total';
export const DURATION_HISTOGRAM = 'http_request_duration_seconds';
export const DEMO_ROUTE = '/orders/:id';

/** Upper finite bound is 30s: local checkout is milliseconds, a lock wait is seconds. */
export const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30,
] as const;

const labelNames = ['method', 'route', 'status'] as const;

export const httpRequests = new Counter({
  name: REQUEST_COUNTER,
  help: 'HTTP requests by method, route template and status code',
  labelNames: [...labelNames],
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: DURATION_HISTOGRAM,
  help: 'HTTP request duration in seconds',
  labelNames: [...labelNames],
  buckets: [...HTTP_DURATION_BUCKETS],
  registers: [registry],
});
