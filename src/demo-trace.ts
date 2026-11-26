import { request, settleLogs, withObserveServer } from './observability/demo-host';
import { countOrphans, extractSpans, type FoundSpan } from './observability/spans';
import { newTraceParent } from './observability/traceparent';

const ORDER_ID = 'trace-order';

function emit(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollTrace(base: string, traceId: string): Promise<FoundSpan[]> {
  const deadline = Date.now() + 20_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/api/traces/${traceId}`, {
        headers: { accept: 'application/json' },
      });
      const text = await response.text();
      last = `${response.status} ${text.slice(0, 180)}`;
      if (response.ok && text) {
        const spans = extractSpans(JSON.parse(text) as unknown).filter(
          (span) => span.traceId === traceId,
        );
        if (spans.length > 0) return spans;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await delay(400);
  }
  console.error(`trace query failed: ${last}`);
  return [];
}

async function main(): Promise<void> {
  const traceApi = process.env.TRACE_API_URL?.trim();
  if (!traceApi) {
    emit('spans', 0);
    emit('orphan-spans', 1);
    emit('trace-matches-header', 0);
    emit('trace-matches-log', 0);
    emit('span-status-error', 0);
    console.error('TRACE_API_URL is required');
    process.exitCode = 1;
    return;
  }

  let ok = true;
  await withObserveServer(async (session) => {
    const trace = newTraceParent();
    const response = await request(session.base, `/orders/${ORDER_ID}`, {
      headers: {
        traceparent: trace.header,
        'x-demo-fail': '1',
        'x-user-id': 'user-trace',
        'x-tenant': 'marketplace',
      },
    });
    if (response.status !== 500) ok = false;

    const records = await settleLogs(
      session,
      (rows) => rows.some((row) => row.orderId === ORDER_ID && row.trace_id === trace.traceId),
    );
    const flushed = await fetch(`${session.base}/debug/flush`, { method: 'POST' });
    if (!flushed.ok && flushed.status !== 204) ok = false;
    const spans = await pollTrace(traceApi, trace.traceId);
    const logIds = records
      .filter((row) => row.orderId === ORDER_ID && typeof row.trace_id === 'string')
      .map((row) => row.trace_id as string);
    const spanTrace = spans[0]?.traceId;
    const matchesHeader =
      spans.length > 0 && spans.every((span) => span.traceId === trace.traceId) ? 1 : 0;
    const matchesLog =
      logIds.length > 0 &&
      spanTrace !== undefined &&
      logIds.every((id) => id === spanTrace) &&
      spanTrace === trace.traceId
        ? 1
        : 0;
    const orphans = countOrphans(spans, trace.parentId);
    const statusError = spans.some((span) => span.statusError) ? 1 : 0;

    emit('spans', spans.length);
    emit('orphan-spans', orphans);
    emit('trace-matches-header', matchesHeader);
    emit('trace-matches-log', matchesLog);
    emit('span-status-error', statusError);

    if (
      spans.length < 2 ||
      orphans !== 0 ||
      matchesHeader !== 1 ||
      matchesLog !== 1 ||
      statusError !== 1
    ) {
      ok = false;
    }
  });
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
