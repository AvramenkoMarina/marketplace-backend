import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { ProblemJsonFilter } from './common/problem-json.filter';

export function configureHttpServer(server: express.Express): void {
  server.use(express.json({ strict: true }));
  server.use(
    OpenApiValidator.middleware({
      apiSpec: join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
      ignorePaths: /^(?:\/health|\/db\/ping)(?:\?|$)/,
    }),
  );
}

export function configureNestApp(app: INestApplication): void {
  app.useGlobalFilters(new ProblemJsonFilter());
}
