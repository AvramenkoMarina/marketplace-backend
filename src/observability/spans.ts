export type FoundSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  statusError: boolean;
};

export function extractSpans(body: unknown): FoundSpan[] {
  const found: FoundSpan[] = [];
  walk(body, found);
  const byId = new Map<string, FoundSpan>();
  for (const span of found) {
    if (!span.spanId) continue;
    const previous = byId.get(span.spanId);
    if (!previous || (!previous.statusError && span.statusError)) {
      byId.set(span.spanId, span);
    }
  }
  return [...byId.values()];
}

export function countOrphans(spans: FoundSpan[], remoteParent: string): number {
  const ids = new Set(spans.map((span) => span.spanId));
  let orphans = 0;
  for (const span of spans) {
    if (!span.parentSpanId) continue;
    if (span.parentSpanId === remoteParent) continue;
    if (!ids.has(span.parentSpanId)) orphans += 1;
  }
  return orphans;
}

function walk(node: unknown, found: FoundSpan[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, found);
    return;
  }
  const record = node as Record<string, unknown>;
  const span = asSpan(record);
  if (span) found.push(span);
  for (const value of Object.values(record)) walk(value, found);
}

function asSpan(record: Record<string, unknown>): FoundSpan | undefined {
  if (typeof record.traceId === 'string' && typeof record.spanId === 'string') {
    if (typeof record.name !== 'string' && record.status === undefined && typeof record.kind !== 'string') {
      return undefined;
    }
    return {
      traceId: normalizeId(record.traceId),
      spanId: normalizeId(record.spanId),
      parentSpanId: parentOf(record),
      name: typeof record.name === 'string' ? record.name : '',
      statusError: isErrorStatus(record),
    };
  }
  if (typeof record.traceID === 'string' && typeof record.spanID === 'string' && typeof record.operationName === 'string') {
    return {
      traceId: normalizeId(record.traceID),
      spanId: normalizeId(record.spanID),
      parentSpanId: parentOf(record),
      name: record.operationName,
      statusError: isErrorStatus(record),
    };
  }
  return undefined;
}

function parentOf(record: Record<string, unknown>): string {
  if (typeof record.parentSpanId === 'string' && record.parentSpanId.length > 0) {
    return normalizeId(record.parentSpanId);
  }
  if (!Array.isArray(record.references)) return '';
  for (const ref of record.references) {
    if (!ref || typeof ref !== 'object') continue;
    const item = ref as { refType?: string; spanID?: string; spanId?: string };
    if (item.refType && item.refType !== 'CHILD_OF') continue;
    const id = item.spanID ?? item.spanId;
    if (typeof id === 'string' && id.length > 0) return normalizeId(id);
  }
  return '';
}

function isErrorStatus(record: Record<string, unknown>): boolean {
  const status = record.status;
  if (status && typeof status === 'object') {
    const code = (status as { code?: unknown }).code;
    if (code === 2 || code === 'STATUS_CODE_ERROR' || code === 'ERROR') return true;
  }
  if (record.error === true) return true;
  if (!Array.isArray(record.tags)) return false;
  for (const tag of record.tags) {
    if (!tag || typeof tag !== 'object') continue;
    const item = tag as { key?: string; value?: unknown };
    if (item.key === 'error' && (item.value === true || item.value === 'true')) return true;
    if (item.key === 'otel.status_code' && item.value === 'ERROR') return true;
  }
  return false;
}

function normalizeId(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed)) return trimmed.toLowerCase();
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 16 || decoded.length === 8) return decoded.toString('hex');
  return trimmed.toLowerCase();
}
