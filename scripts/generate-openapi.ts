import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadRuntimeConfig } from '@first30/config';
import { createDatabase } from '@first30/database';
import { buildApp } from '../apps/api/src/app.js';

const config = loadRuntimeConfig({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://openapi:openapi@localhost:5432/openapi',
  MAX_PROVIDER: 'mock',
  MAX_UPDATE_MODE: 'mock',
});
const database = createDatabase(config.databaseUrl);
const app = await buildApp({ config, database, logger: false, closeDatabaseOnClose: false });
await app.ready();
const target = resolve(process.cwd(), 'openapi.json');
const generated = `${JSON.stringify(app.swagger(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== generated) throw new Error('openapi.json is out of date; run pnpm openapi:generate');
} else {
  await writeFile(target, generated, 'utf8');
}
await app.close();
await database.close();
console.info(process.argv.includes('--check') ? 'openapi.json is up to date' : 'Generated openapi.json');
