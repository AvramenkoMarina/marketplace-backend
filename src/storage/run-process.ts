import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export function sealedEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin' };
}

export function runNode(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const program = resolve(process.cwd(), script);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [program, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}
