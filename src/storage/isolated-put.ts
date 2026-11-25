/**
 * PUT bytes to a presigned URL. This process is started with an environment
 * that has no storage keys: the URL is the only credential.
 */
async function main(): Promise<void> {
  const url = process.argv[2];
  const contentType = process.argv[3] ?? '';
  const file = process.argv[4];
  if (!url || !file) {
    process.stderr.write('usage: isolated-put <url> <content-type|-> <file>\n');
    process.exit(2);
  }
  const { readFileSync } = await import('node:fs');
  const body = readFileSync(file);
  const headers: Record<string, string> = {};
  if (contentType && contentType !== '-') headers['content-type'] = contentType;
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    process.stderr.write(text.slice(0, 500));
  }
  process.stdout.write(String(res.status));
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
