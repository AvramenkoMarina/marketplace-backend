import http from 'node:http';
import fs from 'node:fs';

const url = process.argv[2];
const outPath = process.argv[3];
const stopPath = process.argv[4];
const workers = 6;
const gapMs = 40;

if (!url || !outPath || !stopPath) {
  console.error('usage: node loadgen.mjs URL OUT STOPFILE');
  process.exit(2);
}

const fd = fs.openSync(outPath, 'a');

function hit() {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false, timeout: 2000 }, (res) => {
      res.resume();
      fs.writeSync(fd, `${res.statusCode || 0}\n`);
      resolve();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => {
      fs.writeSync(fd, '000\n');
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop() {
  for (;;) {
    if (fs.existsSync(stopPath)) break;
    const started = Date.now();
    await hit();
    const wait = gapMs - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
}

Promise.all(Array.from({ length: workers }, () => loop())).then(() => {
  fs.closeSync(fd);
  process.exit(0);
});
