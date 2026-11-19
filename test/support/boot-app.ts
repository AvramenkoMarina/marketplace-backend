import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  applyAppDatabaseEnv,
  type RunningPostgres,
} from '../integration/testkit/postgres';

export async function bootApp(db: RunningPostgres): Promise<INestApplication> {
  applyAppDatabaseEnv(db);

  const { Test } = await import('@nestjs/testing');
  const { ExpressAdapter } = await import('@nestjs/platform-express');
  const express = (await import('express')).default;
  const { AppModule } = await import('../../src/app.module');
  const { configureHttpServer, configureNestApp } = await import(
    '../../src/app.setup'
  );

  const server = express();
  configureHttpServer(server);

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication(new ExpressAdapter(server), {
    bodyParser: false,
    logger: false,
  });
  configureNestApp(app);
  await app.init();
  return app;
}
