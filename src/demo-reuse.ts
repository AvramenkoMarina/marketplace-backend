import {
  DEMO_PASSWORD,
  call,
  finishDemo,
  prepareDemo,
  report,
  tokenPair,
  withHttpApp,
} from './auth/demo-support';

const EMAIL = 'hw24-reuse@demo.marketplace';
const PORT = 3412;

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

      const rotated = await call(base, 'POST', '/auth/refresh', {
        body: { refresh_token: first.refresh },
      });
      ok = report('r1-refresh', rotated.status, 200) && ok;
      const second = tokenPair(rotated.body);

      const reuse = await call(base, 'POST', '/auth/refresh', {
        body: { refresh_token: first.refresh },
      });
      ok = report('r1-reuse', reuse.status, 401) && ok;

      const after = await call(base, 'POST', '/auth/refresh', {
        body: { refresh_token: second.refresh },
      });
      ok = report('r2-after-reuse', after.status, 401) && ok;
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
