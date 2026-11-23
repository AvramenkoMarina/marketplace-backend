import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { authUpStatements } from './ddl';
import { hashPassword } from './password';
import type { UserRole } from './constants';

export const DEMO_PASSWORD = 'hw24-demo-password';

export function openDemoPool(): Pool {
  const dbUrl = process.env.DB_URL;
  const passwordFile = process.env.DB_PASSWORD_FILE;
  if (dbUrl && passwordFile) {
    const password = readFileSync(passwordFile, 'utf8').trim();
    const url = new URL(dbUrl);
    return new Pool({
      host: url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      database: url.pathname.replace(/^\//, ''),
      password,
      max: 2,
      connectionTimeoutMillis: 5000,
    });
  }
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
    });
  }
  throw new Error('DB_URL and DB_PASSWORD_FILE are required (or DATABASE_URL)');
}

export async function prepareDemo(
  users: { email: string; role: UserRole }[],
): Promise<Pool> {
  const pool = openDemoPool();
  for (const sql of authUpStatements) {
    await pool.query(sql);
  }
  for (const user of users) {
    await pool.query(`DELETE FROM users WHERE email = $1`, [user.email]);
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await pool.query(
      `INSERT INTO users (email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4)`,
      [user.email, user.email.split('@')[0], passwordHash, user.role],
    );
  }
  return pool;
}

export async function finishDemo(pool: Pool, emails: string[]): Promise<void> {
  await pool
    .query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails])
    .catch(() => undefined);
  await pool.end();
}

export function report(
  key: string,
  status: number,
  expected: number | readonly number[],
): boolean {
  console.log(`${key}=${status}`);
  const ok =
    typeof expected === 'number'
      ? status === expected
      : expected.includes(status);
  if (!ok) {
    const want = typeof expected === 'number' ? String(expected) : expected.join('|');
    console.error(`invariant failed: ${key} expected ${want}`);
  }
  return ok;
}

type CallResult = { status: number; body: unknown };

export async function call(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

export function tokenPair(body: unknown): { access: string; refresh: string } {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  return {
    access: typeof record.access_token === 'string' ? record.access_token : '',
    refresh: typeof record.refresh_token === 'string' ? record.refresh_token : '',
  };
}

export function tamperAccessToken(access: string): string {
  return execFileSync(
    process.execPath,
    [
      '-e',
      'const t=process.argv[1].split(".");const p=JSON.parse(Buffer.from(t[1],"base64url").toString());p.role="admin";t[1]=Buffer.from(JSON.stringify(p)).toString("base64url");console.log(t.join("."))',
      access,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withHttpApp(
  port: number,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const child = spawn(process.execPath, [resolve(process.cwd(), 'dist/main.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  };
  process.on('exit', kill);
  try {
    await waitForHealth(port, child, () => stderr);
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    process.off('exit', kill);
    await stopChild(child);
  }
}

async function waitForHealth(
  port: number,
  child: ChildProcess,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`app exited ${child.exitCode} before listen\n${stderr()}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(200);
  }
  throw new Error(`app did not become ready on :${port}\n${stderr()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(timer);
}
