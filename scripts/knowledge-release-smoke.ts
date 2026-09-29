import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDatabase, users } from '@first30/database';
import { RouteService, createSessionToken } from '@first30/application';

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.SESSION_SECRET;
if (!databaseUrl || !secret) throw new Error('DATABASE_URL and SESSION_SECRET are required');
const base = process.env.RELEASE_SMOKE_API_URL ?? 'http://api:3000';
const host = new URL(base).hostname;
if (!['api', 'localhost', '127.0.0.1'].includes(host)) throw new Error('Smoke must target the internal API');
const connection = createDatabase(databaseUrl);
let userId: string | undefined;
try {
  const user = await new RouteService(connection.db).ensureUser(`release-smoke-${randomUUID()}`, 'ru');
  userId = user.id;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const token = createSessionToken({ userId: user.id, maxUserId: user.maxUserId }, secret);
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Smoke HTTP ${response.status} at ${path}`);
    return response.json() as Promise<{
      route: { steps: { code: string; status: string; deadline: string | null }[]; progress: { completed: number } };
      profile?: { countryOrRegion: string; attributes: { studyArrival: string } };
      reminders?: unknown[];
    }>;
  };
  await request('/health/ready');
  await request('/api/onboarding', 'POST', {
    preferredLanguage: 'ru',
    universityCode: 'ITMO',
    arrivalStatus: 'preparing',
    arrivalDate: null,
    accommodationType: 'dormitory',
    citizenshipType: 'foreign',
    citizenshipCountry: 'IN',
    studyArrival: 'no',
    russiaPresence: 'no',
    housingStatus: 'applied',
    entryMode: 'visa',
  });
  const code = 'UNI_ITMO_PREARRIVAL_NOTIFY';
  const initial = await request('/api/route');
  if (!initial.route.steps.some((s) => s.code === code)) throw new Error('Released action absent from actual API');
  const profile = await request('/api/profile');
  if (profile.profile?.countryOrRegion !== 'IN' || profile.profile.attributes.studyArrival !== 'no')
    throw new Error('Onboarding facts not persisted');
  if ((await request('/api/reminders')).reminders?.length !== 0) throw new Error('Unexpected reminder for new user');
  const started = await request(`/api/route/steps/${code}/status`, 'PATCH', { status: 'IN_PROGRESS' });
  if (started.route.steps.find((s) => s.code === code)?.status !== 'IN_PROGRESS') throw new Error('Start not saved');
  const dated = await request(`/api/route/steps/${code}/context`, 'PATCH', {
    facts: {},
    dates: { entry_to_russia: '2030-10-20' },
  });
  if (dated.route.steps.find((s) => s.code === code)?.deadline !== '2030-10-10')
    throw new Error('Event deadline not calculated');
  await request(`/api/route/steps/${code}/status`, 'PATCH', { status: 'COMPLETED' });
  const reopened = await request('/api/route');
  if (reopened.route.steps.find((s) => s.code === code)?.status !== 'COMPLETED')
    throw new Error('Completion lost after new session');
  console.info(
    'Release smoke passed: ready, persisted onboarding facts, reminder list, in-progress status, explicit deadline, completion, new session. No MAX messages sent.',
  );
} finally {
  if (userId) await connection.db.delete(users).where(eq(users.id, userId));
  await connection.close();
}
