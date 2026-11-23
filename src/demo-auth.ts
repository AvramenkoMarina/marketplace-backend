import {
  DEMO_PASSWORD,
  call,
  finishDemo,
  prepareDemo,
  report,
  tokenPair,
  withHttpApp,
} from './auth/demo-support';

const EMAIL = 'hw24-auth@demo.marketplace';
const PORT = 3411;

async function main(): Promise<void> {
  const pool = await prepareDemo([{ email: EMAIL, role: 'buyer' }]);
  let ok = true;
  try {
    await withHttpApp(PORT, async (base) => {
      const login = await call(base, 'POST', '/auth/login', {
        body: { email: EMAIL, password: DEMO_PASSWORD },
      });
      ok = report('login', login.status, 200) && ok;
      const first = tokenPair(login.body);

      const anon = await call(base, 'GET', '/auth/me');
      ok = report('no-token', anon.status, 401) && ok;

      const authed = await call(base, 'GET', '/auth/me', { token: first.access });
      ok = report('with-token', authed.status, 200) && ok;

      const refreshed = await call(base, 'POST', '/auth/refresh', {
        body: { refresh_token: first.refresh },
      });
      ok = report('refresh', refreshed.status, 200) && ok;
      const next = tokenPair(refreshed.body);

      const logout = await call(base, 'POST', '/auth/logout', {
        token: next.access,
        body: { refresh_token: next.refresh },
      });
      ok = report('logout', logout.status, [200, 204]) && ok;

      const after = await call(base, 'GET', '/auth/me', { token: next.access });
      ok = report('after-logout', after.status, 401) && ok;

      const refreshAfter = await call(base, 'POST', '/auth/refresh', {
        body: { refresh_token: next.refresh },
      });
      ok = report('refresh-after-logout', refreshAfter.status, 401) && ok;
    });
  } finally {
    await finishDemo(pool, [EMAIL]);
  }
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
