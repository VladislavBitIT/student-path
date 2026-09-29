import { setTimeout as delay } from 'node:timers/promises';
import { loadRuntimeConfig } from '@first30/config';
import { createDatabase } from '@first30/database';
import { ApplicationWorker } from '@first30/application';
import { RealMaxClient } from '@first30/max-adapter';

const config = loadRuntimeConfig();
const connection = createDatabase(config.databaseUrl);
const maxClient =
  config.maxProvider === 'real' && config.maxBotToken
    ? new RealMaxClient(config.maxApiBaseUrl, config.maxBotToken)
    : undefined;
const worker = new ApplicationWorker(connection.db, {
  maxProvider: config.maxProvider,
  miniAppUrl: config.miniAppPublicUrl,
  maxBotUsername: config.maxBotUsername,
  introVideoTokens: { ru: config.maxIntroVideoRuToken, en: config.maxIntroVideoEnToken },
  maxClient,
});
const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

await worker.recoverStuckJobs();
console.info(`Reminder/outbox worker started (${config.maxProvider})`);
try {
  while (!controller.signal.aborted) {
    try {
      await worker.enqueueDueReminders();
      await worker.deliverOutbox();
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Worker tick failed');
    }
    await delay(config.workerPollIntervalMs, undefined, { signal: controller.signal }).catch(() => undefined);
  }
} finally {
  await connection.close();
  console.info('Reminder/outbox worker stopped');
}
