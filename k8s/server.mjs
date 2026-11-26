import http from 'node:http';

const password = process.env.APP_DB_PASSWORD;
if (typeof password !== 'string' || password.length === 0) {
  console.error('APP_DB_PASSWORD is required');
  process.exit(1);
}

const role = process.env.CONTAINER_ROLE === 'sidecar' ? 'sidecar' : 'app';
const port = Number(process.env.PORT || (role === 'sidecar' ? 3001 : 3000));
const warmupMs = role === 'sidecar' ? 0 : Number(process.env.WARMUP_MS || 4000);
const drainMs = Number(process.env.DRAIN_MS || 10000);

let listening = false;
let draining = false;

function write(res, status, body, type) {
  res.writeHead(status, {
    'content-type': type,
    connection: 'close',
    'x-rev': process.env.REV || '',
    'x-role': role,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/healthz') {
    write(res, 200, '{"status":"ok"}', 'application/json');
    return;
  }
  if (path === '/readyz') {
    const ok = listening && !draining;
    write(res, ok ? 200 : 503, ok ? '{"ready":true}' : '{"ready":false}', 'application/json');
    return;
  }
  if (!listening) {
    write(res, 503, 'starting', 'text/plain');
    return;
  }
  write(res, 200, 'ok', 'text/plain');
});

function shutdown(signal) {
  if (draining) return;
  draining = true;
  console.error(`${signal}: readiness off, drain ${drainMs}ms, then close`);
  setTimeout(() => {
    if (!listening) {
      process.exit(0);
      return;
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }, drainMs);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

setTimeout(() => {
  if (draining) return;
  server.listen(port, '0.0.0.0', () => {
    listening = true;
    console.error(`listening port=${port} role=${role} rev=${process.env.REV || ''}`);
  });
}, warmupMs);
