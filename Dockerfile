FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY openapi ./openapi
COPY scripts ./scripts
COPY .env.example ./

RUN npm ci && npm run build && npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/main.js"]
