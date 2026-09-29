import { afterEach, describe, expect, it, vi } from 'vitest';
import { AliceLlmAdapter, NoneLlmAdapter } from '../../packages/domain/src/index.js';

const input = {
  question: 'My email student@example.test and id 9223372036854775807: where is dormitory booking?',
  language: 'en' as const,
  context: [
    {
      documentId: 'internal-document-id',
      sourceId: 'internal-source-id',
      title: 'Dormitory booking',
      content: 'Check dormitory booking instructions on the official university page.',
      validAsOf: '2026-09-21',
    },
  ],
};

function adapter(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return new AliceLlmAdapter({
    baseUrl: 'https://ai.api.cloud.yandex.net/v1',
    apiKey: 'unit-test-key',
    projectId: 'project-id',
    model: 'aliceai-llm-flash',
    timeoutMs,
    maxOutputTokens: 256,
    fetchImpl,
  });
}

function response(output: unknown) {
  return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(output) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.useRealTimers());

describe('Alice LLM adapter', () => {
  it('uses Responses API structured output and sends no user or internal identifiers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        status: 'grounded',
        answer: 'Check the official dormitory booking instructions.',
        usedReferences: ['source_1'],
        validAsOf: '2026-09-21',
      }),
    );
    const result = await adapter(fetchMock).answerFromContext(input);

    expect(result).toMatchObject({
      status: 'grounded',
      answer: 'Check the official dormitory booking instructions.',
      nextAction: null,
      usedSourceIds: ['internal-source-id'],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://ai.api.cloud.yandex.net/v1/responses');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Api-Key unit-test-key');
    const body = String(init?.body);
    const safeInput = JSON.parse((JSON.parse(body) as { input: string }).input) as Record<string, unknown>;
    expect(body).toContain('gpt://project-id/aliceai-llm-flash');
    expect(body).toContain('source_1');
    expect(safeInput.question).toContain('where is dormitory booking?');
    expect(body).toContain('Ты — помощник приложения «Путь студента»');
    expect(body).toContain('dormitory');
    expect(body).toContain('booking');
    expect(body).not.toContain('student@example.test');
    expect(body).not.toContain('9223372036854775807');
    expect(body).not.toContain(input.question);
    expect(body).not.toContain('internal-document-id');
    expect(body).not.toContain('internal-source-id');
  });

  it('answers a general question without a source and sends only safe profile facets', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        status: 'general',
        answer: 'Можно заранее составить список дел и уточнить порядок в своём университете.',
        usedReferences: [],
        validAsOf: '',
      }),
    );
    const result = await adapter(fetchMock).answerFromContext({
      question: 'Я Иван Иванов, мой адрес ivan@example.test. Как подготовиться к переезду?',
      language: 'ru',
      context: [],
      profile: {
        university: 'ИТМО uni-secret@example.test',
        city: 'Санкт-Петербург',
        citizenship: 'foreign',
        citizenshipCountry: 'Индия',
        arrivalStatus: 'preparing',
        accommodation: 'unknown',
      },
    });
    expect(result).toMatchObject({ status: 'general', usedSourceIds: [], validAsOf: null });
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain('Как подготовиться к переезду?');
    expect(body).toContain('Санкт-Петербург');
    expect(body).toContain('Индия');
    expect(body).not.toContain('uni-secret@example.test');
    expect(body).not.toContain('Иван Иванов');
    expect(body).not.toContain('ivan@example.test');
  });

  it('rejects unsourced exact university claims and fabricated references', async () => {
    const noContext = { question: 'Когда заселение в общежитие?', language: 'ru' as const, context: [] };
    const exactClaim = vi.fn<typeof fetch>(async () =>
      response({ status: 'general', answer: 'Заселение 25.09.2026.', usedReferences: [], validAsOf: '' }),
    );
    await expect(adapter(exactClaim).answerFromContext(noContext)).resolves.toMatchObject({ status: 'insufficient' });
    const invented = vi.fn<typeof fetch>(async () =>
      response({
        status: 'grounded',
        answer: 'Официальный срок — завтра.',
        usedReferences: ['source_1'],
        validAsOf: '2026-09-21',
      }),
    );
    await expect(adapter(invented).answerFromContext(noContext)).resolves.toMatchObject({ status: 'insufficient' });
  });

  it.each([
    ['ru', 'Как подготовиться к переезду?', 'Проверьте список дел перед поездкой.'],
    ['en', 'How should I prepare to move?', 'Make a list of things to check before travel.'],
    ['hi', 'विश्वविद्यालय जाने से पहले क्या करूँ?', 'यात्रा से पहले अपने दस्तावेज़ और आवास की जानकारी जाँचें।'],
    ['ar', 'كيف أستعد للانتقال إلى الجامعة؟', 'تحقق من السكن والوثائق قبل السفر.'],
  ])('keeps the current question language (%s), not profile language', async (_script, question, answer) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({ status: 'general', answer, usedReferences: [], validAsOf: '' }),
    );
    const result = await adapter(fetchMock).answerFromContext({ question, language: 'en', context: [] });
    expect(result).toMatchObject({ status: 'general', answer });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: string };
    expect(JSON.parse(body.input)).toMatchObject({ question });
    expect(body.input).not.toContain('profileLanguage');
    if (_script === 'hi') expect(body.input).toContain('Devanagari');
  });

  it('uses one model call for an off-topic question and carries a redacted previous answer for follow-up', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        status: 'off_topic',
        answer: 'Я помогаю с поступлением, переездом и учёбой. Спросите об этом — разберёмся.',
        usedReferences: [],
        validAsOf: '',
      }),
    );
    const result = await adapter(fetchMock).answerFromContext({
      question: 'Зачем нам квантовые подлодки?',
      language: 'en',
      context: [],
      previousAnswer: 'Обратитесь к student@example.test, а затем проверьте общежитие.',
    });
    expect(result.status).toBe('off_topic');
    expect(result.answer).toBe('Спросите о поступлении, переезде или учёбе — с этим я помогу.');
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain('проверьте общежитие');
    expect(body).not.toContain('student@example.test');
  });

  it('answers an obviously unrelated sports question without a paid model call', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await adapter(fetchMock).answerFromContext({
      question: 'Кто выиграл вчерашний футбольный матч?',
      language: 'ru',
      context: [],
    });
    expect(result).toMatchObject({ status: 'off_topic', usedSourceIds: [] });
    expect(result.answer).toContain('поступлении');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['kk', 'Қандай футбол матчы болды?', 'Оқуға түсу, көшу немесе оқу туралы сұраңыз'],
    ['uz', 'Futbol haqida nima deysiz?', 'O‘qishga kirish, ko‘chish yoki o‘qish haqida so‘rang'],
    ['tk', 'Futbol barada näme diýýärsiňiz?', 'Okuwa girmek, göçmek ýa-da okuw barada soraň'],
    ['zh-CN', '今天天气怎么样？', '请询问入学、搬迁或大学生活方面的问题'],
    ['hi', 'मौसम कैसा है?', 'प्रवेश, स्थानांतरण या पढ़ाई के बारे में पूछें'],
  ] as const)('uses a short %s off-topic answer', async (language, question, expected) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({ status: 'off_topic', answer: 'off_topic', usedReferences: [], validAsOf: '' }),
    );
    const result = await adapter(fetchMock).answerFromContext({ question, language, context: [] });
    expect(result.status).toBe('off_topic');
    expect(result.answer).toContain(expected);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('rejects a status label mistakenly returned as the answer', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({ status: 'general', answer: 'general', usedReferences: [], validAsOf: '' }),
    );
    const result = await adapter(fetchMock).answerFromContext({
      question: 'How should I prepare to move?',
      language: 'ru',
      context: [],
    });
    expect(result.status).toBe('insufficient');
  });

  it('retries once when Alice returns a status label instead of an English answer', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ status: 'general', answer: 'general', usedReferences: [], validAsOf: '' }))
      .mockResolvedValueOnce(
        response({
          status: 'general',
          answer: 'Check travel and housing plans, then confirm the university details.',
          usedReferences: [],
          validAsOf: '',
        }),
      );
    const result = await adapter(fetchMock).answerFromContext({
      question: 'How should I prepare to move?',
      language: 'ru',
      context: [],
    });
    expect(result.status).toBe('general');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('replaces a literal off_topic model value with a one-sentence answer in the question language', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({ status: 'off_topic', answer: 'off_topic', usedReferences: [], validAsOf: '' }),
    );
    const result = await adapter(fetchMock).answerFromContext({
      question: 'Кто победил в матче?',
      language: 'en',
      context: [],
    });
    expect(result).toMatchObject({
      status: 'off_topic',
      answer: 'Спросите о поступлении, переезде или учёбе — с этим я помогу.',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('provides the previous answer when the student asks a follow-up', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        status: 'general',
        answer: 'Следом уточните порядок заселения в университете.',
        usedReferences: [],
        validAsOf: '',
      }),
    );
    const result = await adapter(fetchMock).answerFromContext({
      question: 'А что потом?',
      language: 'ru',
      context: [],
      previousAnswer: 'Сначала подготовьте документы для поездки.',
    });
    expect(result.status).toBe('general');
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { input: string };
    expect(JSON.parse(sent.input)).toMatchObject({ previousAnswer: 'Сначала подготовьте документы для поездки.' });
  });

  it.each([429, 500, 503])('falls back deterministically on HTTP %s', async (status) => {
    const expected = await new NoneLlmAdapter().answerFromContext(input);
    const fetchImpl = (async () => new Response('{}', { status })) as typeof fetch;
    await expect(adapter(fetchImpl).answerFromContext(input)).resolves.toEqual(expected);
  });

  it('falls back on invalid JSON and unknown references', async () => {
    const expected = await new NoneLlmAdapter().answerFromContext(input);
    const invalidJson = (async () =>
      new Response(JSON.stringify({ status: 'completed', output_text: '{not-json' }), { status: 200 })) as typeof fetch;
    await expect(adapter(invalidJson).answerFromContext(input)).resolves.toEqual(expected);

    const unknownReference = (async () =>
      response({
        status: 'grounded',
        answer: 'Invented answer',
        usedReferences: ['unknown-source'],
        validAsOf: '2026-09-21',
      })) as typeof fetch;
    await expect(adapter(unknownReference).answerFromContext(input)).resolves.toEqual(expected);
  });

  it('does not display an English Alice answer in the Russian interface', async () => {
    const russianInput = {
      question: 'Как проверить документы для общежития?',
      language: 'ru' as const,
      context: [
        {
          documentId: 'ru-document',
          sourceId: 'ru-source',
          title: 'Общежитие',
          content: 'Проверьте документы для общежития в официальной памятке.',
          validAsOf: '2026-09-21',
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        status: 'grounded',
        answer: 'Check the documents for dormitory.',
        usedReferences: ['source_1'],
        validAsOf: '2026-09-21',
      }),
    );
    const expected = await new NoneLlmAdapter().answerFromContext(russianInput);
    await expect(adapter(fetchMock).answerFromContext(russianInput)).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts on timeout and uses deterministic fallback', async () => {
    vi.useFakeTimers();
    const expected = await new NoneLlmAdapter().answerFromContext(input);
    const hanging = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = adapter(hanging).answerFromContext(input);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual(expected);
  });

  it('allows only the deterministic closed event and never sends the original text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        status: 'supported',
        type: 'ACCOMMODATION_CHANGED',
        payload: { accommodationType: 'private' },
        confidence: 'high',
        requiresConfirmation: true,
      }),
    );
    const text = 'I am student@example.test, id 9223372036854775807, and moved to a private apartment';
    const result = await adapter(fetchMock).extractEventCandidate({ text, language: 'en' });
    expect(result).toMatchObject({
      status: 'supported',
      payload: { accommodationType: 'private' },
      requiresConfirmation: true,
    });
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).not.toContain(text);
    expect(body).not.toContain('student@example.test');
    expect(body).not.toContain('9223372036854775807');
    expect(body).toContain('private');
  });

  it('does not call Alice for unsupported events and cannot override the deterministic event', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        status: 'supported',
        type: 'ACCOMMODATION_CHANGED',
        payload: { accommodationType: 'dormitory' },
        confidence: 'high',
        requiresConfirmation: true,
      }),
    );
    await expect(adapter(fetchMock).extractEventCandidate({ text: 'Hello there', language: 'en' })).resolves.toEqual({
      status: 'unsupported',
      type: null,
      payload: null,
      confidence: 'insufficient',
      requiresConfirmation: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      adapter(fetchMock).extractEventCandidate({ text: 'I moved to a private apartment', language: 'en' }),
    ).resolves.toMatchObject({
      status: 'supported',
      payload: { accommodationType: 'private' },
      requiresConfirmation: true,
    });
  });
});
