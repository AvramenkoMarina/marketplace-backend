import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import { AppModule } from './app.module';
import { configureHttpServer, configureNestApp } from './app.setup';
import type { Env } from './config/env.schema';

async function bootstrap() {
  const server = express();
  configureHttpServer(server);

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
    abortOnError: false,
  });
  configureNestApp(app);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  await app.listen(port);
  console.log(`Marketplace API listening on http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
