import fs from 'node:fs';
import path from 'node:path';

const dockerfile = process.argv[2];
const historyPath = process.argv[3];
const inspectPath = process.argv[4];
const saveDir = process.argv[5];
const tokenPath = process.argv[6];
const shellInside = process.env.SHELL_INSIDE;

if (shellInside !== '0' && shellInside !== '1') {
  console.error('SHELL_INSIDE must be 0 or 1');
  process.exit(1);
}

const token = fs.readFileSync(tokenPath, 'utf8').trim();
if (!token) {
  console.error('build token file is empty');
  process.exit(1);
}

function count(haystack) {
  let n = 0;
  let from = 0;
  while (from <= haystack.length - token.length) {
    const at = haystack.indexOf(token, from);
    if (at === -1) break;
    n += 1;
    from = at + token.length;
  }
  return n;
}

const stages = fs
  .readFileSync(dockerfile, 'utf8')
  .split('\n')
  .filter((line) => /^\s*FROM\s+/.test(line)).length;

const tokenInHistory = count(fs.readFileSync(historyPath, 'utf8'));
const inspected = JSON.parse(fs.readFileSync(inspectPath, 'utf8'));
const config = inspected[0] && inspected[0].Config ? inspected[0].Config : {};
const tokenInConfig = count(JSON.stringify(config));
const uid = config.User == null ? '' : String(config.User);

const manifestPath = path.join(saveDir, 'manifest.json');
const layerPaths = [];
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const item of manifest) {
    for (const layer of item.Layers || []) layerPaths.push(path.join(saveDir, layer));
  }
}

let tokenInLayers = 0;
for (const layer of layerPaths) {
  if (!fs.existsSync(layer)) continue;
  const bytes = fs.readFileSync(layer);
  if (bytes.includes(Buffer.from(token))) tokenInLayers += 1;
}

console.log(`stages=${stages}`);
console.log(`shell-inside=${shellInside}`);
console.log(`runtime-uid=${uid}`);
console.log(`token-in-history=${tokenInHistory}`);
console.log(`token-in-config=${tokenInConfig}`);
console.log(`token-in-layers=${tokenInLayers}`);
