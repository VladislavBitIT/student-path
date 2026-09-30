// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../apps/miniapp/src/App';
import { api, ApiError, authenticate, clearSession } from '../../apps/miniapp/src/api';
import { getMaxInitData, getMaxLaunchUrl, getStartPayload, openMaxExternalLink } from '../../apps/miniapp/src/bridge';
import { translate } from '../../apps/miniapp/src/i18n';
import type { Language } from '../../apps/miniapp/src/types';
import type { ProfileResponse, Route, RouteStep } from '../../apps/miniapp/src/types';

const firstStep: RouteStep = {
  id: 'step-1',
  code: 'CHECK_ENTRY',
  title: 'Check entry requirements',
  description: 'Check the documents required for your situation.',
  whyImportant: 'Entry requirements depend on your personal situation.',
  preparation: ['Passport', 'Admission documents'],
  contact: 'International Students Center: help@example.test',
  source: {
    title: 'International student guide',
    url: 'https://example.test/guide',
    authority: 'University',
  },
  status: 'NOT_STARTED',
  isActive: true,
  deadline: '2026-09-28',
  deadlineNote: null,
  stage: 'pre_arrival',
  verificationStatus: 'verified',
  validAsOf: '2026-09-21',
};

const secondStep: RouteStep = {
  ...firstStep,
  id: 'step-2',
  code: 'HEALTH_INSURANCE',
  title: 'Arrange health insurance',
  description: 'Confirm the current insurance requirements.',
  deadline: null,
  deadlineNote: 'Deadline to be confirmed',
  stage: 'first_week',
};

const baseRoute: Route = {
  id: 'route-1',
  version: 1,
  stage: 'pre_arrival',
  progress: { completed: 0, total: 2, percent: 0 },
  nextAction: firstStep,
  steps: [firstStep, secondStep],
};

const completedRoute: Route = {
  ...baseRoute,
  version: 2,
  progress: { completed: 1, total: 2, percent: 50 },
  nextAction: secondStep,
  steps: [{ ...firstStep, status: 'COMPLETED' }, secondStep],
};

const privateRoute: Route = {
  ...completedRoute,
  version: 3,
  steps: [
    ...completedRoute.steps,
    {
      ...secondStep,
      id: 'step-3',
      code: 'REGISTER_PRIVATE',
      title: 'Register private residence',
      stage: 'first_days',
    },
  ],
  progress: { completed: 1, total: 3, percent: 33 },
};

const profileResponse: ProfileResponse = {
  user: { id: 'user-1', preferredLanguage: 'en' },
  profile: {
    universityCode: 'ITMO',
    arrivalStatus: 'preparing',
    arrivalDate: '2026-10-01',
    accommodationType: 'dormitory',
    remindersEnabled: false,
  },
};

const universityDirectory = {
  sourceCheckedAt: '2026-09-23',
  universities: [
    {
      code: 'ITMO',
      nameRu: 'Университет ИТМО',
      nameEn: 'ITMO University',
      cityRu: 'Санкт-Петербург',
      campuses: [{ code: 'main', nameRu: 'Санкт-Петербург', nameEn: 'Saint Petersburg' }],
      partnerStatus: 'directory_public',
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('MAX launch context', () => {
  it('opens official HTTPS pages through MAX and leaves a browser fallback', () => {
    const openLink = vi.fn();
    window.WebApp = { openLink };
    expect(openMaxExternalLink('https://education.nsu.ru/freshmen')).toBe(true);
    expect(openLink).toHaveBeenCalledWith('https://education.nsu.ru/freshmen');
    expect(openMaxExternalLink('javascript:alert(1)')).toBe(false);
    expect(openLink).toHaveBeenCalledTimes(1);
    window.WebApp = {};
    expect(openMaxExternalLink('https://education.nsu.ru/freshmen')).toBe(false);
  });
  it('opens reminder steps from MAX start parameters without accepting arbitrary navigation', () => {
    const location = new URL('https://student-way.tw1.su/?WebAppStartParam=step_CHECK_ENTRY') as unknown as Location;
    window.WebApp = {};
    expect(getStartPayload(location)).toBe('CHECK_ENTRY');
    window.WebApp = { initData: 'start_param=step_ARRANGE_DORMITORY' };
    expect(getStartPayload(location)).toBe('ARRANGE_DORMITORY');
    window.WebApp = { initData: 'start_param=https%3A%2F%2Fevil.test' };
    expect(getStartPayload(location)).toBeNull();
    window.WebApp = {};
  });
  it('reads signed initData from the URL fragment when the bridge value is unavailable', () => {
    window.WebApp = {};
    const location = new URL(
      'https://student-way.tw1.su/#WebAppData=user%3Dverified%26auth_date%3D1%26hash%3Dabc&WebAppPlatform=web',
    ) as unknown as Location;
    expect(getMaxInitData(location)).toBe('user=verified&auth_date=1&hash=abc');
  });

  it('rejects duplicate WebAppData and unsafe bot usernames', () => {
    window.WebApp = {};
    const duplicate = new URL('https://student-way.tw1.su/#WebAppData=one&WebAppData=two') as unknown as Location;
    expect(getMaxInitData(duplicate)).toBeNull();
    expect(getMaxLaunchUrl('bot_name')).toBe('https://max.ru/bot_name?startapp');
    expect(getMaxLaunchUrl('bad/name')).toBeNull();
  });
});

it('starts a new navigation screen at the top instead of retaining the previous scroll offset', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  installSuccessfulApi();
  render(<App />);
  await screen.findByRole('heading', { name: 'Your plan for the first steps' });
  scroll.mockClear();
  await userEvent.click(screen.getByRole('button', { name: /^Profile$/ }));
  expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  scroll.mockRestore();
});

function installSuccessfulApi(remindersEnabled = false, language: Language = 'en', route: Route = baseRoute) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/auth/dev') && method === 'POST') {
      return json({ token: 'test-session', user: { ...profileResponse.user, preferredLanguage: language } });
    }
    if (url.endsWith('/api/profile') && method === 'GET') {
      return json({
        ...profileResponse,
        user: { ...profileResponse.user, preferredLanguage: language },
        profile: profileResponse.profile ? { ...profileResponse.profile, remindersEnabled } : null,
      });
    }
    if (url.endsWith('/api/route') && method === 'GET') return json({ route });
    if (url.endsWith('/context') && method === 'PATCH') return json({ route });
    if (url.endsWith('/api/route/steps/CHECK_ENTRY/status') && method === 'PATCH') {
      return json({ route: completedRoute });
    }
    if (url.endsWith('/api/events/candidates') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { type: string; arrivalDate?: string };
      if (body.type === 'ARRIVAL_CONFIRMED') {
        return json({
          candidate: {
            id: 'arrival-candidate-1',
            type: 'ARRIVAL_CONFIRMED',
            payload: { arrivalDate: body.arrivalDate },
            status: 'PENDING',
          },
        });
      }
      return json({
        candidate: {
          id: 'candidate-1',
          type: 'ACCOMMODATION_CHANGED',
          accommodationType: 'private',
          status: 'PENDING',
        },
      });
    }
    if (url.endsWith('/api/events/confirm') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { candidateId: string };
      if (body.candidateId === 'arrival-candidate-1') {
        return json({
          route: { ...baseRoute, version: 2, stage: 'first_days' },
          diff: { deactivated: ['CHECK_ENTRY'], preservedCompleted: [] },
        });
      }
      return json({
        route: privateRoute,
        diff: {
          added: [{ code: 'REGISTER_PRIVATE', title: 'Register private residence' }],
          deactivated: ['DORM_CHECK_IN'],
          preservedCompleted: ['CHECK_ENTRY'],
        },
      });
    }
    if (url.endsWith('/api/events/candidates/candidate-1/cancel') && method === 'POST') {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/api/events/candidates/arrival-candidate-1/cancel') && method === 'POST') {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/api/reminders') && method === 'GET') return json({ reminders: [] });
    if (url.endsWith('/api/reminders') && method === 'POST') {
      return json({ reminder: { id: 'reminder-1' } });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
  delete window.WebApp;
  window.history.replaceState({}, '', '/');
});

describe('mini app', () => {
  it('shows archive data inside a saved route step, with source and limits', async () => {
    const archiveStep: RouteStep = {
      ...firstStep,
      id: 'archive-step',
      code: 'FED_ENTRY_RULE_CHECK',
      title: 'Проверьте порядок въезда',
      description: 'Уточните основание въезда.',
      verificationStatus: 'demo',
      deadline: null,
      knowledge: {
        id: 'FED_ENTRY_RULE_CHECK',
        scope: 'federal',
        title: 'Проверьте порядок въезда',
        summary: 'Уточните основание въезда.',
        instructions: ['Откройте таблицу МИД.'],
        documents: [],
        destination: null,
        warnings: ['Требуется проверка действующих исключений.'],
        exceptions: [],
        unresolvedIds: ['UNR_ENTRY_REGIME'],
        deadlineKind: 'unknown',
        deadlineNotes: [],
        reportedDeadlineText: null,
        result: null,
        triggerEvent: 'trip_planned',
        applicability: true,
        selection: 'included',
        sources: [
          {
            id: 'SRC_ENTRY_TABLE',
            title: 'Таблица МИД',
            publisher: 'МИД',
            url: 'https://example.test/entry',
            status: 'unverified',
          },
        ],
        overlays: [],
      },
    };
    installSuccessfulApi(false, 'en', {
      ...baseRoute,
      steps: [...baseRoute.steps, archiveStep],
      progress: { completed: 0, total: 3, percent: 0 },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Route' }));
    expect(screen.queryByText(/Draft route logic/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Проверьте порядок въезда/ }));
    expect(screen.getByText('Требуется проверка действующих исключений.')).toBeTruthy();
    expect(screen.getByText('No confirmed date calculated')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Таблица МИД' })).toBeTruthy();
  });
  it.each(['kk', 'uz', 'tk', 'zh-CN', 'hi'] as const)(
    'restores the %s interface from the saved profile on a second entry',
    async (language) => {
      installSuccessfulApi(false, language);
      const first = render(<App />);
      expect(await screen.findByRole('heading', { name: translate(language, 'greeting') })).toBeTruthy();
      first.unmount();
      clearSession();
      render(<App />);
      expect(await screen.findByRole('heading', { name: translate(language, 'greeting') })).toBeTruthy();
      expect(screen.getByRole('button', { name: translate(language, 'route') })).toBeTruthy();
    },
  );

  it.each([
    ['kk', 'Университетіңізді таңдаңыз'],
    ['uz', 'Universitetingizni tanlang'],
    ['tk', 'Uniwersitetiňizi saýlaň'],
    ['zh-CN', '请选择大学'],
    ['hi', 'अपना विश्वविद्यालय चुनें'],
  ] as const)('shows the %s onboarding in the selected language', async (language, universityQuestion) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.endsWith('/api/auth/dev')) return json({ token: 'test-session', user: profileResponse.user });
        if (url.endsWith('/api/profile')) return json({ ...profileResponse, profile: null });
        if (url.endsWith('/api/universities')) return json(universityDirectory);
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(await screen.findByRole('combobox', { name: /Язык|Language/ }), language);
    expect(await screen.findByText(universityQuestion)).toBeTruthy();
  });

  it('shows the Russian name and language choices on the first screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.endsWith('/api/auth/dev'))
          return json({ token: 'test-session', user: { ...profileResponse.user, preferredLanguage: 'ru' } });
        if (url.endsWith('/api/profile'))
          return json({ user: { ...profileResponse.user, preferredLanguage: 'ru' }, profile: null });
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Составим план первых дел' })).toBeTruthy();
    expect(screen.getByText('Путь студента')).toBeTruthy();
    const languagePicker = screen.getByRole('combobox', { name: 'Язык' });
    expect(languagePicker.querySelectorAll('option')).toHaveLength(7);
    expect(screen.getByRole('option', { name: '🇰🇿 Қазақша' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '🇺🇿 O‘zbekcha' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '🇹🇲 Türkmençe' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '🇨🇳 简体中文' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '🇮🇳 हिन्दी' })).toBeTruthy();
    expect(screen.queryByText('StudyWay')).toBeNull();
    expect(screen.getByLabelText('В каком университете вы учитесь?')).toBeTruthy();
    await userEvent.setup().selectOptions(languagePicker, 'en');
    expect(screen.getByText('Путь студента')).toBeTruthy();
    expect(screen.getByLabelText('Which university will you attend?')).toBeTruthy();
    expect(screen.queryByText(/ITMO students/i)).toBeNull();
    expect(document.title).toBe('Путь студента');
  });

  it('requires explicit arrival and housing choices before creating a personal plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.endsWith('/api/auth/dev')) return json({ token: 'test-session', user: profileResponse.user });
        if (url.endsWith('/api/profile')) return json({ ...profileResponse, profile: null });
        if (url.endsWith('/api/universities')) return json(universityDirectory);
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    const continueButton = (await screen.findByRole('button', { name: 'Continue' })) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    await screen.findByRole('option', { name: 'ITMO University' });
    await user.selectOptions(screen.getByLabelText('Which university will you attend?'), 'ITMO');
    expect(continueButton.disabled).toBe(true);
    expect(document.querySelectorAll('#citizenship-countries option').length).toBe(249);
    await user.type(screen.getByLabelText('Citizenship'), 'Atlantis');
    expect(continueButton.disabled).toBe(true);
    await user.clear(screen.getByLabelText('Citizenship'));
    await user.type(screen.getByLabelText('Citizenship'), 'Russia');
    await user.click(continueButton);
    const submit = screen.getByRole('button', { name: 'Show my first step' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.click(screen.getByLabelText('Not yet arrived in my study city'));
    expect(submit.disabled).toBe(true);
    await user.click(screen.getByLabelText('Dormitory'));
    expect(submit.disabled).toBe(false);
  });

  it('separates Russia entry from study-city arrival, opens the plan, and restores it on reentry', async () => {
    let saved: ProfileResponse['profile'] = null;
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url.endsWith('/api/auth/dev')) return json({ token: 'test-session', user: profileResponse.user });
        if (url.endsWith('/api/profile')) return json({ ...profileResponse, profile: saved });
        if (url.endsWith('/api/universities')) return json(universityDirectory);
        if (url.endsWith('/api/route')) return json({ route: baseRoute });
        if (url.endsWith('/api/onboarding')) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          requests.push(body);
          saved = {
            universityCode: String(body.universityCode),
            countryOrRegion: String(body.citizenshipCountry),
            arrivalStatus: body.arrivalStatus as 'preparing' | 'arrived',
            arrivalDate: body.arrivalDate as string | null,
            accommodationType: 'private',
            remindersEnabled: false,
            attributes: {
              journeyVersion: 'city_v1',
              citizenshipType: 'foreign',
              russiaPresence: String(body.russiaPresence),
              studyArrival: String(body.studyArrival),
              russiaEntryDate: body.russiaEntryDate as string | null,
              mobilityStatus: String(body.mobilityStatus),
              entryMode: String(body.entryMode),
              campusCode: 'main',
            },
          };
          return json({ route: baseRoute });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    render(<App />);
    await screen.findByRole('option', { name: 'ITMO University' });
    await user.selectOptions(await screen.findByLabelText('Which university will you attend?'), 'ITMO');
    await user.type(screen.getByLabelText('Citizenship'), 'India');
    expect(screen.getByLabelText('How did or will you enter Russia?')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('How did or will you enter Russia?'), 'visa');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByLabelText('Have you already come to Russia to study?')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Where are you now?'), 'yes');
    await user.selectOptions(screen.getByLabelText('Have you already come to Russia to study?'), 'yes');
    fireEvent.change(screen.getByLabelText('Date of your last entry to Russia, if known'), {
      target: { value: '2026-09-20' },
    });
    await user.selectOptions(screen.getByLabelText('Are you moving to your study city?'), 'moving');
    fireEvent.change(screen.getByLabelText('Arrival date in your study city, if known'), {
      target: { value: '2026-09-28' },
    });
    await user.click(screen.getByLabelText('Private housing'));
    await user.click(screen.getByRole('button', { name: 'Show my first step' }));
    expect(await screen.findByRole('heading', { name: 'Your plan for the first steps' })).toBeTruthy();
    expect(screen.getByText('After viewing your first step, you can enable reminders.')).toBeTruthy();
    expect(requests[0]).toMatchObject({
      russiaPresence: 'yes',
      russiaEntryDate: '2026-09-20',
      arrivalStatus: 'preparing',
      arrivalDate: '2026-09-28',
      entryMode: 'visa',
      citizenshipCountry: 'IN',
    });
    await user.click(screen.getByRole('button', { name: 'Reminders' }));
    expect(screen.getByRole('heading', { name: 'Reminders' })).toBeTruthy();

    cleanup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your plan for the first steps' })).toBeTruthy();
    expect(screen.queryByText('After viewing your first step, you can enable reminders.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    expect(screen.getByText('20 September 2026')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Update your answers/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect((screen.getByLabelText('Date of your last entry to Russia, if known') as HTMLInputElement).value).toBe(
      '2026-09-20',
    );
    await user.selectOptions(screen.getByLabelText('Where are you now?'), 'no');
    expect((screen.getByLabelText('Have you already come to Russia to study?') as HTMLSelectElement).value).toBe('yes');
    await user.selectOptions(screen.getByLabelText('Are you moving to your study city?'), 'moved');
    expect((screen.getByLabelText('Arrived in my study city') as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Update your answers' }));
    expect(requests[1]).toMatchObject({
      russiaPresence: 'no',
      studyArrival: 'yes',
      arrivalStatus: 'arrived',
      mobilityStatus: 'moved',
      russiaEntryDate: '2026-09-20',
    });
  });

  it('asks to clarify a legacy date without copying it into the study-city date', async () => {
    const oldProfile: NonNullable<ProfileResponse['profile']> = {
      universityCode: 'ITMO',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'private',
      remindersEnabled: false,
      attributes: {
        legacyArrivalDate: '2026-09-20',
        russiaPresence: 'yes',
        citizenshipType: 'foreign',
        entryMode: 'already_in_russia',
        mobilityStatus: 'moving',
        campusCode: 'main',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.endsWith('/api/auth/dev')) return json({ token: 'test-session', user: profileResponse.user });
        if (url.endsWith('/api/profile')) return json({ ...profileResponse, profile: oldProfile });
        if (url.endsWith('/api/route')) return json({ route: baseRoute });
        if (url.endsWith('/api/universities')) return json(universityDirectory);
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Profile' }));
    expect(screen.getByText(/earlier date may refer to entering Russia/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Update your answers/ }));
    await user.type(screen.getByLabelText('Citizenship'), 'India');
    await screen.findByRole('option', { name: 'ITMO University' });
    const continueButton = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    await user.click(continueButton);
    expect((screen.getByLabelText('Arrival date in your study city, if known') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Date of your last entry to Russia, if known') as HTMLInputElement).value).toBe('');
  });

  it('uses dev auth without WebApp and renders the Today dashboard from backend data', async () => {
    delete window.WebApp;
    const fetchMock = installSuccessfulApi();

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Your plan for the first steps' })).toBeTruthy();
    expect(screen.getAllByText('Путь студента').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Check entry requirements').length).toBeGreaterThan(0);
    expect(screen.getByText('0 of 2 completed')).toBeTruthy();

    const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: urlOf(input), method: init?.method ?? 'GET' }));
    expect(calls.some((call) => call.url.endsWith('/api/auth/dev') && call.method === 'POST')).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/auth/max'))).toBe(false);
    const authCall = fetchMock.mock.calls.find(([input]) => urlOf(input).endsWith('/api/auth/dev'));
    expect(JSON.parse(String(authCall?.[1]?.body))).toEqual({ devUserId: 'dev-student-clean' });
  });

  it.each([true, false])(
    'clarifies pending actions in the profile and follows the returned plan (%s)',
    async (applies) => {
      const pending: RouteStep = {
        ...firstStep,
        code: 'UNRESOLVED_ACTION',
        title: 'Additional housing documents',
        isActive: false,
        knowledge: {
          id: 'UNRESOLVED_ACTION',
          scope: 'university',
          title: 'Additional housing documents',
          summary: '',
          instructions: [],
          documents: [],
          destination: null,
          warnings: [],
          exceptions: [],
          unresolvedIds: [],
          deadlineKind: 'event_based',
          deadlineNotes: [],
          reportedDeadlineText: null,
          result: null,
          triggerEvent: null,
          applicability: 'unknown',
          selection: 'pending',
          sources: [],
          overlays: [],
          releaseVerified: true,
          inputs: [
            {
              key: 'needs_housing',
              label: 'Do you need university housing?',
              kind: 'fact',
              options: [true, false],
              value: null,
            },
          ],
        },
      };
      const baseFetch = installSuccessfulApi(false, 'en', { ...baseRoute, possibleSteps: [pending] });
      const updated = {
        ...baseRoute,
        steps: applies ? [...baseRoute.steps, { ...pending, isActive: true }] : baseRoute.steps,
        possibleSteps: [],
        progress: { completed: 0, total: applies ? 3 : 2, percent: 0 },
      };
      let submitted: unknown;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (urlOf(input).endsWith('/UNRESOLVED_ACTION/context') && init?.method === 'PATCH') {
            submitted = JSON.parse(String(init.body));
            return json({ route: updated });
          }
          return baseFetch(input, init);
        }),
      );
      const user = userEvent.setup();
      render(<App />);
      await user.click(await screen.findByRole('button', { name: 'Route' }));
      expect(screen.queryByText('Additional housing documents')).toBeNull();
      expect(screen.queryByText('Other actions for your situation')).toBeNull();
      expect(screen.queryByText(/Remaining steps/)).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Profile' }));
      await user.click(screen.getByText('Clarify answers for your plan'));
      expect(screen.queryByText('Additional housing documents')).toBeNull();
      await user.click(screen.getByText('Do you need university housing?', { selector: 'summary' }));
      await user.selectOptions(screen.getByLabelText('Do you need university housing?'), String(applies));
      await user.click(screen.getByRole('button', { name: 'Save answers' }));
      await waitFor(() => expect(screen.queryByText('Clarify answers for your plan')).toBeNull());
      expect(submitted).toEqual({ facts: { needs_housing: applies }, dates: {} });
      await user.click(screen.getByRole('button', { name: 'Route' }));
      expect(Boolean(screen.queryByText('Additional housing documents'))).toBe(applies);
      expect(screen.getByText(`0 of ${applies ? 3 : 2} completed`)).toBeTruthy();
    },
  );

  it('renders step documents and opens its official source through MAX Bridge', async () => {
    const openLink = vi.fn();
    window.WebApp = { openLink };
    installSuccessfulApi();
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'View instructions' }));
    expect(screen.getByText('Passport')).toBeTruthy();
    const source = screen.getByRole('link', { name: /International student guide/ });
    await userEvent.click(source);
    expect(openLink).toHaveBeenCalledWith('https://example.test/guide');
  });

  it('shows source-oriented quick questions without implying the assistant knows the personal next step', async () => {
    installSuccessfulApi();
    render(<App />);
    await screen.findByRole('heading', { name: 'Your plan for the first steps' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('button', { name: 'How do I prepare for arrival?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How do I book a dormitory?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Where can I find migration document guidance?' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'What should I do now?' })).toBeNull();
  });

  it('shows a local assistant introduction without a false missing-answer warning or contact', async () => {
    const baseFetch = installSuccessfulApi();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (urlOf(input).endsWith('/api/knowledge/query')) {
          return json({
            answer: {
              status: 'product_help',
              answer: 'I am the Path of the Student assistant.',
              nextAction: 'Ask about arrival.',
              sources: [],
              contact: null,
            },
          });
        }
        return baseFetch(input, init);
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'who are you');
    await user.click(screen.getByRole('button', { name: 'Find an answer' }));
    expect(await screen.findByRole('heading', { name: 'About the assistant' })).toBeTruthy();
    expect(screen.getByText('who are you')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).value).toBe('');
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'another question');
    expect(screen.getByText('who are you')).toBeTruthy();
    expect(screen.queryByText('No verified answer was found.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Contact a person' })).toBeNull();
  });

  it('marks a step completed through the API and renders the returned route', async () => {
    const fetchMock = installSuccessfulApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /View instructions/i }));
    await user.click(screen.getByRole('button', { name: /I completed this step/i }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /I completed this step/i })).toBeNull());
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Schedule reminder/i })).toBeNull();

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) => urlOf(input).endsWith('/api/route/steps/CHECK_ENTRY/status') && init?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ status: 'COMPLETED' });
  });

  it('schedules a future reminder with an absolute timestamp and hides the dev shortcut', async () => {
    const fetchMock = installSuccessfulApi(true);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /View instructions/i }));
    expect(screen.queryByRole('button', { name: /Remind me in 1 minute/i })).toBeNull();
    const input = screen.getByLabelText('Reminder date and time') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: '2099-10-01T12:30' } });
    await user.click(screen.getByRole('button', { name: 'Save time' }));

    const reminderCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => urlOf(input).endsWith('/api/reminders') && init?.method === 'POST',
      );
      expect(call).toBeTruthy();
      return call;
    });
    const body = JSON.parse(String(reminderCall?.[1]?.body)) as Record<string, unknown>;
    expect(body.stepCode).toBe('CHECK_ENTRY');
    expect(body.demoInSeconds).toBeUndefined();
    expect(new Date(String(body.scheduledFor)).getTime()).toBeGreaterThan(Date.now());
  });

  it('shows only the next action on Home and keeps the language picker available', async () => {
    installSuccessfulApi();
    render(<App />);
    await screen.findByRole('heading', { name: 'Your plan for the first steps' });
    expect(screen.getAllByText(firstStep.title)).toHaveLength(1);
    expect(screen.queryByText(secondStep.title)).toBeNull();
    expect(screen.queryByText('Steps remaining: 2')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Full route' }));
    expect(screen.getByText(secondStep.title)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
  });

  it('marks work in progress only when explicitly requested', async () => {
    const fetchMock = installSuccessfulApi();
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'View instructions' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Start working on this' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.body === JSON.stringify({ status: 'IN_PROGRESS' }))).toBe(
      true,
    );
  });

  it('edits and clears a persisted reminder directly in the common reminder screen', async () => {
    const baseFetch = installSuccessfulApi(true);
    let reminders = [{ stepCode: firstStep.code, scheduledFor: '2099-10-01T12:30:00.000Z' }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input),
        method = init?.method ?? 'GET';
      if (url.endsWith('/api/reminders') && method === 'GET') return json({ reminders });
      if (url.endsWith('/api/reminders') && method === 'POST') {
        reminders = [JSON.parse(String(init?.body))];
        return json({ reminder: reminders[0] });
      }
      if (url.endsWith(`/api/reminders/${firstStep.code}`) && method === 'PATCH') {
        reminders = [];
        return json({ reminders });
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('button', { name: /Reminders\s*Enabled/ }));
    const toggle = await screen.findByRole('switch', { name: `Reminders: ${firstStep.title}` });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    const input = screen.getAllByLabelText('Reminder date and time')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2099-11-03T09:45' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save time' })[0]!);
    await waitFor(() => expect(reminders[0]?.scheduledFor).toBe(new Date('2099-11-03T09:45').toISOString()));
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(reminders).toEqual([]);
    expect(screen.queryByText('No confirmed exact deadline')).toBeNull();
  });

  it('uses the calculated deadline and identifies an overdue unfinished step', async () => {
    const due = {
      ...firstStep,
      deadline: null,
      deadlineNote: 'No confirmed exact deadline',
      deadlineSchedule: {
        dueOn: '2020-01-01',
        dueAt: null,
        opensOn: null,
        reminderOn: '2019-12-31',
        kind: 'deadline',
        reason: null,
        timezone: 'Europe/Moscow',
      },
    };
    installSuccessfulApi(false, 'en', { ...baseRoute, nextAction: due, steps: [due] });
    render(<App />);
    expect(await screen.findByText('Overdue')).toBeTruthy();
    expect(screen.getByText('1 January 2020')).toBeTruthy();
    expect(screen.queryByText('No confirmed exact deadline')).toBeNull();
  });

  it('keeps a housing change pending until confirmation and displays the route diff', async () => {
    const fetchMock = installSuccessfulApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Change accommodation' }));
    await user.click(screen.getByLabelText('Private housing'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Review the change' })).toBeTruthy();
    const callsBeforeConfirm = fetchMock.mock.calls.map(([input]) => urlOf(input));
    expect(callsBeforeConfirm.some((url) => url.endsWith('/api/events/confirm'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('heading', { name: 'Route updated' })).toBeTruthy();
    expect(screen.getAllByText('Register private residence').length).toBeGreaterThan(0);
    expect(screen.getByText('Dorm check in')).toBeTruthy();

    const candidateCall = fetchMock.mock.calls.find(([input]) => urlOf(input).endsWith('/api/events/candidates'));
    expect(JSON.parse(String(candidateCall?.[1]?.body))).toEqual({
      type: 'ACCOMMODATION_CHANGED',
      accommodationType: 'private',
    });
    const confirmCall = fetchMock.mock.calls.find(([input]) => urlOf(input).endsWith('/api/events/confirm'));
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toEqual({ candidateId: 'candidate-1' });
  });

  it('keeps an arrival event pending until the user reviews and confirms its date', async () => {
    const fetchMock = installSuccessfulApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'I have arrived in my study city' }));
    const date = screen.getByLabelText('Actual arrival date in my study city') as HTMLInputElement;
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Review the arrival date' })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/api/events/confirm'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('heading', { name: 'Arrival recorded' })).toBeTruthy();
    const candidateCall = fetchMock.mock.calls.find(([input, init]) => {
      if (!urlOf(input).endsWith('/api/events/candidates')) return false;
      return JSON.parse(String(init?.body)).type === 'ARRIVAL_CONFIRMED';
    });
    expect(JSON.parse(String(candidateCall?.[1]?.body))).toMatchObject({
      type: 'ARRIVAL_CONFIRMED',
      arrivalDate: date.value,
    });
  });

  it('locks page scroll, closes a dialog with Escape, and restores focus', async () => {
    installSuccessfulApi();
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole('button', { name: /View instructions/i });
    await user.click(trigger);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('shares one re-authentication across concurrent 401 responses and retries each request once', async () => {
    let authCalls = 0;
    let protectedCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/api/auth/dev')) {
        authCalls += 1;
        return json({ token: authCalls === 1 ? 'expired-token' : 'fresh-token', user: profileResponse.user });
      }
      protectedCalls += 1;
      const headers = new Headers(init?.headers);
      if (headers.get('Authorization') === 'Bearer expired-token') {
        return json({ code: 'AUTH_REQUIRED', message: 'expired', requestId: 'req-expired' }, 401);
      }
      if (url.endsWith('/api/profile')) return json(profileResponse);
      if (url.endsWith('/api/route')) return json({ route: baseRoute });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await authenticate();
    const [profile, route] = await Promise.all([api.profile(), api.route()]);
    expect(profile.profile?.universityCode).toBe('ITMO');
    expect(route.route.id).toBe(baseRoute.id);
    expect(authCalls).toBe(2);
    expect(protectedCalls).toBe(4);
  });

  it('does not loop when the retried request is still unauthorized', async () => {
    let authCalls = 0;
    let profileCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).endsWith('/api/auth/dev')) {
          authCalls += 1;
          return json({ token: `token-${authCalls}`, user: profileResponse.user });
        }
        profileCalls += 1;
        return json({ code: 'AUTH_REQUIRED', message: 'expired', requestId: `req-${profileCalls}` }, 401);
      }),
    );
    await authenticate();
    await expect(api.profile()).rejects.toBeInstanceOf(ApiError);
    expect(authCalls).toBe(2);
    expect(profileCalls).toBe(2);
  });

  it('preserves onboarding input when a request still fails after re-authentication', async () => {
    let authCalls = 0;
    let onboardingCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.endsWith('/api/auth/dev')) {
          authCalls += 1;
          return json({ token: `token-${authCalls}`, user: profileResponse.user });
        }
        if (url.endsWith('/api/profile')) return json({ ...profileResponse, profile: null });
        if (url.endsWith('/api/universities')) return json(universityDirectory);
        if (url.endsWith('/api/onboarding')) {
          onboardingCalls += 1;
          return onboardingCalls === 1
            ? json({ code: 'AUTH_REQUIRED', message: 'expired' }, 401)
            : json({ code: 'SAVE_FAILED', message: 'try again' }, 500);
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'ru');
    expect(screen.getByRole('heading', { name: 'Составим план первых дел' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Университет' })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Язык' }), 'en');
    await user.selectOptions(screen.getByLabelText('Which university will you attend?'), 'ITMO');
    await user.type(screen.getByLabelText('Citizenship'), 'Russia');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const date = (await screen.findByLabelText('Arrival date in your study city, if known')) as HTMLInputElement;
    await user.type(date, '2026-09-20');
    await user.click(screen.getByLabelText('Not yet arrived in my study city'));
    await user.click(screen.getByLabelText('Private housing'));
    await user.click(screen.getByRole('button', { name: 'Show my first step' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(date.value).toBe('2026-09-20');
    expect((screen.getByLabelText('Private housing') as HTMLInputElement).checked).toBe(true);
    expect(authCalls).toBe(2);
    expect(onboardingCalls).toBe(2);
  });

  it('shows an authentication error and recovers with Retry', async () => {
    const healthyFetch = installSuccessfulApi();
    let firstAuth = true;
    const retryingFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (urlOf(input).endsWith('/api/auth/dev') && firstAuth) {
        firstAuth = false;
        throw new TypeError('offline');
      }
      return healthyFetch(input, init);
    });
    vi.stubGlobal('fetch', retryingFetch);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Не удалось войти' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Your plan for the first steps' })).toBeTruthy();
    expect(retryingFetch).toHaveBeenCalledTimes(4);
  });

  it('does not display an English proxy error in the Russian sign-in screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' })),
    );
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Не удалось войти' })).toBeTruthy();
    expect(screen.queryByText('Bad Gateway')).toBeNull();
    expect(screen.getByText('Проверьте соединение и повторите попытку.')).toBeTruthy();
    expect(screen.queryByText(/API_ERROR|Bad Gateway/)).toBeNull();
  });
});

it('edits a named release event without marking unprovided answers as no', async () => {
  const step: RouteStep = {
    ...firstStep,
    code: 'UNI_RELEASE_TEST',
    deadline: null,
    knowledge: {
      id: 'UNI_RELEASE_TEST',
      scope: 'university',
      title: 'Проверенное действие',
      summary: 'Описание',
      instructions: ['Подайте документы'],
      documents: [],
      destination: null,
      warnings: [],
      exceptions: [],
      unresolvedIds: [],
      deadlineKind: 'relative',
      deadlineNotes: ['После названного события'],
      reportedDeadlineText: null,
      result: null,
      triggerEvent: null,
      applicability: true,
      selection: 'included',
      sources: [],
      overlays: [],
      releaseVerified: true,
      inputs: [
        { key: 'document_received', label: 'Дата получения документа', kind: 'date', options: [], value: null },
        { key: 'has_document', label: 'Документ получен', kind: 'fact', options: [true, false], value: null },
      ],
    },
  };
  const fetchMock = installSuccessfulApi(false, 'en', { ...baseRoute, nextAction: step, steps: [step] });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'View instructions' }));
  expect(screen.queryByText(/This is a demonstration route/)).toBeNull();
  await userEvent.click(screen.getByText('Details for this action'));
  fireEvent.change(screen.getByLabelText('Дата получения документа'), { target: { value: '2026-09-29' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save answers' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/UNI_RELEASE_TEST/context'))).toBe(true),
  );
  const call = fetchMock.mock.calls.find(([input]) => urlOf(input).endsWith('/UNI_RELEASE_TEST/context'))!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ facts: {}, dates: { document_received: '2026-09-29' } });
});
