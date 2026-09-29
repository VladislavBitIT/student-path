import { randomUUID } from 'node:crypto';

// This script changes synthetic data and may tick the mock worker. Reject public
// hosts before making any request, then verify the provider before dev auth.
const target = new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000');
if (
  !['http:', 'https:'].includes(target.protocol) ||
  !['localhost', '127.0.0.1', '[::1]', 'api'].includes(target.hostname) ||
  target.username ||
  target.password ||
  target.pathname !== '/' ||
  target.search ||
  target.hash
) {
  throw new Error(
    'Mock smoke requires a local API origin (localhost, 127.0.0.1, [::1] or Docker api); no requests sent',
  );
}
const baseUrl = target.origin;

type Step = {
  id: string;
  code: string;
  scope: string;
  status: string;
  isActive: boolean;
  title: string;
  knowledge?: { instructions: string[]; sources: Array<{ title: string; url: string }> };
};
type Progress = { completed: number; total: number; percent: number };
type Route = {
  id: string;
  version: number;
  steps: Step[];
  archivedCompleted: string[];
  progress: Progress;
  nextAction: Step | null;
};
type Profile = {
  user: { id: string; maxUserId: string; preferredLanguage: string };
  profile: {
    userId: string;
    universityCode: string;
    countryOrRegion: string;
    arrivalStatus: string;
    accommodationType: string;
    remindersEnabled: boolean;
    attributes: Record<string, unknown>;
  };
};
type Auth = { token: string; user: Profile['user'] };
type ReminderList = { reminders: Array<{ stepCode: string; scheduledFor: string }> };

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  // Never print bodies: auth responses contain the session token.
  check(response.status === 200, `${init.method ?? 'GET'} ${path}: expected HTTP 200, received ${response.status}`);
  return (await response.json()) as T;
}

function checkProgress(route: Route) {
  const active = route.steps.filter((step) => step.isActive);
  const completed = active.filter((step) => step.status === 'COMPLETED').length;
  check(route.progress.total === active.length, 'Progress total differs from active steps');
  check(route.progress.completed === completed, 'Progress completed differs from step statuses');
  check(
    route.progress.percent === (active.length === 0 ? 0 : Math.round((completed / active.length) * 100)),
    'Progress percentage is inconsistent',
  );
}

const live = await request<{ status: string }>('/health/live');
check(live.status === 'ok', 'API is not live');
const ready = await request<{ status: string; database: string; maxProvider: string }>('/health/ready');
check(
  ready.status === 'ready' && ready.database === 'ok' && ready.maxProvider === 'mock',
  'Mock smoke requires a ready database and MAX_PROVIDER=mock; dev auth was not attempted',
);

const devUserId = `smoke-${randomUUID()}`;
const signIn = () => request<Auth>('/api/auth/dev', { method: 'POST', body: JSON.stringify({ devUserId }) });
const auth = await signIn();
check(auth.token && auth.user.id && auth.user.maxUserId === devUserId, 'Synthetic authentication failed');
const token = auth.token;
try {
  const onboarding = await request<{ route: Route }>(
    '/api/onboarding',
    {
      method: 'POST',
      body: JSON.stringify({
        preferredLanguage: 'en',
        universityCode: 'ITMO',
        campusCode: 'main',
        citizenshipType: 'foreign',
        citizenshipCountry: 'KZ',
        entryMode: 'visa_free',
        russiaPresence: 'no',
        studyArrival: 'no',
        mobilityStatus: 'moving',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'dormitory',
      }),
    },
    token,
  );
  check(
    onboarding.route.steps.length >= 2 &&
      onboarding.route.steps.some((step) => step.scope === 'general') &&
      onboarding.route.steps.some((step) => step.scope === 'university'),
    'Route must contain applicable common and university steps',
  );
  const profile = await request<Profile>('/api/profile', {}, token);
  check(
    profile.user.id === auth.user.id &&
      profile.user.preferredLanguage === 'en' &&
      profile.profile.userId === auth.user.id &&
      profile.profile.universityCode === 'ITMO' &&
      profile.profile.countryOrRegion === 'KZ' &&
      profile.profile.arrivalStatus === 'preparing' &&
      profile.profile.accommodationType === 'dormitory' &&
      profile.profile.attributes.studyArrival === 'no' &&
      profile.profile.attributes.russiaPresence === 'no',
    'Onboarding profile was not persisted',
  );
  const { route } = await request<{ route: Route }>('/api/route', {}, token);
  checkProgress(route);
  check(route.id === onboarding.route.id && route.progress.completed === 0, 'New route must start with zero progress');
  const next = await request<{ nextAction: Step | null; progress: Progress }>('/api/next-action', {}, token);
  check(
    next.nextAction &&
      next.nextAction.code === route.nextAction?.code &&
      route.steps.some((step) => step.code === next.nextAction?.code) &&
      JSON.stringify(next.progress) === JSON.stringify(route.progress),
    'Next action must match the active route and progress',
  );
  // Select an actual active card with instructions and evidence, independent of
  // catalogue ordering and historical card codes.
  const first = route.steps
    .filter((step) => step.isActive && step.status === 'NOT_STARTED')
    .sort((a, b) => a.code.localeCompare(b.code))
    .find((step) => step.knowledge?.instructions.length && step.knowledge.sources.length);
  check(first, 'Route has no actionable step with instructions and sources');
  const detail = await request<{ step: Step }>(`/api/route/steps/${encodeURIComponent(first.id)}`, {}, token);
  check(
    detail.step.id === first.id &&
      detail.step.code === first.code &&
      detail.step.title &&
      detail.step.knowledge?.instructions.some((text) => text.trim().length > 0) &&
      detail.step.knowledge.sources.some((source) => source.title && /^https?:\/\//.test(source.url)),
    'Step detail must contain its instruction and published sources',
  );
  for (const status of ['IN_PROGRESS', 'COMPLETED']) {
    const result = await request<{ route: Route }>(
      `/api/route/steps/${encodeURIComponent(first.code)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
      token,
    );
    check(result.route.steps.find((step) => step.id === first.id)?.status === status, `Step did not become ${status}`);
    checkProgress(result.route);
    check(result.route.progress.total === route.progress.total, `Step total changed after ${status}`);
    check(result.route.progress.completed === (status === 'COMPLETED' ? 1 : 0), `Wrong progress after ${status}`);
  }
  console.info('PASS: onboarding, profile, route, next action, step detail and progress');

  const consent = await request<{ remindersEnabled: boolean }>(
    '/api/reminders/opt-in',
    { method: 'POST', body: '{}' },
    token,
  );
  check(consent.remindersEnabled === true, 'Reminder consent was not enabled');
  const { route: completedRoute } = await request<{ route: Route }>('/api/route', {}, token);
  const reminderStep = completedRoute.nextAction;
  check(reminderStep && reminderStep.code !== first.code, 'No unfinished next action for reminder');
  const reminderCode = reminderStep.code;
  const reminderPath = `/api/reminders/${encodeURIComponent(reminderCode)}`;
  const listReminders = (session = token) => request<ReminderList>('/api/reminders', {}, session);
  const scheduledFor = new Date(Date.now() + 86_400_000).toISOString();
  const replacement = new Date(Date.now() + 172_800_000).toISOString();
  for (const time of [scheduledFor, replacement]) {
    const created = await request<{ reminder: { userId: string; userStepId: string; scheduledFor: string } }>(
      '/api/reminders',
      { method: 'POST', body: JSON.stringify({ stepCode: reminderCode, scheduledFor: time }) },
      token,
    );
    check(
      created.reminder.userId === auth.user.id &&
        created.reminder.userStepId === reminderStep.id &&
        created.reminder.scheduledFor === time,
      'Reminder response differs from the requested user, step or time',
    );
    const matching = (await listReminders()).reminders.filter((reminder) => reminder.stepCode === reminderCode);
    check(matching.length === 1 && matching[0]?.scheduledFor === time, 'Reminder time was not saved or replaced');
  }
  const reminderSession = await signIn();
  check(reminderSession.user.id === auth.user.id, 'Reminder session resolved a different user');
  const persistedTime = (await listReminders(reminderSession.token)).reminders.filter(
    (reminder) => reminder.stepCode === reminderCode,
  );
  check(
    persistedTime.length === 1 && persistedTime[0]?.scheduledFor === replacement,
    'Updated reminder time did not survive a fresh session',
  );
  const disabled = await request<ReminderList>(reminderPath, { method: 'PATCH', body: '{"mode":"off"}' }, token);
  check(!disabled.reminders.some((reminder) => reminder.stepCode === reminderCode), 'Reminder was not disabled');
  check(
    !(await listReminders()).reminders.some((reminder) => reminder.stepCode === reminderCode),
    'Disabled reminder is still listed',
  );

  const again = await signIn();
  check(again.user.id === auth.user.id && again.token, 'Repeat authentication did not resolve the same user');
  const persistedProfile = await request<Profile>('/api/profile', {}, again.token);
  const persistedRoute = (await request<{ route: Route }>('/api/route', {}, again.token)).route;
  checkProgress(persistedRoute);
  check(
    persistedProfile.profile.userId === auth.user.id &&
      persistedProfile.user.preferredLanguage === 'en' &&
      persistedProfile.profile.universityCode === profile.profile.universityCode &&
      persistedProfile.profile.countryOrRegion === profile.profile.countryOrRegion &&
      persistedProfile.profile.accommodationType === 'dormitory' &&
      persistedProfile.profile.remindersEnabled &&
      (persistedProfile.profile.attributes.reminderModes as Record<string, string>)[reminderStep.id] === 'off' &&
      persistedRoute.id === route.id &&
      persistedRoute.steps.find((step) => step.id === first.id)?.status === 'COMPLETED' &&
      persistedRoute.progress.completed === 1 &&
      !(await listReminders(again.token)).reminders.some((reminder) => reminder.stepCode === reminderCode),
    'Profile, completed step, progress or disabled reminder did not survive a fresh session',
  );
  console.info('PASS: reminder creation, replacement, disabling and persistence after repeat authentication');

  // Keep the pre-existing mock delivery/event/fallback checks after the main
  // scenario, so accelerated delivery cannot substitute for manual time checks.
  await request(
    '/api/reminders',
    { method: 'POST', body: JSON.stringify({ stepCode: reminderCode, demoInSeconds: 1 }) },
    token,
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await request('/api/dev/worker/tick', { method: 'POST', body: '{}' }, token);
    const current = await request<{ items: unknown[] }>('/api/dev/max/deliveries', {}, token);
    if (current.items.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await request('/api/dev/worker/tick', { method: 'POST', body: '{}' }, token);
  const deliveries = await request<{ items: unknown[] }>('/api/dev/max/deliveries', {}, token);
  check(deliveries.items.length === 1, `Expected exactly one mock delivery, received ${deliveries.items.length}`);
  const candidate = await request<{ candidate: { id: string } }>(
    '/api/events/candidates',
    { method: 'POST', body: JSON.stringify({ type: 'ACCOMMODATION_CHANGED', accommodationType: 'private' }) },
    token,
  );
  check(candidate.candidate.id, 'Accommodation change candidate has no id');
  const changed = await request<{
    route: Route;
    diff: { added: string[]; deactivated: string[]; hasMeaningfulChanges: boolean };
  }>('/api/events/confirm', { method: 'POST', body: JSON.stringify({ candidateId: candidate.candidate.id }) }, token);
  check(
    (await request<Profile>('/api/profile', {}, token)).profile.accommodationType === 'private' &&
      changed.route.version > persistedRoute.version &&
      changed.diff.hasMeaningfulChanges &&
      changed.diff.added.every((code) => changed.route.steps.some((step) => step.code === code)) &&
      changed.diff.deactivated.every((code) => !changed.route.steps.some((step) => step.code === code)),
    'Accommodation event did not persist or recalculate the route consistently',
  );
  check(
    changed.route.steps.some((step) => step.code === first.code && step.status === 'COMPLETED') ||
      changed.route.archivedCompleted.includes(first.code),
    'Completed step was lost after accommodation change',
  );
  checkProgress(changed.route);
  const unknown = await request<{ answer: { status: string; sources: unknown[]; contact: unknown } }>(
    '/api/knowledge/query',
    { method: 'POST', body: JSON.stringify({ question: 'quantum submarine parking permit' }) },
    token,
  );
  check(
    unknown.answer.status === 'not_found' && unknown.answer.sources.length === 0 && unknown.answer.contact,
    'Unknown question did not use safe fallback',
  );
  await request('/api/reminders/opt-out', { method: 'POST', body: '{}' }, token);
  check((await listReminders()).reminders.length === 0, 'Synthetic user still has scheduled reminders');
  console.info('PASS: one mock delivery, confirmed event and safe unknown-question fallback');
} finally {
  const cleanup = await request<{ deleted: boolean }>('/api/dev/users/me', { method: 'DELETE' }, token);
  check(cleanup.deleted, 'Synthetic user cleanup failed');
}
console.info('Mock demo smoke passed. Synthetic data only; real MAX video and delivery are not verified.');
