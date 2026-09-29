/** Run only against a restored, disposable local copy, never the working DB. */
import { createDatabase } from '@first30/database';
import { runMigrations } from '../apps/api/src/migrate.js';
import { runSeed } from '../apps/api/src/seed.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const parsed = new URL(url);
if (!['localhost', '127.0.0.1', 'postgres'].includes(parsed.hostname) || !parsed.pathname.endsWith('_copy'))
  throw new Error('A disposable local *_copy database is required');
const connection = createDatabase(url);
try {
  const completed = await connection.pool.query(
    "select id,status,completed_at from user_steps where status='COMPLETED'",
  );
  const manual = await connection.pool.query(
    "select id,user_id,user_step_id,scheduled_for,status from reminders where idempotency_key not like 'knowledge:%'",
  );
  const users = await connection.pool.query('select id from users');
  const profiles = await connection.pool.query('select user_id,arrival_date,country_or_region from user_profiles');
  await runMigrations(url);
  await runSeed(url, { includeDemoUsers: false });
  const first = (
    await connection.pool.query('select report_json from knowledge_imports order by imported_at desc limit 1')
  ).rows[0].report_json;
  await runSeed(url, { includeDemoUsers: false });
  const second = (
    await connection.pool.query('select report_json from knowledge_imports order by imported_at desc limit 1')
  ).rows[0].report_json;
  let cancelled = 0;
  for (const row of completed.rows) {
    const after = (await connection.pool.query('select id,status,completed_at from user_steps where id=$1', [row.id]))
      .rows[0];
    if (JSON.stringify(row) !== JSON.stringify(after)) throw new Error('Completed progress changed');
  }
  for (const row of manual.rows) {
    const after = (
      await connection.pool.query('select id,user_id,user_step_id,scheduled_for,status from reminders where id=$1', [
        row.id,
      ])
    ).rows[0];
    if (
      !after ||
      row.user_id !== after.user_id ||
      row.user_step_id !== after.user_step_id ||
      +row.scheduled_for !== +after.scheduled_for
    )
      throw new Error('A manual reminder was removed or reassigned');
    if (row.status !== after.status) cancelled++;
  }
  for (const row of users.rows)
    if (!(await connection.pool.query('select 1 from users where id=$1', [row.id])).rowCount)
      throw new Error('A user was removed');
  for (const row of profiles.rows) {
    const after = (
      await connection.pool.query('select user_id,arrival_date,country_or_region from user_profiles where user_id=$1', [
        row.user_id,
      ])
    ).rows[0];
    if (JSON.stringify(row) !== JSON.stringify(after)) throw new Error('Profile identity or dates changed');
  }
  console.info(
    JSON.stringify(
      {
        valid: true,
        first: { universities: first.universities, cards: first.cards, federalOverrides: first.federalOverrides },
        second: { universities: second.universities, cards: second.cards, federalOverrides: second.federalOverrides },
        preserved: {
          users: users.rowCount,
          profiles: profiles.rowCount,
          completed: completed.rowCount,
          manualReminders: manual.rowCount,
        },
        cancelledBecauseNoLongerApplicable: cancelled,
      },
      null,
      2,
    ),
  );
} finally {
  await connection.close();
}
