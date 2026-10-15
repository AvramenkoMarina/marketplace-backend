import 'reflect-metadata';
import { createDataSource } from './data-source';
import { runWorker } from './worker';

const TASKS = 20;
const WORKERS = 4;
const WORK_MS = 80;

async function main(): Promise<void> {
  const dataSource = createDataSource({ poolSize: WORKERS + 2 });
  await dataSource.initialize();
  try {
    const kind = `demo-work-${Date.now()}`;
    for (let i = 0; i < TASKS; i += 1) {
      await dataSource.query(
        `INSERT INTO tasks (kind, status, processed) VALUES ($1, 'pending', 0)`,
        [kind],
      );
    }

    const started = Date.now();
    const counts = await Promise.all(
      Array.from({ length: WORKERS }, (_, index) =>
        runWorker(dataSource, `w${index + 1}`, kind, WORK_MS),
      ),
    );
    const elapsedMs = Date.now() - started;
    const sequentialMs = TASKS * WORK_MS;

    const doubledRows: Array<{ n: number }> = await dataSource.query(
      `SELECT count(*)::int AS n FROM tasks WHERE kind = $1 AND processed > 1`,
      [kind],
    );
    const doneRows: Array<{ n: number }> = await dataSource.query(
      `SELECT count(*)::int AS n FROM tasks WHERE kind = $1 AND status = 'done' AND processed = 1`,
      [kind],
    );
    const doubled = Number(doubledRows[0].n);
    const done = Number(doneRows[0].n);

    counts.forEach((count, index) => {
      console.log(`воркер w${index + 1}: ${count}`);
    });
    console.log(`оброблено двічі: ${doubled}`);
    console.log(`час: ${elapsedMs} мс`);
    console.log(`послідовно: ${sequentialMs} мс`);

    const activeWorkers = counts.filter((count) => count > 0).length;
    if (doubled !== 0 || done !== TASKS || activeWorkers < 2 || elapsedMs >= sequentialMs) {
      throw new Error(
        `worker invariant failed: doubled=${doubled} done=${done} active=${activeWorkers} elapsed=${elapsedMs} sequential=${sequentialMs}`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
