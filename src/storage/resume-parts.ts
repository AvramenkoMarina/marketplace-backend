import { readFileSync, writeFileSync } from 'node:fs';
import { createS3, listAllParts, readStorageSettings } from './client';

type PartPlan = {
  key: string;
  uploadId: string;
  partSize: number;
  filePath: string;
  resultPath: string;
  parts: { partNumber: number; url: string }[];
};

/**
 * Second process after a crash. ListParts is the source of truth: only parts
 * the server does not already have are uploaded.
 */
async function main(): Promise<void> {
  const plan = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as PartPlan;
  const settings = readStorageSettings(process.env);
  const client = createS3(settings);
  try {
    const listed = await listAllParts(client, settings.bucket, plan.key, plan.uploadId);
    const have = new Set(listed.map((part) => part.PartNumber));
    const file = readFileSync(plan.filePath);
    let uploaded = 0;
    for (const part of plan.parts) {
      if (have.has(part.partNumber)) continue;
      const start = (part.partNumber - 1) * plan.partSize;
      const body = file.subarray(start, Math.min(start + plan.partSize, file.length));
      const res = await fetch(part.url, {
        method: 'PUT',
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const text = await res.text();
        process.stderr.write(`part ${part.partNumber} status ${res.status} ${text.slice(0, 400)}`);
        process.exit(1);
      }
      await res.arrayBuffer().catch(() => undefined);
      uploaded += 1;
    }
    writeFileSync(plan.resultPath, String(uploaded));
  } finally {
    client.destroy();
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
