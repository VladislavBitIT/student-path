import { getMaxInitData } from './bridge';
import type {
  AccommodationType,
  AuthResponse,
  Candidate,
  GroundedAnswer,
  Language,
  OnboardingInput,
  DirectoryUniversity,
  ProfileResponse,
  Route,
  RouteDiff,
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

let sessionToken: string | null = null;
let authenticationInFlight: Promise<AuthResponse> | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(message: string, status: number, code = 'API_ERROR', requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function rawRequest<T>(path: string, options: RequestInit = {}, includeSession = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (includeSession && sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Не удалось связаться с приложением', 0, 'NETWORK_ERROR');
  }

  const contentType = response.headers.get('content-type') ?? '';
  let body: unknown = null;
  if (response.status !== 204) {
    if (contentType.includes('application/json')) {
      body = await response.json().catch(() => null);
    } else {
      body = await response.text().catch(() => null);
    }
  }

  if (!response.ok) {
    const root = isRecord(body) ? body : {};
    const nested = isRecord(root.error) ? root.error : {};
    const message =
      (typeof root.message === 'string' && root.message) ||
      (typeof nested.message === 'string' && nested.message) ||
      response.statusText ||
      'Не удалось выполнить запрос';
    const code =
      (typeof root.code === 'string' && root.code) || (typeof nested.code === 'string' && nested.code) || 'API_ERROR';
    const requestId =
      (typeof root.requestId === 'string' && root.requestId) ||
      (typeof nested.requestId === 'string' && nested.requestId) ||
      response.headers.get('x-request-id') ||
      undefined;
    throw new ApiError(message, response.status, code, requestId);
  }

  return body as T;
}

function selectedDevUserId(): string {
  if (typeof window === 'undefined') return 'dev-student-clean';
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get('devUserId');
  if (explicit && /^[A-Za-z0-9_-]{1,64}$/.test(explicit)) return explicit;
  return params.get('demo') === 'completed' ? 'dev-student-completed' : 'dev-student-clean';
}

async function authenticateFresh(): Promise<AuthResponse> {
  sessionToken = null;
  const initData = getMaxInitData();
  if (!initData && import.meta.env.PROD && import.meta.env.VITE_DEMO_MODE !== 'true') {
    throw new ApiError('Откройте «Путь студента» из чата с ботом MAX', 401, 'MAX_CONTEXT_REQUIRED');
  }
  const auth = initData
    ? await rawRequest<AuthResponse>(
        '/api/auth/max',
        {
          method: 'POST',
          body: JSON.stringify({ initData }),
        },
        false,
      )
    : await rawRequest<AuthResponse>(
        '/api/auth/dev',
        {
          method: 'POST',
          body: JSON.stringify({ devUserId: selectedDevUserId() }),
        },
        false,
      );

  if (!auth.token) throw new ApiError('Не удалось войти в приложение', 500, 'INVALID_AUTH_RESPONSE');
  sessionToken = auth.token;
  return auth;
}

function sharedAuthentication(): Promise<AuthResponse> {
  authenticationInFlight ??= authenticateFresh().finally(() => {
    authenticationInFlight = null;
  });
  return authenticationInFlight;
}

async function request<T>(path: string, options: RequestInit = {}, retryAfter401 = true): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !retryAfter401) throw error;
    await sharedAuthentication();
    return rawRequest<T>(path, options);
  }
}

export async function authenticate(): Promise<AuthResponse> {
  return sharedAuthentication();
}

export function clearSession(): void {
  sessionToken = null;
  authenticationInFlight = null;
}

export const api = {
  universities: () =>
    rawRequest<{ sourceCheckedAt: string; universities: DirectoryUniversity[] }>('/api/universities', {}, false),
  profile: () => request<ProfileResponse>('/api/profile'),
  onboarding: (input: OnboardingInput) =>
    request<{ route: Route }>('/api/onboarding', { method: 'POST', body: JSON.stringify(input) }),
  route: () => request<{ route: Route }>('/api/route'),
  completeStep: (code: string) =>
    request<{ route: Route }>(`/api/route/steps/${encodeURIComponent(code)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETED' }),
    }),
  startStep: (code: string) =>
    request<{ route: Route }>(`/api/route/steps/${encodeURIComponent(code)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'IN_PROGRESS' }),
    }),
  updateLanguage: (preferredLanguage: Language) =>
    request<{ user: ProfileResponse['user'] }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ preferredLanguage }),
    }),
  createCandidate: (accommodationType: AccommodationType) =>
    request<{ candidate: Candidate }>('/api/events/candidates', {
      method: 'POST',
      body: JSON.stringify({ type: 'ACCOMMODATION_CHANGED', accommodationType }),
    }),
  createArrivalCandidate: (arrivalDate: string) =>
    request<{ candidate: Candidate }>('/api/events/candidates', {
      method: 'POST',
      body: JSON.stringify({ type: 'ARRIVAL_CONFIRMED', arrivalDate }),
    }),
  confirmCandidate: (candidateId: string) =>
    request<{ route: Route; diff: RouteDiff }>('/api/events/confirm', {
      method: 'POST',
      body: JSON.stringify({ candidateId }),
    }),
  cancelCandidate: (candidateId: string) =>
    request<void>(`/api/events/candidates/${encodeURIComponent(candidateId)}/cancel`, { method: 'POST' }),
  remindersOptIn: () => request<unknown>('/api/reminders/opt-in', { method: 'POST' }),
  updateKnowledgeContext: (
    code: string,
    input: { facts: Record<string, string | number | boolean | null>; dates: Record<string, string | null> },
  ) =>
    request<{ route: Route }>(`/api/route/steps/${encodeURIComponent(code)}/context`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remindersOptOut: () => request<unknown>('/api/reminders/opt-out', { method: 'POST' }),
  reminders: () => request<{ reminders: Array<{ stepCode: string; scheduledFor: string }> }>('/api/reminders'),
  configureReminder: (code: string, mode: 'off' | 'automatic') =>
    request<unknown>(`/api/reminders/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ mode }) }),
  createReminder: (stepCode: string, scheduledFor: string) =>
    request<unknown>('/api/reminders', {
      method: 'POST',
      body: JSON.stringify({ stepCode, scheduledFor }),
    }),
  knowledgeQuery: async (question: string, previousAnswer?: string): Promise<{ answer: GroundedAnswer }> => {
    const result = await request<{ answer: GroundedAnswer | string }>('/api/knowledge/query', {
      method: 'POST',
      body: JSON.stringify({ question, ...(previousAnswer ? { previousAnswer: previousAnswer.slice(0, 700) } : {}) }),
    });
    return { answer: typeof result.answer === 'string' ? { text: result.answer } : result.answer };
  },
  feedback: (queryId: string | undefined, type: 'HELPFUL' | 'NOT_FOUND' | 'OUTDATED') =>
    request<unknown>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ ...(queryId ? { queryId } : {}), type }),
    }),
};
