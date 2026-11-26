import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { parseLogs, type LogRecord } from './logs';

export type ObserveSession = {
  base: string;
  records: () => LogRecord[];
  raw: () => string;
  nonJson: () => number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

export async function settleLogs(
  session: ObserveSession,
  ready: (records: LogRecord[]) => boolean,
): Promise<LogRecord[]> {
  const deadline = Date.now() + 3_000;
  let latest = session.records();
  while (Date.now() < deadline) {
    latest = session.records();
    if (ready(latest)) {
      await delay(40);
      return session.records();
    }
    await delay(20);
  }
  return latest;
}

export async function withObserveServer(
  fn: (session: ObserveSession) => Promise<void>,
): Promise<void> {
  const child = spawn(process.execPath, [resolve(process.cwd(), 'dist/observe-main.js')], {
    env: {
      ...process.env,
      PORT: '0',
      OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME ?? 'marketplace-api',
      OTEL_TRACES_SAMPLER: process.env.OTEL_TRACES_SAMPLER ?? 'parentbased_always_on',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  process.on('exit', kill);
  try {
    const port = await waitForListen(child, () => stdout, () => stderr);
    await fn({
      base: `http://127.0.0.1:${port}`,
      records: () => parseLogs(stdout).records,
      raw: () => stdout,
      nonJson: () => parseLogs(stdout).nonJson,
    });
  } finally {
    process.off('exit', kill);
    await stopChild(child);
  }
}

async function waitForListen(
  child: ChildProcess,
  stdout: () => string,
  stderr: () => string,
): Promise<number> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`observe server exited ${child.exitCode}\n${stderr()}\n${stdout()}`);
    }
    const found = parseLogs(stdout()).records.find(
      (record) => typeof record.listenPort === 'number',
    );
    if (found?.listenPort) return found.listenPort;
    await delay(40);
  }
  throw new Error(`observe server did not listen\n${stderr()}\n${stdout()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
  await exited;
  clearTimeout(timer);
}

export async function request(
  base: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number }> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body,
  });
  await response.arrayBuffer();
  return { status: response.status };
}
