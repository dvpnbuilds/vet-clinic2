import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDashboard } from '../db/dashboard.js';
import { getDb, query } from '../db/client.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';
import { localDateTimeToIso } from '../db/scheduling.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-dashboard-test.db';

function clinicToday(profile) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

before(async () => {
  process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile, ACTIVE_CLINIC_PROFILE: 'ph' }
  });
  const profile = getActiveClinicProfile();
  const today = clinicToday(profile);
  const startsAt = localDateTimeToIso(today, '23:00', profile.timezone);
  const endsAt = new Date(new Date(startsAt).getTime() + 30 * 60 * 1000).toISOString();
  await query('UPDATE appointments SET starts_at = ?, ends_at = ?', [startsAt, endsAt]);
  await query('UPDATE vaccinations SET due_on = ?', [today]);
});

after(() => {
  getDb().close();
});

test('dashboard presents live calendar, pending confirmation, and vaccine follow-up data', async () => {
  const dashboard = await getDashboard();
  assert.equal(dashboard.calendar.length, 1);
  assert.equal(dashboard.pending.length, 1);
  assert.equal(dashboard.vaccines.length, 1);
});

test('recovered metric counts confirmed appointments with a sent reminder', async () => {
  const appointment = (await query('SELECT id, clinic_id FROM appointments LIMIT 1')).rows[0];
  await query('UPDATE appointments SET status = ?', ['confirmed']);
  await query(
    'INSERT INTO reminders (id, clinic_id, appointment_id, type, channel, due_at, sent_at, status, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), appointment.clinic_id, appointment.id, 'confirm', 'sms', new Date().toISOString(), new Date().toISOString(), 'sent', 'dashboard-metric']
  );
  const dashboard = await getDashboard();
  assert.equal(dashboard.recovered.appointments, 1);
  assert.equal(dashboard.recovered.centavos, 65000);
});

test('Western profile uses its own English copy without Taglish leakage', () => {
  process.env.ACTIVE_CLINIC_PROFILE = 'western';
  const profile = getActiveClinicProfile();
  const copy = JSON.stringify({ booking: profile.booking, chat: profile.chat, dashboard: profile.dashboard, reminders: profile.reminders });
  assert.equal(profile.language, 'english');
  assert.equal(/\b(kami|alaga|piliin|mag-book|hindi)\b/i.test(copy), false);
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
});
