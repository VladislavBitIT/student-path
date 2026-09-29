import { setTimeout as delay } from 'node:timers/promises';
import { loadRuntimeConfig } from '@first30/config';
import { createDatabase, webhookInbox } from '@first30/database';
import { ApplicationWorker } from '@first30/application';
import { createLlmAdapter } from '@first30/domain';
import { normalizeMaxUpdate, RealMaxUpdatePoller } from '@first30/max-adapter';

const config = loadRuntimeConfig();
const connection = createDatabase(config.databaseUrl);
const worker = new ApplicationWorker(connection.db, {
  maxProvider: config.maxProvider,
  miniAppUrl: config.miniAppPublicUrl,
  maxBotUsername: config.maxBotUsername,
  introVideoTokens: { ru: config.maxIntroVideoRuToken, en: config.maxIntroVideoEnToken },
  llmAdapter: createLlmAdapter({
    provider: config.llmProvider,
    baseUrl: config.llmBaseUrl,
    apiKey: config.llmApiKey,
    projectId: config.llmProjectId,
    model: config.llmModel,
    timeoutMs: config.llmTimeoutMs,
    maxOutputTokens: config.llmMaxOutputTokens,
  }),
});
const controller = new AbortController();
let marker: string | undefined;
const poller =
  config.maxProvider === 'real' && config.maxUpdateMode === 'long_polling' && config.maxBotToken
    ? new RealMaxUpdatePoller(config.maxApiBaseUrl, config.maxBotToken)
    : undefined;

const stop = () => controller.abort();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

console.info(`Bot consumer started (${config.maxProvider}/${config.maxUpdateMode})`);
try {
  await worker.recoverStuckJobs();
  let lastRecoveryAt = Date.now();
  while (!controller.signal.aborted) {
    if (poller) {
      try {
        const page = await poller.poll(marker, controller.signal);
        for (const raw of page.updates) {
          const normalized = normalizeMaxUpdate(raw);
          await connection.db
            .insert(webhookInbox)
            .values({ providerUpdateKey: normalized.providerKey, payload: raw })
            .onConflictDoNothing();
        }
        marker = page.marker ?? marker;
      } catch (error) {
        if (!controller.signal.aborted) console.error(error instanceof Error ? error.message : 'Long polling failed');
      }
    }
    await worker.processInbox();
    if (Date.now() - lastRecoveryAt >= 60_000) {
      await worker.recoverStuckJobs();
      lastRecoveryAt = Date.now();
    }
    await delay(poller ? 250 : config.workerPollIntervalMs, undefined, { signal: controller.signal }).catch(
      () => undefined,
    );
  }
} finally {
  await connection.close();
  console.info('Bot consumer stopped');
}
