import type { Pool, PoolClient } from 'pg';
import { parseOrderPlaced, publishOrderPlaced, type OrderPlacedEvent } from '../broker/order-placed';

export class RelayCrashed extends Error {
  constructor() {
    super('relay stopped between publish and published_at');
    this.name = 'RelayCrashed';
  }
}

export type RelayOptions = {
  limit?: number;
  /** When set, only these aggregate ids are claimed. */
  aggregateIds?: string[];
  /**
   * Simulated process death after the broker has accepted the publish
   * and before UPDATE published_at. The open transaction rolls back.
   */
  crashAfterPublish?: boolean;
};

export type RelayResult = {
  published: number;
};

type OutboxRow = {
  id: string;
  aggregate_id: string;
  type: string;
  payload: unknown;
};

/**
 * One poll: claim unpublished rows on this client, publish, then mark them.
 * Publish stays before the mark. A failure after publish leaves the row
 * unpublished, so the next poll delivers it again.
 */
export async function relayOutbox(pool: Pool, options: RelayOptions = {}): Promise<RelayResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await claimUnpublished(client, options.limit ?? 20, options.aggregateIds ?? null);
    let published = 0;
    for (const row of rows) {
      await publishOrderPlaced(eventFromPayload(row.payload));
      published += 1;
      if (options.crashAfterPublish) {
        throw new RelayCrashed();
      }
      await client.query(
        `UPDATE outbox
         SET published_at = now(), attempts = attempts + 1
         WHERE id = $1`,
        [row.id],
      );
    }
    await client.query('COMMIT');
    return { published };
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}

async function claimUnpublished(
  client: PoolClient,
  limit: number,
  aggregateIds: string[] | null,
): Promise<OutboxRow[]> {
  const result = await client.query<OutboxRow>(
    `SELECT id, aggregate_id, type, payload
     FROM outbox
     WHERE published_at IS NULL
       AND ($2::text[] IS NULL OR aggregate_id = ANY($2::text[]))
     ORDER BY created_at, id
     FOR UPDATE SKIP LOCKED
     LIMIT $1`,
    [limit, aggregateIds],
  );
  return result.rows;
}

function eventFromPayload(payload: unknown): OrderPlacedEvent {
  const encoded = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const event = parseOrderPlaced(encoded);
  if (!event) {
    throw new Error('outbox payload is not an order.placed event');
  }
  return event;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection is already unusable.
  }
}
