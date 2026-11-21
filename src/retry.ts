export function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const wrapped = err as { code?: string; driverError?: { code?: string } };
  return wrapped.driverError?.code ?? wrapped.code;
}

export function isRetryablePgCode(code: string | undefined): boolean {
  return code === '40001' || code === '40P01';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Re-runs the whole transaction. Only serialization_failure (40001)
 * and deadlock_detected (40P01) are retried.
 */
export async function withRetry<T>(
  run: () => Promise<T>,
  log: (message: string) => void = console.log,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await run();
    } catch (err) {
      const code = pgErrorCode(err);
      if (!isRetryablePgCode(code)) {
        throw err;
      }
      const delayMs = 25 * attempt;
      log(`retry: ${code} attempt ${attempt} backoff ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}
