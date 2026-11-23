import { Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import { runDemo } from './broker/run-demo';
import { assertInvariant, printMetrics } from './outbox/demo-state';
import { durableRedis, redisConfig, requireEnv } from './redis/clients';

const QUEUE_NAME = 'hw23-rating';
const SCHEDULER_ID = 'catalog-refresh';
const JOB_ID = 'hw23-recalc-once';
const FAIL_UNTIL = 3;

type RatingJob = { productId: string };

function connection(): ConnectionOptions {
  return {
    url: requireEnv('REDIS_QUEUE_URL'),
    maxRetriesPerRequest: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const probe = durableRedis();
  const queue = new Queue<RatingJob>(QUEUE_NAME, {
    connection: connection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30, jitter: 0.2 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 3600 },
    },
  });
  let worker: Worker<RatingJob> | undefined;
  let events: QueueEvents | undefined;
  let attempts = 0;
  let scheduledRuns = 0;
  try {
    const policy = await redisConfig(probe, 'maxmemory-policy');
    await queue.removeJobScheduler(SCHEDULER_ID).catch(() => false);
    await queue.obliterate({ force: true });

    const jobOpts = {
      jobId: JOB_ID,
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 30, jitter: 0.2 },
    };
    await queue.add('recalculate', { productId: '42' }, jobOpts);
    await queue.add('recalculate', { productId: '42' }, jobOpts);
    const counts = await queue.getJobCounts('waiting', 'delayed', 'paused', 'active');
    const queued = counts.waiting + counts.delayed + counts.paused + counts.active;

    events = new QueueEvents(QUEUE_NAME, { connection: connection() });
    await events.waitUntilReady();
    worker = new Worker<RatingJob>(
      QUEUE_NAME,
      async (job) => {
        if (job.name === 'scheduled-refresh') {
          scheduledRuns += 1;
          return;
        }
        attempts += 1;
        if (attempts < FAIL_UNTIL) {
          throw new Error('rating upstream returned 503');
        }
      },
      { connection: connection(), concurrency: 1 },
    );
    worker.on('error', () => undefined);

    const job = await queue.getJob(JOB_ID);
    if (!job) throw new Error('deduped job is missing');
    await job.waitUntilFinished(events, 15_000);

    await queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: 200 },
      {
        name: 'scheduled-refresh',
        data: { productId: 'catalog' },
        opts: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 30, jitter: 0.2 },
        },
      },
    );
    const schedulers = await queue.getJobSchedulersCount();
    const deadline = Date.now() + 8_000;
    while (scheduledRuns < 2 && Date.now() < deadline) {
      await sleep(50);
    }

    const metrics = {
      'queue-noeviction': policy === 'noeviction' ? 1 : 0,
      attempts,
      completed: 1,
      added: 2,
      queued,
      schedulers,
      'scheduled-runs': scheduledRuns,
    };
    printMetrics(metrics);
    assertInvariant(
      'demo:queue',
      metrics['queue-noeviction'] === 1 &&
        metrics.attempts >= 3 &&
        metrics.completed === 1 &&
        metrics.added === 2 &&
        metrics.queued === 1 &&
        metrics.schedulers >= 1 &&
        metrics['scheduled-runs'] >= 2,
      metrics,
    );
  } finally {
    await queue.removeJobScheduler(SCHEDULER_ID).catch(() => false);
    await worker?.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await events?.close();
    await queue.close();
    probe.disconnect();
  }
}

runDemo(main);
