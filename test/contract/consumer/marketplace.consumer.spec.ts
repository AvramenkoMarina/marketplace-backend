import { MatchersV3, PactV4, SpecificationVersion } from '@pact-foundation/pact';
import { PACT_CONSUMER, PACT_DIR, PACT_PROVIDER, PRODUCT_EXISTS } from '../pact';

const { like, integer, regex } = MatchersV3;

const provider = new PactV4({
  consumer: PACT_CONSUMER,
  provider: PACT_PROVIDER,
  dir: PACT_DIR,
  spec: SpecificationVersion.SPECIFICATION_VERSION_V3,
  logLevel: 'info',
});

describe('MarketplaceWeb consumer contract', () => {
  it('gets a product that the provider state says exists', async () => {
    await provider
      .addInteraction()
      .given(PRODUCT_EXISTS)
      .uponReceiving('a request for product 1')
      .withRequest('GET', '/products/1', (builder) => {
        builder.headers({ Accept: 'application/json' });
      })
      .willRespondWith(200, (builder) => {
        builder.headers({
          'Content-Type': regex(
            'application/json.*',
            'application/json; charset=utf-8',
          ),
        });
        builder.jsonBody({
          id: like('1'),
          name: like('Notebook'),
          price_cents: integer(129900),
        });
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/products/1`, {
          headers: { Accept: 'application/json' },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          id: string;
          name: string;
          price_cents: number;
        };
        expect(body).toEqual({
          id: '1',
          name: 'Notebook',
          price_cents: 129900,
        });
      });
  });
});
