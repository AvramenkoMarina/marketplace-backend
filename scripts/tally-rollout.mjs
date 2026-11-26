import fs from 'node:fs';

const lines = fs
  .readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter((line) => line.length > 0);
const requests = lines.length;
const ok = lines.filter((line) => line === '200').length;
const failed = requests - ok;
const seconds = Number(process.argv[3]);

if (failed > 0) {
  const counts = {};
  for (const line of lines) counts[line] = (counts[line] || 0) + 1;
  console.error(`codes ${JSON.stringify(counts)}`);
}

console.log('profile=correct');
console.log(`requests=${requests}`);
console.log(`ok=${ok}`);
console.log(`failed=${failed}`);
console.log(`rollout-seconds=${Number.isFinite(seconds) ? seconds : 0}`);
process.exit(failed === 0 && requests >= 5000 ? 0 : 1);
