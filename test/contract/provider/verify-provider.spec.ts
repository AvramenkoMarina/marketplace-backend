import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Verifier, type VerifierOptions } from '@pact-foundation/pact';
import { DatabaseService } from '../../../src/database/database.service';
import { OrderRepository } from '../../../src/repositories/order.repository';
import { UserRepository } from '../../../src/repositories/user.repository';
import { bootApp } from '../../support/boot-app';
import { startPostgres, type RunningPostgres } from '../../integration/testkit/postgres';
import { PACT_PROVIDER, PRODUCT_EXISTS, pactFilePath } from '../pact';

const PACT_SELLER_EMAIL = 'pact-seller@example.com';

describe('MarketplaceAPI provider verification', () => {
  let db: RunningPostgres;
  let app: INestApplication;

  beforeAll(async () => {
    db = await startPostgres();
    app = await bootApp(db);
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('matches the published consumer interactions', async () => {
    const address = app.getHttpServer().address() as AddressInfo;
    const brokerUrl = process.env.PACT_BROKER_URL;
    const brokerToken = process.env.PACT_BROKER_TOKEN;
    const database = app.get(DatabaseService);

    const options: VerifierOptions = {
      provider: PACT_PROVIDER,
      providerBaseUrl: `http://127.0.0.1:${address.port}`,
      logLevel: 'debug',
      failIfNoPactsFound: true,
      providerVersion: process.env.PACT_PROVIDER_VERSION ?? 'dev',
      stateHandlers: {
        [PRODUCT_EXISTS]: async () => {
          const users = new UserRepository(database);
          const orders = new OrderRepository(database);
          await users.insertIgnoreConflict({
            email: PACT_SELLER_EMAIL,
            displayName: 'Pact Seller',
            balanceCents: 0,
          });
          const seller = await users.findByEmail(PACT_SELLER_EMAIL);
          if (!seller) {
            throw new Error('provider state did not seed the seller');
          }
          await orders.insertProductIfAbsent({
            sellerId: seller.id,
            name: 'Notebook',
            description: 'Seeded for the product 1 provider state',
            priceCents: 129900,
            stock: 5,
          });
        },
      },
    };

    if (brokerUrl) {
      options.pactBrokerUrl = brokerUrl;
      options.publishVerificationResult = true;
      options.consumerVersionSelectors = [{ latest: true }];
      if (brokerToken) {
        options.pactBrokerToken = brokerToken;
      }
    } else {
      options.pactUrls = [pactFilePath()];
    }

    await new Verifier(options).verifyProvider();
  });
});
