import { readFile, unlink, writeFile } from 'node:fs/promises';

export {};

const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const mode = process.argv[2];
const statePath = process.env.PERSISTENCE_SMOKE_STATE ?? '/private/tmp/pervye30-persistence-smoke.json';

interface SmokeState {
  devUserId: string;
  reminderId: string;
  stepCode: string;
  completedCode: string;
  arrivalDate: string;
  scheduledFor: string;
}

if (mode !== 'prepare' && mode !== 'verify' && mode !== 'cleanup') {
  throw new Error('Usage: persistence-smoke.ts prepare|verify|cleanup');
}

function stage(message: string): void {
  console.info(`[persistence] ${message}`);
}

async function waitForApi(maxAttempts = 60): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok) {
        stage(`readiness OK (${baseUrl})`);
        return;
      }
    } catch {
      // Restart briefly resets network connections; the bounded retry is intentional.
    }
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become ready at ${baseUrl} within ${maxAttempts * 500}ms`);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function authenticate(devUserId: string): Promise<string> {
  const auth = await request<{ token: string }>('/api/auth/dev', {
    method: 'POST',
    body: JSON.stringify({ devUserId }),
  });
  return auth.token;
}

async function loadState(): Promise<SmokeState> {
  return JSON.parse(await readFile(statePath, 'utf8')) as SmokeState;
}

await waitForApi();

if (mode === 'prepare') {
  const devUserId = `persistence-smoke-${Date.now()}`;
  const token = await authenticate(devUserId);
  stage(`created isolated user ${devUserId}`);
  const onboarded = await request<{
    route: { steps: Array<{ code: string }>; version: number };
  }>(
    '/api/onboarding',
    {
      method: 'POST',
      body: JSON.stringify({
        preferredLanguage: 'en',
        universityCode: 'ITMO',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'dormitory',
      }),
    },
    token,
  );
  const completedCode = onboarded.route.steps.find((step) => step.code === 'CHECK_ENTRY_REQUIREMENTS')?.code;
  if (!completedCode) throw new Error('Stable smoke step is missing');
  await request(
    `/api/route/steps/${completedCode}/status`,
    { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) },
    token,
  );
  stage(`completed step ${completedCode}`);

  const arrivalDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const candidate = await request<{ candidate: { id: string } }>(
    '/api/events/candidates',
    { method: 'POST', body: JSON.stringify({ type: 'ARRIVAL_CONFIRMED', arrivalDate }) },
    token,
  );
  await request(
    '/api/events/confirm',
    { method: 'POST', body: JSON.stringify({ candidateId: candidate.candidate.id }) },
    token,
  );
  stage(`confirmed arrival event for ${arrivalDate}`);

  await request('/api/reminders/opt-in', { method: 'POST', body: '{}' }, token);
  const route = await request<{ route: { nextAction: { code: string } | null } }>('/api/route', {}, token);
  if (!route.route.nextAction) throw new Error('No next action for persisted reminder');
  const scheduledFor = new Date(Date.now() + 8_000).toISOString();
  const reminder = await request<{ reminder: { id: string } }>(
    '/api/reminders',
    {
      method: 'POST',
      body: JSON.stringify({ stepCode: route.route.nextAction.code, scheduledFor }),
    },
    token,
  );
  const state: SmokeState = {
    devUserId,
    reminderId: reminder.reminder.id,
    stepCode: route.route.nextAction.code,
    completedCode,
    arrivalDate,
    scheduledFor,
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  stage(`scheduled reminder ${state.reminderId} for ${state.stepCode} at ${scheduledFor}`);
  stage(`prepare complete; state saved at ${statePath}`);
} else {
  const state = await loadState();
  const token = await authenticate(state.devUserId);
  if (mode === 'cleanup') {
    await request('/api/dev/users/me', { method: 'DELETE' }, token);
    await unlink(statePath).catch(() => undefined);
    stage(`cleanup complete for ${state.devUserId}`);
  } else {
    const profile = await request<{
      profile: { arrivalStatus: string; arrivalDate: string; remindersEnabled: boolean } | null;
    }>('/api/profile', {}, token);
    const route = await request<{
      route: { steps: Array<{ code: string; status: string }>; archivedCompleted: string[] };
    }>('/api/route', {}, token);
    if (profile.profile?.arrivalStatus !== 'arrived' || profile.profile.arrivalDate !== state.arrivalDate) {
      throw new Error('Confirmed arrival event was lost across restart');
    }
    if (!profile.profile.remindersEnabled) throw new Error('Reminder consent was lost across restart');
    const completedStillVisible = route.route.steps.some(
      (step) => step.code === state.completedCode && step.status === 'COMPLETED',
    );
    if (!completedStillVisible && !route.route.archivedCompleted.includes(state.completedCode)) {
      throw new Error('Completed step was lost across restart/recalculation');
    }
    stage('profile, confirmed event, route, and completed step survived restart');

    const dueAt = new Date(state.scheduledFor).getTime();
    while (Date.now() < dueAt + 250) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, dueAt + 250 - Date.now())));
    }
    await request('/api/dev/worker/tick', { method: 'POST', body: '{}' }, token);
    await request('/api/dev/worker/tick', { method: 'POST', body: '{}' }, token);
    const deliveries = await request<{ items: Array<{ outboxId: string; payload: Record<string, unknown> }> }>(
      '/api/dev/max/deliveries',
      {},
      token,
    );
    const matching = deliveries.items.filter(
      (delivery) =>
        delivery.payload.stepCode === state.stepCode && JSON.stringify(delivery.payload).includes(state.stepCode),
    );
    if (matching.length !== 1) {
      throw new Error(`Expected exactly one delivery for ${state.stepCode}, received ${matching.length}`);
    }
    const payloadText = JSON.stringify(matching[0]!.payload);
    if (!payloadText.includes('open_app') || !payloadText.includes(state.stepCode)) {
      throw new Error('Reminder delivery has no step deep link/highlight payload');
    }
    stage(`worker ticks are idempotent: exactly one delivery for ${state.stepCode}`);
    stage('deep link/highlight payload verified');
    stage('verify complete');
  }
}
