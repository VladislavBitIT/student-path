import { loadRuntimeConfig } from '@first30/config';
import { createLlmAdapter } from '@first30/domain';

if (!process.env.LLM_API_KEY || !process.env.LLM_PROJECT_ID) {
  console.error('LLM smoke not started: LLM_API_KEY and LLM_PROJECT_ID are required');
  process.exit(2);
}

const config = loadRuntimeConfig({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://smoke:smoke@127.0.0.1:5432/smoke',
  SESSION_SECRET: 'llm-smoke-session-secret-not-used-by-the-test',
  ALLOWED_ORIGINS: 'http://localhost:4173',
  MAX_PROVIDER: 'mock',
  MAX_UPDATE_MODE: 'mock',
  LLM_PROVIDER: 'alice',
});

let requestCompleted = false;
let responseStatus: number | undefined;
let providerOutcome: 'validated' | 'fallback' | undefined;
const trackedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  requestCompleted = true;
  responseStatus = response.status;
  return response;
};
const adapter = createLlmAdapter({
  provider: config.llmProvider,
  baseUrl: config.llmBaseUrl,
  apiKey: config.llmApiKey,
  projectId: config.llmProjectId,
  model: config.llmModel,
  timeoutMs: config.llmTimeoutMs,
  maxOutputTokens: config.llmMaxOutputTokens,
  fetchImpl: trackedFetch,
  onProviderResult: (outcome) => {
    providerOutcome = outcome;
  },
});

const result = await adapter.answerFromContext({
  question: 'Who is the official contact for international student questions?',
  language: 'en',
  context: [
    {
      documentId: 'smoke-document',
      sourceId: 'smoke-source',
      title: 'Student support office',
      content: 'The student support office is the official contact for international student questions.',
      validAsOf: '2026-09-22',
    },
  ],
});

if (!requestCompleted || responseStatus !== 200) {
  throw new Error(`Alice LLM request failed${responseStatus ? ` with HTTP ${responseStatus}` : ''}`);
}
if (providerOutcome !== 'validated') {
  throw new Error('Alice LLM response did not pass strict validation');
}
if (result.status !== 'grounded' || !result.answer || !result.usedSourceIds.includes('smoke-source')) {
  throw new Error('Alice LLM returned an invalid or ungrounded result');
}
requestCompleted = false;
responseStatus = undefined;
providerOutcome = undefined;
const russianResult = await adapter.answerFromContext({
  question: 'Как подготовиться к приезду?',
  language: 'ru',
  context: [
    {
      documentId: 'smoke-document-ru',
      sourceId: 'smoke-source-ru',
      title: 'Подготовка к приезду',
      content: 'Перед приездом проверьте письмо о поступлении и актуальную памятку университета.',
      validAsOf: '2026-09-22',
    },
  ],
});
if (!requestCompleted || responseStatus !== 200 || providerOutcome !== 'validated') {
  throw new Error('Alice Russian response did not pass provider validation');
}
if (
  russianResult.status !== 'grounded' ||
  !russianResult.answer ||
  !russianResult.usedSourceIds.includes('smoke-source-ru')
) {
  throw new Error('Alice Russian response did not pass grounding validation');
}
for (const { question, previousAnswer } of [
  { question: 'Как обычно подготовиться к переезду после зачисления?' },
  { question: 'How should I prepare to move for university?' },
  { question: 'विश्वविद्यालय जाने से पहले क्या तैयारी करूँ?' },
  { question: 'كيف أستعد للانتقال إلى الجامعة؟' },
  { question: 'Кто выиграл вчерашний футбольный матч?' },
  { question: 'А что потом?', previousAnswer: 'Сначала подготовьте документы для переезда.' },
]) {
  requestCompleted = false;
  responseStatus = undefined;
  providerOutcome = undefined;
  const general = await adapter.answerFromContext({
    question,
    language: 'ru',
    context: [],
    previousAnswer,
    profile: {
      university: 'ИТМО',
      city: 'Санкт-Петербург',
      citizenship: 'foreign',
      arrivalStatus: 'preparing',
      accommodation: 'unknown',
    },
  });
  const expectedStatus = question.includes('футбольный') ? 'off_topic' : 'general';
  if (
    (expectedStatus !== 'off_topic' &&
      (!requestCompleted || responseStatus !== 200 || providerOutcome !== 'validated')) ||
    general.status !== expectedStatus ||
    !general.answer ||
    general.usedSourceIds.length > 0
  ) {
    throw new Error('Alice source-free response did not pass validation');
  }
}
console.info('Alice LLM smoke passed');
