# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

WORKDIR /src

COPY package.json package-lock.json ./

# Token is a BuildKit secret mount. It is not an ARG, not a copied file, and not an ENV.
RUN --mount=type=secret,id=npm_token,required=true \
    sh -eu -c 'test -s /run/secrets/npm_token && npm ci --omit=dev --ignore-scripts'

COPY k8s/server.mjs ./server.mjs

RUN node --check server.mjs

FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

COPY --from=build --chown=65532:65532 /src/server.mjs /app/server.mjs

USER 65532

ENV NODE_ENV=production \
    PORT=3000 \
    WARMUP_MS=4000 \
    DRAIN_MS=10000

EXPOSE 3000

CMD ["server.mjs"]
