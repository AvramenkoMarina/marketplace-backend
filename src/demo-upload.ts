import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import {
  call,
  DEMO_PASSWORD,
  finishDemo,
  openDemoPool,
  prepareDemo,
  tokenPair,
  withHttpApp,
} from './auth/demo-support';
import { filesUpStatements } from './storage/files-ddl';
import { PRESIGN_TTL_SECONDS } from './storage/constants';
import {
  createS3,
  ensureBucket,
  presignPut,
  readStorageSettings,
  resetPrefix,
  tamperObjectKey,
} from './storage/client';
import { emit } from './storage/emit';
import { runNode, sealedEnv } from './storage/run-process';

const EMAIL = 'hw26-upload@demo.marketplace';
const FILENAME = '../../etc/passwd';
const PORT_A = 3471;
const PORT_B = 3472;
const BYTES = Buffer.from('png-demo');

type IntentJson = { id?: string; key?: string; url?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tcpOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function serverChoseKey(key: string): number {
  if (!key || key.includes(FILENAME) || key.includes('..') || key.includes('passwd')) return 0;
  return /^uploads\/\d+\/[0-9a-f-]{36}\.png$/.test(key) ? 1 : 0;
}

async function isolatedPut(url: string, contentType: string, file: string): Promise<number> {
  const result = await runNode(
    'dist/storage/isolated-put.js',
    [url, contentType, file],
    sealedEnv(),
    30_000,
  );
  if (result.code !== 0) {
    throw new Error(`isolated put failed: ${result.stderr || result.stdout}`);
  }
  const status = Number(result.stdout.trim());
  if (!Number.isInteger(status)) {
    throw new Error(`isolated put returned no status: ${result.stderr}`);
  }
  return status;
}

async function main(): Promise<void> {
  const settings = readStorageSettings(process.env);
  const client = createS3(settings);
  const dir = mkdtempSync(join(tmpdir(), 'hw26-upload-'));
  const file = join(dir, 'avatar.png');
  writeFileSync(file, BYTES);
  let ok = true;
  let pool: Awaited<ReturnType<typeof prepareDemo>> | undefined;
  try {
    const prep = openDemoPool();
    for (const sql of filesUpStatements) await prep.query(sql);
    await prep.query(
      `DELETE FROM files WHERE owner_id IN (SELECT id FROM users WHERE email = $1)`,
      [EMAIL],
    );
    await prep.end();
    pool = await prepareDemo([{ email: EMAIL, role: 'buyer' }]);
    await ensureBucket(client, settings.bucket);
    await resetPrefix(client, settings.bucket, 'uploads/');

    let intentUrl = '';
    let intentId = '';
    let emptyId = '';

    await withHttpApp(PORT_A, async (base) => {
      const login = await call(base, 'POST', '/auth/login', {
        body: { email: EMAIL, password: DEMO_PASSWORD },
      });
      const token = tokenPair(login.body).access;
      const intent = await call(base, 'POST', '/uploads/intent', {
        token,
        body: { filename: FILENAME, contentType: 'image/png', size: BYTES.length },
      });
      ok = emit('intent', intent.status, (n) => n === 200) && ok;
      const body = (intent.body ?? {}) as IntentJson;
      intentUrl = body.url ?? '';
      intentId = body.id ?? '';
      ok = emit('key-from-server', serverChoseKey(body.key ?? ''), (n) => n === 1) && ok;

      const empty = await call(base, 'POST', '/uploads/intent', {
        token,
        body: { filename: FILENAME, contentType: 'image/png', size: 4 },
      });
      emptyId = ((empty.body ?? {}) as IntentJson).id ?? '';
      if (empty.status !== 200 || !emptyId) {
        throw new Error(`empty intent failed: ${empty.status}`);
      }
    });

    let alive = true;
    for (let i = 0; i < 20; i += 1) {
      alive = await tcpOpen(PORT_A);
      if (!alive) break;
      await sleep(100);
    }
    ok = emit('api-alive', alive ? 1 : 0, (n) => n === 0) && ok;

    const putStatus = await isolatedPut(intentUrl, 'image/png', file);
    ok = emit('put-offline', putStatus, (n) => n === 200) && ok;

    const tampered = await isolatedPut(tamperObjectKey(intentUrl), 'image/png', file);
    ok = emit('tampered', tampered, (n) => n === 403) && ok;

    const shortLived = await presignPut(
      client,
      settings.bucket,
      'uploads/expiry-probe.bin',
      'application/octet-stream',
      1,
    );
    await sleep(3_000);
    const probe = join(dir, 'probe.bin');
    writeFileSync(probe, Buffer.from('x'));
    const expired = await isolatedPut(shortLived, 'application/octet-stream', probe);
    ok = emit('expired', expired, (n) => n === 403) && ok;

    // A fresh port: undici keeps a dead socket for the (host, port) we just stopped.
    await withHttpApp(PORT_B, async (base) => {
      const login = await call(base, 'POST', '/auth/login', {
        body: { email: EMAIL, password: DEMO_PASSWORD },
      });
      const token = tokenPair(login.body).access;
      const commit = await call(base, 'POST', '/uploads/commit', {
        token,
        body: { id: intentId },
      });
      if (commit.status !== 200) {
        process.stderr.write(`commit body ${JSON.stringify(commit.body)}\n`);
      }
      ok = emit('commit', commit.status, (n) => n === 200) && ok;

      const missing = await call(base, 'POST', '/uploads/commit', {
        token,
        body: { id: emptyId },
      });
      ok = emit('commit-without-bytes', missing.status, (n) => n >= 400 && n < 500) && ok;
    });

    if (PRESIGN_TTL_SECONDS < 60) {
      throw new Error('product presign TTL must stay on the order of minutes');
    }
  } finally {
    if (pool) await finishDemo(pool, [EMAIL]);
    client.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
