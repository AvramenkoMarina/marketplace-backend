import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { partCountFor, S3_MIN_PART_BYTES } from './storage/constants';
import {
  createS3,
  ensureBucket,
  headObject,
  readStorageSettings,
  resetPrefix,
} from './storage/client';
import { emit } from './storage/emit';
import { filesUpStatements } from './storage/files-ddl';
import { runNode, sealedEnv } from './storage/run-process';

const EMAIL = 'hw26-multipart@demo.marketplace';
const PORT = 3473;
const FILENAME = '../../etc/passwd';

type IntentJson = {
  id?: string;
  key?: string;
  uploadId?: string;
  partSize?: number;
  mode?: string;
  parts?: { partNumber: number; url: string }[];
};

async function main(): Promise<void> {
  const fileSize = S3_MIN_PART_BYTES * 2 + 1024;
  const expectedParts = partCountFor(fileSize);
  if (expectedParts !== 3) {
    throw new Error(`demo file must be 3 parts, got ${expectedParts}`);
  }

  const settings = readStorageSettings(process.env);
  const client = createS3(settings);
  const dir = mkdtempSync(join(tmpdir(), 'hw26-multipart-'));
  const filePath = join(dir, 'payload.bin');
  const file = randomBytes(fileSize);
  writeFileSync(filePath, file);
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

    await withHttpApp(PORT, async (base) => {
      const login = await call(base, 'POST', '/auth/login', {
        body: { email: EMAIL, password: DEMO_PASSWORD },
      });
      const token = tokenPair(login.body).access;
      const intent = await call(base, 'POST', '/uploads/intent', {
        token,
        body: {
          filename: FILENAME,
          contentType: 'application/octet-stream',
          size: fileSize,
        },
      });
      if (intent.status !== 200) {
        throw new Error(`intent ${intent.status} ${JSON.stringify(intent.body)}`);
      }
      const body = (intent.body ?? {}) as IntentJson;
      const parts = body.parts ?? [];
      if (body.mode !== 'multipart' || !body.key || !body.uploadId || !body.partSize) {
        throw new Error(`expected a multipart intent, got ${JSON.stringify({ mode: body.mode, parts: parts.length })}`);
      }
      if (parts.length !== 3 || body.key.includes('passwd') || body.key.includes('..')) {
        throw new Error(`multipart plan is wrong: parts=${parts.length} key=${body.key}`);
      }

      const crashPlan = join(dir, 'crash.json');
      writeFileSync(
        crashPlan,
        JSON.stringify({
          filePath,
          partSize: body.partSize,
          only: [1, 2],
          parts,
        }),
      );
      const crashed = await runNode(
        'dist/storage/upload-parts.js',
        [crashPlan],
        sealedEnv(),
        120_000,
      );
      if (crashed.code !== 0) {
        throw new Error(`part upload failed: ${crashed.stderr}`);
      }

      const before = await headObject(client, settings.bucket, body.key);
      ok = emit('head-before-complete', before.status, (n) => n === 404) && ok;

      const resultPath = join(dir, 'resumed.txt');
      const resumePlan = join(dir, 'resume.json');
      writeFileSync(
        resumePlan,
        JSON.stringify({
          key: body.key,
          uploadId: body.uploadId,
          partSize: body.partSize,
          filePath,
          resultPath,
          parts,
        }),
      );
      const resumed = await runNode(
        'dist/storage/resume-parts.js',
        [resumePlan],
        { ...process.env },
        120_000,
      );
      if (resumed.code !== 0) {
        throw new Error(`resume failed: ${resumed.stderr}`);
      }
      const resumedParts = Number(readFileSync(resultPath, 'utf8').trim());
      ok = emit('resumed-parts', resumedParts, (n) => n === 1) && ok;

      const complete = await call(base, 'POST', '/uploads/complete', {
        token,
        body: { id: body.id },
      });
      if (complete.status !== 200) {
        process.stderr.write(`complete body ${JSON.stringify(complete.body)}\n`);
      }
      ok = emit('complete', complete.status, (n) => n === 200) && ok;

      const after = await headObject(client, settings.bucket, body.key);
      ok = emit('size-match', after.size === file.length ? 1 : 0, (n) => n === 1) && ok;
      const etag = (after.etag ?? '').replace(/"/g, '');
      const md5 = createHash('md5').update(file).digest('hex');
      const multipartEtag = /-\d+$/.test(etag) && etag !== md5 ? 1 : 0;
      if (!multipartEtag) {
        process.stderr.write(`etag=${etag} md5=${md5}\n`);
      }
      ok = emit('etag-multipart', multipartEtag, (n) => n === 1) && ok;

      const commit = await call(base, 'POST', '/uploads/commit', {
        token,
        body: { id: body.id },
      });
      if (commit.status !== 200) {
        throw new Error(`commit after complete failed: ${commit.status} ${JSON.stringify(commit.body)}`);
      }
    });
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
