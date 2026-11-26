import { request, withObserveServer } from './observability/demo-host';
import {
  DEMO_ROUTE,
  DURATION_HISTOGRAM,
  REQUEST_COUNTER,
} from './observability/metrics';
import {
  aboveTopBucket,
  errorDelta,
  parseSamples,
  seriesCount,
  sumNamed,
  type Sample,
} from './observability/prom';

const CARDINALITY = 100;
const OK_REQUESTS = 40;
const FAIL_REQUESTS = 15;

function emit(key: string, value: number): void {
  console.log(`${key}=${value}`);
}

async function scrape(base: string): Promise<Sample[]> {
  const response = await fetch(`${base}/metrics`);
  if (!response.ok) {
    throw new Error(`metrics scrape failed: ${response.status}`);
  }
  return parseSamples(await response.text());
}

async function main(): Promise<void> {
  let ok = true;
  await withObserveServer(async (session) => {
    const warm = await request(session.base, '/orders/warm');
    if (warm.status !== 200) ok = false;
    const beforeSeries = seriesCount(await scrape(session.base), REQUEST_COUNTER);

    let cardOk = 0;
    await Promise.all(
      Array.from({ length: CARDINALITY }, async (_, index) => {
        const response = await request(session.base, `/orders/card-${index}`);
        if (response.status === 200) cardOk += 1;
      }),
    );
    if (cardOk !== CARDINALITY) ok = false;
    const afterCardinality = await scrape(session.base);
    const afterSeries = seriesCount(afterCardinality, REQUEST_COUNTER);

    let sentOk = 0;
    let sentFail = 0;
    const counted: Array<Promise<void>> = [];
    for (let index = 0; index < OK_REQUESTS; index += 1) {
      counted.push(
        request(session.base, `/orders/ok-${index}`).then((response) => {
          if (response.status < 400) sentOk += 1;
          else if (response.status >= 500) sentFail += 1;
        }),
      );
    }
    for (let index = 0; index < FAIL_REQUESTS; index += 1) {
      counted.push(
        request(session.base, `/orders/fail-${index}`, {
          headers: { 'x-demo-fail': '1' },
        }).then((response) => {
          if (response.status < 400) sentOk += 1;
          else if (response.status >= 500) sentFail += 1;
        }),
      );
    }
    await Promise.all(counted);
    const after = await scrape(session.base);
    const counterDelta =
      sumNamed(after, REQUEST_COUNTER) - sumNamed(afterCardinality, REQUEST_COUNTER);
    const errors = errorDelta(afterCardinality, after, REQUEST_COUNTER);
    const overflow = aboveTopBucket(after, DURATION_HISTOGRAM, DEMO_ROUTE);

    emit('sent-ok', sentOk);
    emit('sent-fail', sentFail);
    emit('counter-delta', counterDelta);
    emit('errors-delta', errors);
    emit('above-top-bucket', overflow);
    emit('series-before', beforeSeries);
    emit('series-after', afterSeries);

    if (
      sentOk + sentFail < 50 ||
      counterDelta !== sentOk + sentFail ||
      errors !== sentFail ||
      overflow !== 0 ||
      afterSeries !== beforeSeries
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
