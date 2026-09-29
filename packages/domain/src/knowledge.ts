import type {
  GroundedAnswer,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeRetrievalResult,
  Language,
  OfficialContact,
  Source,
} from './types.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'could',
  'do',
  'for',
  'how',
  'i',
  'in',
  'is',
  'my',
  'of',
  'the',
  'to',
  'what',
  'where',
  'with',
  'your',
  'а',
  'в',
  'где',
  'делать',
  'для',
  'и',
  'как',
  'какие',
  'мне',
  'на',
  'нужны',
  'нужно',
  'после',
  'по',
  'что',
  'это',
]);

const BROAD_TERMS = new Set([
  'check',
  'contact',
  'document',
  'help',
  'information',
  'support',
  'документ',
  'документы',
  'информаци',
  'информация',
  'контакт',
  'помощь',
  'поддержк',
  'поддержка',
  'провер',
  'проверить',
]);

function normalizeToken(token: string): string {
  const normalized = token.toLocaleLowerCase('ru-RU').replace(/[ё]/g, 'е');
  if (/^документ/u.test(normalized)) return 'документ';
  if (/^(миграцион|миграц)/u.test(normalized)) return 'миграц';
  if (/^(регистрац|учет)/u.test(normalized)) return 'регистрац';
  if (/^(приезд|приех|прибыт)/u.test(normalized)) return 'приезд';
  if (/^(общежит|общаг)/u.test(normalized)) return 'общежит';
  if (/^засел/u.test(normalized)) return 'засел';
  // Lightweight suffix normalization is intentionally conservative and explainable.
  return normalized.length > 6
    ? normalized.replace(/(иями|ами|ого|ему|ыми|ing|tion|ments|ment|es|s)$/u, '')
    : normalized;
}

export function tokenizeKnowledgeText(value: string): readonly string[] {
  const tokens = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map(normalizeToken).filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function excerpt(content: string, terms: ReadonlySet<string>): string {
  const sentences = content.split(/(?<=[.!?])\s+/u).filter(Boolean);
  const selected =
    sentences.find((sentence) => tokenizeKnowledgeText(sentence).some((token) => terms.has(token))) ??
    sentences[0] ??
    content;
  return selected.length <= 360 ? selected : `${selected.slice(0, 357).trimEnd()}…`;
}

export interface RetrievalOptions {
  language: Language;
  threshold?: number;
  limit?: number;
}

export function retrieveKnowledge(
  query: string,
  documents: readonly KnowledgeDocument[],
  options: RetrievalOptions,
): KnowledgeRetrievalResult {
  const queryTokens = [...new Set(tokenizeKnowledgeText(query))];
  const querySet = new Set(queryTokens);
  const threshold = options.threshold ?? 0.18;
  const limit = options.limit ?? 3;
  if (queryTokens.length === 0) {
    return { status: 'not_found', hits: [], normalizedQuery: '' };
  }

  const hits: KnowledgeHit[] = documents
    .filter((document) => document.language === options.language)
    .map((document) => {
      const contentTokens = new Set(tokenizeKnowledgeText(`${document.title} ${document.content}`));
      const tagTokens = new Set(tokenizeKnowledgeText(document.tags.join(' ')));
      const matchedTerms = queryTokens.filter((term) => contentTokens.has(term) || tagTokens.has(term));
      const directCoverage = matchedTerms.length / queryTokens.length;
      const tagMatches = matchedTerms.filter((term) => tagTokens.has(term)).length;
      const tagBoost = Math.min(0.25, tagMatches * 0.08);
      const score = Number(Math.min(1, directCoverage + tagBoost).toFixed(4));
      return {
        document,
        score,
        matchedTerms: [...matchedTerms].sort(),
        excerpt: excerpt(document.content, querySet),
      };
    })
    .filter((hit) => {
      const hasSpecificMatch = hit.matchedTerms.some((term) => !BROAD_TERMS.has(term));
      const requiredMatches = queryTokens.length === 1 || (queryTokens.length === 2 && hasSpecificMatch) ? 1 : 2;
      return hit.score >= threshold && hit.matchedTerms.length >= requiredMatches;
    })
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))
    .slice(0, limit);

  return {
    status: hits.length > 0 ? 'found' : 'not_found',
    hits,
    normalizedQuery: queryTokens.join(' '),
  };
}

export interface SafeKnowledgeAnswerInput {
  query: string;
  language: Language;
  documents: readonly KnowledgeDocument[];
  sources: readonly Source[];
  contact: OfficialContact;
  notFoundMessage: string;
  contactNextAction: string;
}

export function answerFromKnowledge(input: SafeKnowledgeAnswerInput): GroundedAnswer {
  const question = input.query.trim().toLocaleLowerCase('ru-RU');
  const isGreeting =
    input.language === 'ru'
      ? /^(?:привет|здравствуй(?:те)?|добрый (?:день|вечер)|доброе утро)[!.?]*$/u.test(question)
      : /^(?:hi|hello|hey|good (?:morning|afternoon|evening))[!.?]*$/u.test(question);
  const asksAboutAssistant =
    input.language === 'ru'
      ? /^(?:кто ты|что ты (?:умеешь|делаешь)|зачем (?:ты|нужен (?:этот )?помощник)|как ты поможешь|что это за (?:бот|приложение|помощник)|как пользоваться (?:ботом|приложением)|что такое путь студента)\??$/u.test(
          question,
        )
      : /^(?:who are you|what can you do|what is this (?:bot|app|assistant)|how (?:can you help|do i use this (?:bot|app)))\??$/u.test(
          question,
        );
  if (isGreeting || asksAboutAssistant) {
    return {
      status: 'product_help',
      answer:
        input.language === 'ru'
          ? `${isGreeting ? 'Здравствуйте! ' : ''}Я помощник «Пути студента». Помогаю разобраться с первыми делами после зачисления: переездом, жильём и шагами маршрута. Отвечаю по доступным источникам; если данных недостаточно, прямо скажу об этом.`
          : `${isGreeting ? 'Hello! ' : ''}I am the «Путь студента» assistant. I help with first steps after admission, moving, housing and your route. I answer from available sources and say when information is insufficient.`,
      nextAction:
        input.language === 'ru'
          ? 'Спросите, например: «Как подготовиться к приезду?»'
          : 'For example, ask: “How do I prepare for arrival?”',
      sources: [],
      validAsOf: null,
      confidence: 'high',
      contact: null,
    };
  }
  const result = retrieveKnowledge(input.query, input.documents, {
    language: input.language,
  });
  if (result.status === 'not_found') {
    return {
      status: 'not_found',
      answer: null,
      nextAction: input.contactNextAction,
      sources: [],
      validAsOf: null,
      confidence: 'insufficient',
      contact: input.contact,
    };
  }

  const top = result.hits[0];
  if (!top) {
    return {
      status: 'not_found',
      answer: input.notFoundMessage,
      nextAction: input.contactNextAction,
      sources: [],
      validAsOf: null,
      confidence: 'insufficient',
      contact: input.contact,
    };
  }
  const allowedSource = input.sources.find((source) => source.id === top.document.sourceId);
  if (!allowedSource) {
    return {
      status: 'not_found',
      answer: input.notFoundMessage,
      nextAction: input.contactNextAction,
      sources: [],
      validAsOf: null,
      confidence: 'insufficient',
      contact: input.contact,
    };
  }
  return {
    status: 'grounded',
    answer: top.excerpt,
    nextAction: input.contactNextAction,
    sources: [allowedSource],
    validAsOf: top.document.validAsOf,
    confidence: top.score >= 0.75 ? 'high' : 'medium',
    contact: null,
  };
}
