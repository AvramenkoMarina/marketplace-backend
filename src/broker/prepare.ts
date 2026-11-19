import type { Pool } from 'pg';
import { clearEffects, ensureEffectsTable } from './effect-store';
import { resetBroker } from './topology';

export async function prepareDemo(pool: Pool): Promise<void> {
  await ensureEffectsTable(pool);
  await clearEffects(pool);
  await resetBroker();
}
