import { readFileSync } from 'node:fs';

type PartPlan = {
  filePath: string;
  partSize: number;
  only: number[];
  parts: { partNumber: number; url: string }[];
};

/**
 * Uploads the listed parts and then exits, the way a client dies mid-upload.
 * Presigned part URLs are the only credential; the parent strips the env.
 */
async function main(): Promise<void> {
  const plan = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as PartPlan;
  const file = readFileSync(plan.filePath);
  const wanted = new Set(plan.only);
  for (const part of plan.parts) {
    if (!wanted.has(part.partNumber)) continue;
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
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
