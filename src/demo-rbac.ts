import {
  DEMO_PASSWORD,
  call,
  finishDemo,
  prepareDemo,
  report,
  tamperAccessToken,
  tokenPair,
  withHttpApp,
} from './auth/demo-support';

const OWNER = 'hw24-rbac-owner@demo.marketplace';
const OTHER = 'hw24-rbac-other@demo.marketplace';
const SELLER = 'hw24-rbac-seller@demo.marketplace';
const PORT = 3413;

async function main(): Promise<void> {
  const emails = [OWNER, OTHER, SELLER];
  const pool = await prepareDemo([
    { email: OWNER, role: 'buyer' },
    { email: OTHER, role: 'buyer' },
    { email: SELLER, role: 'seller' },
  ]);
  let ok = true;
  try {
    await withHttpApp(PORT, async (base) => {
      const anon = await call(base, 'GET', '/account/orders/1');
      ok = report('anon', anon.status, 401) && ok;

      const ownerLogin = await call(base, 'POST', '/auth/login', {
        body: { email: OWNER, password: DEMO_PASSWORD },
      });
      const otherLogin = await call(base, 'POST', '/auth/login', {
        body: { email: OTHER, password: DEMO_PASSWORD },
      });
      const sellerLogin = await call(base, 'POST', '/auth/login', {
        body: { email: SELLER, password: DEMO_PASSWORD },
      });
      const owner = tokenPair(ownerLogin.body);
      const other = tokenPair(otherLogin.body);
      const seller = tokenPair(sellerLogin.body);

      const created = await call(base, 'POST', '/account/orders', { token: owner.access });
      const orderId =
        created.body && typeof created.body === 'object'
          ? String((created.body as { id?: unknown }).id ?? '')
          : '';

      const own = await call(base, 'GET', `/account/orders/${orderId}`, {
        token: owner.access,
      });
      ok = report('own', own.status, 200) && ok;

      const foreign = await call(base, 'GET', `/account/orders/${orderId}`, {
        token: other.access,
      });
      ok = report('foreign', foreign.status, 403) && ok;

      const product = { name: 'HW24 tent', price_cents: 1000 };
      const denied = await call(base, 'POST', '/account/products', {
        token: owner.access,
        body: product,
      });
      ok = report('role-denied', denied.status, 403) && ok;

      const allowed = await call(base, 'POST', '/account/products', {
        token: seller.access,
        body: product,
      });
      ok = report('role-allowed', allowed.status, [200, 201]) && ok;

      const tampered = await call(base, 'POST', '/account/products', {
        token: tamperAccessToken(owner.access),
        body: product,
      });
      ok = report('tampered', tampered.status, 401) && ok;
    });
  } finally {
    await finishDemo(pool, emails);
  }
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
