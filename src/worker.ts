import { DataSource } from 'typeorm';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claim one pending task of this kind and finish it inside the same transaction.
 * An empty SKIP LOCKED result means nothing is free right now, not that the queue is empty.
 */
export async function takeTask(
  dataSource: DataSource,
  workerId: string,
  kind: string,
  workMs: number,
): Promise<string | null> {
  return dataSource.transaction(async (manager) => {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id
       FROM tasks
       WHERE status = 'pending' AND kind = $1
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [kind],
    );
    if (rows.length === 0) {
      return null;
    }

    const taskId = rows[0].id;
    await sleep(workMs);
    await manager.query(
      `UPDATE tasks
       SET status = 'done',
           processed = processed + 1,
           worker_id = $2
       WHERE id = $1`,
      [taskId, workerId],
    );
    return taskId;
  });
}

export async function pendingCount(
  dataSource: DataSource,
  kind: string,
): Promise<number> {
  const rows: Array<{ n: number }> = await dataSource.query(
    `SELECT count(*)::int AS n FROM tasks WHERE status = 'pending' AND kind = $1`,
    [kind],
  );
  return Number(rows[0].n);
}

export async function runWorker(
  dataSource: DataSource,
  workerId: string,
  kind: string,
  workMs: number,
): Promise<number> {
  let handled = 0;
  for (;;) {
    const taskId = await takeTask(dataSource, workerId, kind, workMs);
    if (taskId) {
      handled += 1;
      continue;
    }
    const left = await pendingCount(dataSource, kind);
    if (left === 0) {
      return handled;
    }
    await sleep(15);
  }
}
