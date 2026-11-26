export type LogRecord = {
  layer?: string;
  trace_id?: string;
  span_id?: string;
  orderId?: string;
  msg?: string;
  listenPort?: number;
  userId?: string;
  tenant?: string;
  idempotencyKey?: string;
  req?: {
    method?: string;
    url?: string;
    headers?: { authorization?: string };
    body?: { password?: string; email?: string; refresh_token?: string };
  };
};

export function parseLogs(raw: string): { records: LogRecord[]; nonJson: number } {
  const records: LogRecord[] = [];
  let nonJson = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as LogRecord);
    } catch {
      nonJson += 1;
    }
  }
  return { records, nonJson };
}
