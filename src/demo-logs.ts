import { randomBytes } from 'node:crypto';
import { request, settleLogs, withObserveServer } from './observability/demo-host';
import type { LogRecord } from './observability/logs';
import { newTraceParent } from './observability/traceparent';

const DEEP_ID = 'deep-order';
const BURST = 8;

function emit(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

function belongsTo(record: LogRecord, orderId: string): boolean {
  return record.orderId === orderId || record.req?.url === `/orders/${orderId}`;
}

async function main(): Promise<void> {
  let ok = true;
  const bearer = `bea${randomBytes(16).toString('hex')}`;
  const password = `pwd${randomBytes(16).toString('hex')}`;
  await withObserveServer(async (session) => {
    const deep = newTraceParent();
    const deepResponse = await request(session.base, `/orders/${DEEP_ID}`, {
      headers: {
        traceparent: deep.header,
        'x-user-id': 'user-deep',
        'x-tenant': 'marketplace',
        'idempotency-key': 'deep-key',
      },
    });
    if (deepResponse.status !== 200) ok = false;

    const burst = Array.from({ length: BURST }, (_, index) => ({
      ...newTraceParent(),
      orderId: `burst-${index}`,
      userId: `user-${index}`,
      key: `burst-${index}`,
    }));
    let sent = 0;
    await Promise.all(
      burst.map(async (item) => {
        const response = await request(session.base, `/orders/${item.orderId}`, {
          headers: {
            traceparent: item.header,
            'x-user-id': item.userId,
            'x-tenant': 'marketplace',
            'idempotency-key': item.key,
          },
        });
        if (response.status === 200) sent += 1;
      }),
    );

    const secretOrder = await request(session.base, '/orders/secret-order', {
      headers: {
        authorization: `Bearer ${bearer}`,
        traceparent: newTraceParent().header,
      },
    });
    const login = await request(session.base, '/auth/login', {
      method: 'POST',
      headers: { traceparent: newTraceParent().header },
      body: { email: 'hw29@demo.marketplace', password },
    });
    if (secretOrder.status !== 200 || login.status !== 401) ok = false;

    const records = await settleLogs(session, (rows) => {
      const deepRows = rows.filter((row) => belongsTo(row, DEEP_ID) && row.trace_id);
      const burstIds = new Set(burst.map((item) => item.traceId));
      const seen = new Set(rows.map((row) => row.trace_id).filter((id) => id && burstIds.has(id)));
      return deepRows.length >= 3 && seen.size >= sent && rows.some((row) => row.req?.url === '/auth/login');
    });

    const deepRows = records.filter((row) => belongsTo(row, DEEP_ID));
    const traceIds = new Set(
      deepRows.map((row) => row.trace_id).filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    const layers = new Set(
      deepRows.map((row) => row.layer).filter((layer): layer is string => typeof layer === 'string'),
    );
    const burstIds = new Set(burst.map((item) => item.traceId));
    const groups = new Map<string, number>();
    for (const row of records) {
      if (!row.trace_id || !burstIds.has(row.trace_id)) continue;
      groups.set(row.trace_id, (groups.get(row.trace_id) ?? 0) + 1);
    }
    const sizes = [...groups.values()];
    const uneven =
      sizes.length > 0 && sizes.every((size) => size === sizes[0])
        ? 0
        : sizes.filter((size) => size !== sizes[0]).length || 1;

    const raw = session.raw();
    const secretReqLogged =
      records.some((row) => row.req?.url === '/auth/login') &&
      records.some(
        (row) =>
          row.req?.url === '/orders/secret-order' &&
          row.req.headers !== undefined &&
          Object.prototype.hasOwnProperty.call(row.req.headers, 'authorization'),
      )
        ? 1
        : 0;
    const secretInLogs = raw.includes(bearer) || raw.includes(password) ? 1 : 0;
    const nonJson = session.nonJson();
    const distinct = traceIds.size;
    const matches = distinct === 1 && traceIds.has(deep.traceId) ? 1 : 0;

    emit('non-json-lines', nonJson);
    emit('layers', layers.size);
    emit('distinct-trace-ids', distinct);
    emit('trace-id-matches-header', matches);
    emit('burst', sent);
    emit('burst-trace-ids', groups.size);
    emit('burst-uneven', uneven);
    emit('secret-req-logged', secretReqLogged);
    emit('secret-in-logs', secretInLogs);

    if (
      nonJson !== 0 ||
      layers.size < 3 ||
      distinct !== 1 ||
      matches !== 1 ||
      sent < 8 ||
      groups.size !== sent ||
      uneven !== 0 ||
      secretReqLogged !== 1 ||
      secretInLogs !== 0
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
