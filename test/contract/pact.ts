import { join } from 'node:path';

export const PACT_CONSUMER = 'MarketplaceWeb';
export const PACT_PROVIDER = 'MarketplaceAPI';
export const PRODUCT_EXISTS = 'product 1 exists';

export const PACT_DIR = join(process.cwd(), 'pacts');

export function pactFilePath(): string {
  return join(PACT_DIR, `${PACT_CONSUMER}-${PACT_PROVIDER}.json`);
}
