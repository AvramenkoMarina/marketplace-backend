import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestStore = {
  userId?: string;
  tenant?: string;
  idempotencyKey?: string;
};

export const requestContext = new AsyncLocalStorage<RequestStore>();
