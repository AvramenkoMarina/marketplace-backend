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
      // SSE is not a JSON operation: validating it would 404 the stream or
      // buffer it until the client disconnects. socket.io is ignored for the
      // same reason; the demo connects with the websocket transport.
      ignorePaths:
        /^(?:\/health|\/db\/ping|\/socket\.io(?:\/.*)?|\/orders\/[^/]+\/events|\/auth(?:\/.*)?|\/account(?:\/.*)?|\/uploads(?:\/.*)?)(?:\?|$)/,
    }),
  );
}

export function configureNestApp(app: INestApplication): void {
  app.useGlobalFilters(new ProblemJsonFilter());
}
