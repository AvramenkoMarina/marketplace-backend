const s = require('../spec.json');
const M = ['get', 'post', 'put', 'patch', 'delete'];

const ops = Object.entries(s.paths).flatMap(([p, v]) =>
  Object.keys(v)
    .filter((m) => M.includes(m))
    .map((m) => [p, m]),
);

const idem = ops
  .flatMap(([p, m]) => s.paths[p][m].parameters ?? [])
  .find((x) => x.in === 'header' && /idempotency-key/i.test(x.name));

const resources = new Set(Object.keys(s.paths).map((p) => p.split('/')[1])).size;
const descLen = (idem?.description ?? '').trim().length;

console.log(
  'операцій:',
  ops.length,
  '· ресурсів:',
  resources,
);
console.log(
  'Idempotency-Key: required =',
  idem?.required,
  '· опис, символів =',
  descLen,
);

if (ops.length < 5 || resources < 2 || idem?.required !== true || descLen < 40) {
  process.exit(1);
}
