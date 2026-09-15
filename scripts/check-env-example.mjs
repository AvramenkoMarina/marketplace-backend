import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(root, '.env.example');
const schemaJs = resolve(root, 'dist/config/env.schema.js');
const schemaTs = resolve(root, 'src/config/env.schema.ts');

function keysFromExample(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim())
    .filter(Boolean);
}

function keysFromSchemaSource(src) {
  const objectMatch = src.match(/envSchema\s*=\s*z\.object\(\{([\s\S]*?)\}\)/);
  if (!objectMatch) {
    throw new Error('Cannot find envSchema = z.object({...}) in env.schema.ts');
  }
  const body = objectMatch[1];
  const keys = [];
  for (const m of body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)) {
    keys.push(m[1]);
  }
  return keys;
}

async function keysFromCompiled() {
  const mod = await import(pathToFileURL(schemaJs).href);
  if (Array.isArray(mod.ENV_KEYS) && mod.ENV_KEYS.length) {
    return mod.ENV_KEYS;
  }
  if (mod.envSchema?.shape) {
    return Object.keys(mod.envSchema.shape);
  }
  throw new Error('dist/config/env.schema.js has no ENV_KEYS / envSchema.shape');
}

async function main() {
  if (!existsSync(examplePath)) {
    console.error('.env.example is missing');
    process.exit(1);
  }

  const exampleKeys = keysFromExample(readFileSync(examplePath, 'utf8'));
  let schemaKeys;
  if (existsSync(schemaJs)) {
    schemaKeys = await keysFromCompiled();
  } else if (existsSync(schemaTs)) {
    schemaKeys = keysFromSchemaSource(readFileSync(schemaTs, 'utf8'));
  } else {
    console.error('env schema not found (src/config/env.schema.ts)');
    process.exit(1);
  }

  const schemaSet = new Set(schemaKeys);
  const exampleSet = new Set(exampleKeys);

  const missingInExample = schemaKeys.filter((k) => !exampleSet.has(k));
  const extraInExample = exampleKeys.filter((k) => !schemaSet.has(k));

  if (missingInExample.length || extraInExample.length) {
    if (missingInExample.length) {
      console.error('Missing in .env.example:', missingInExample.join(', '));
    }
    if (extraInExample.length) {
      console.error('Extra in .env.example (not in schema):', extraInExample.join(', '));
    }
    process.exit(1);
  }

  console.log(`check:env OK — ${schemaKeys.length} keys in sync`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
