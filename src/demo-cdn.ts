import type { Server } from 'node:http';
import { publishAsset } from './storage/assets';
import {
  createS3,
  ensureBucket,
  readStorageSettings,
  resetPrefix,
  type StorageSettings,
} from './storage/client';
import { emit } from './storage/emit';
import { startEdge } from './storage/edge';

const EDGE_PORT = 3474;

function objectUrl(settings: StorageSettings, key: string): string {
  const endpoint = settings.endpoint?.replace(/\/$/, '');
  if (!endpoint) throw new Error('direct check needs STORAGE_ENDPOINT');
  const path = [settings.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
  return `${endpoint}/${path}`;
}

async function main(): Promise<void> {
  const settings = readStorageSettings(process.env);
  const client = createS3(settings);
  let edge: Server | undefined;
  let ok = true;
  try {
    await ensureBucket(client, settings.bucket);
    await resetPrefix(client, settings.bucket, 'assets/');

    const v1 = Buffer.from('body{color:red}/*v1*/');
    const v2 = Buffer.from('body{color:blue}/*v2-deploy*/');
    const key1 = await publishAsset(client, settings.bucket, 'app.css', v1, 'text/css');
    edge = await startEdge({ port: EDGE_PORT, client, bucket: settings.bucket });
    const edgeBase = `http://127.0.0.1:${EDGE_PORT}`;

    const direct = await fetch(objectUrl(settings, key1), { signal: AbortSignal.timeout(10_000) });
    await direct.arrayBuffer().catch(() => undefined);
    ok = emit('direct', direct.status, (n) => n === 403) && ok;

    const miss = await fetch(`${edgeBase}/${key1}`, { signal: AbortSignal.timeout(10_000) });
    const missBody = Buffer.from(await miss.arrayBuffer());
    ok = emit('edge-miss', miss.status, (n) => n === 200) && ok;
    if (!missBody.equals(v1)) {
      throw new Error('edge miss did not return the uploaded bytes');
    }
    if ((miss.headers.get('x-cache') ?? '').toUpperCase() !== 'MISS') {
      throw new Error(`first edge response was ${miss.headers.get('x-cache')}`);
    }

    const hit = await fetch(`${edgeBase}/${key1}`, { signal: AbortSignal.timeout(10_000) });
    await hit.arrayBuffer().catch(() => undefined);
    ok = emit('edge-hit', hit.status, (n) => n === 200) && ok;
    ok = emit('cache-hit', (hit.headers.get('x-cache') ?? '').toUpperCase() === 'HIT' ? 1 : 0, (n) => n === 1) && ok;

    const key2 = await publishAsset(client, settings.bucket, 'app.css', v2, 'text/css');
    ok = emit('new-name', key1 !== key2 ? 1 : 0, (n) => n === 1) && ok;

    const next = await fetch(`${edgeBase}/${key2}`, { signal: AbortSignal.timeout(10_000) });
    const nextBody = Buffer.from(await next.arrayBuffer());
    ok = emit('new-url', next.status, (n) => n === 200) && ok;
    const changed = nextBody.equals(v2) && !nextBody.equals(v1) ? 1 : 0;
    ok = emit('content-changed', changed, (n) => n === 1) && ok;
  } finally {
    if (edge) {
      await new Promise<void>((resolve) => edge!.close(() => resolve()));
    }
    client.destroy();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
