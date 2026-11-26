export type RouteLike = {
  baseUrl?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  route?: { path?: string };
};

const TEMPLATES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/orders\/[^/]+\/events$/, '/orders/:id/events'],
  [/^\/orders\/[^/]+$/, '/orders/:id'],
  [/^\/account\/orders\/[^/]+$/, '/account/orders/:id'],
  [/^\/products\/[^/]+$/, '/products/:id'],
  [/^\/uploads\/[^/]+$/, '/uploads/:id'],
];

const STATIC_PATHS = new Set([
  '/orders',
  '/products',
  '/health',
  '/db/ping',
  '/metrics',
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/me',
  '/account/orders',
  '/account/products',
  '/uploads/intent',
  '/uploads/commit',
  '/uploads/complete',
  '/debug/flush',
]);

export function pathOnly(req: RouteLike): string {
  const value = req.originalUrl ?? req.url ?? req.path ?? '';
  const query = value.indexOf('?');
  return query === -1 ? value : value.slice(0, query);
}

/**
 * Route label is a template. A raw `/orders/<id>` would mint a series per id.
 */
export function templateRoute(req: RouteLike): string {
  const raw = pathOnly(req);
  if (raw.startsWith('/socket.io')) return '/socket.io';
  for (const [pattern, template] of TEMPLATES) {
    if (pattern.test(raw)) return template;
  }
  if (STATIC_PATHS.has(raw)) return raw;
  const routePath = req.route?.path;
  if (typeof routePath === 'string' && routePath.includes(':')) {
    const base = req.baseUrl ?? '';
    const suffix = routePath.startsWith('/') ? routePath : `/${routePath}`;
    return `${base}${suffix}`;
  }
  return 'unmatched';
}
