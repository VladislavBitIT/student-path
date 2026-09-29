import { loadRuntimeConfig } from '@first30/config';
import { createDatabase } from '@first30/database';
import { buildApp } from './app.js';

const config = loadRuntimeConfig();
const database = createDatabase(config.databaseUrl);
const app = await buildApp({ config, database });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Stopping API');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: '0.0.0.0', port: config.apiPort });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
