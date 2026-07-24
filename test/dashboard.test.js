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

function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function percentage(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
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
  const currentAppointment = (await query('SELECT id FROM appointments WHERE status = ? LIMIT 1', ['pending'])).rows[0];
  await query('UPDATE appointments SET starts_at = ?, ends_at = ? WHERE id = ?', [startsAt, endsAt, currentAppointment.id]);
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
  const appointment = (await query('SELECT id, clinic_id FROM appointments WHERE status = ? LIMIT 1', ['pending'])).rows[0];
  const before = await getDashboard();
  await query('UPDATE appointments SET status = ? WHERE id = ?', ['confirmed', appointment.id]);
  await query(
    'INSERT INTO reminders (id, clinic_id, appointment_id, type, channel, due_at, sent_at, status, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), appointment.clinic_id, appointment.id, 'confirm', 'sms', new Date().toISOString(), new Date().toISOString(), 'sent', 'dashboard-metric']
  );
  const dashboard = await getDashboard();
  assert.equal(dashboard.recovered.appointments, before.recovered.appointments + 1);
  assert.equal(dashboard.recovered.centavos, before.recovered.centavos + 65000);
});

test('analytics figures reconcile to persisted appointment and reminder counts', async () => {
  const profile = getActiveClinicProfile();
  const dashboard = await getDashboard();
  const date = clinicToday(profile);
  const monthStart = new Date(date + 'T00:00:00.000Z');
  monthStart.setUTCDate(monthStart.getUTCDate() - 29);
  const now = new Date().toISOString();
  const monthStartIso = localDateTimeToIso(monthStart.toISOString().slice(0, 10), '00:00', profile.timezone);
  const noShowDays = await Promise.all(dashboard.analytics.noShows.days.map(async (day) => {
    const startsAt = localDateTimeToIso(day.date, '00:00', profile.timezone);
    const endsAt = localDateTimeToIso(shiftDate(day.date, 1), '00:00', profile.timezone);
    const noShows = (await query(
      'SELECT COUNT(*) AS count FROM appointments WHERE clinic_id = ? AND starts_at >= ? AND starts_at < ? AND starts_at < ? AND status = ?',
      [profile.id, startsAt, endsAt, now, 'no_show']
    )).rows[0].count;
    const closedVisits = (await query(
      'SELECT COUNT(*) AS count FROM appointments WHERE clinic_id = ? AND starts_at >= ? AND starts_at < ? AND starts_at < ? AND status IN (?, ?)',
      [profile.id, startsAt, endsAt, now, 'completed', 'no_show']
    )).rows[0].count;
    return { date: day.date, noShows: Number(noShows), closedVisits: Number(closedVisits), rate: percentage(Number(noShows), Number(closedVisits)) };
  }));
  const busiestService = (await query(
    'SELECT s.name, COUNT(*) AS count FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.clinic_id = ? AND a.starts_at >= ? AND a.starts_at < ? AND a.status NOT IN (?, ?) GROUP BY s.id, s.name ORDER BY count DESC, s.name LIMIT 1',
    [profile.id, monthStartIso, now, 'cancelled', 'rescheduled']
  )).rows[0];
  const busiestSlot = (await query(
    "SELECT strftime('%H', starts_at, '+08:00') AS hour, COUNT(*) AS count FROM appointments WHERE clinic_id = ? AND starts_at >= ? AND starts_at < ? AND status NOT IN (?, ?) GROUP BY hour ORDER BY count DESC, hour LIMIT 1",
    [profile.id, monthStartIso, now, 'cancelled', 'rescheduled']
  )).rows[0];
  const conversion = (await query(
    'SELECT COUNT(*) AS sent, COALESCE(SUM(CASE WHEN a.status IN (?, ?) THEN 1 ELSE 0 END), 0) AS confirmed FROM reminders r JOIN appointments a ON a.id = r.appointment_id AND a.clinic_id = r.clinic_id WHERE r.clinic_id = ? AND r.type = ? AND r.sent_at IS NOT NULL',
    ['confirmed', 'completed', profile.id, 'confirm']
  )).rows[0];
  const campaign = (await query(
    'SELECT COUNT(*) AS sent, COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.clinic_id = r.clinic_id AND a.pet_id = r.pet_id AND a.starts_at >= r.sent_at AND a.status IN (?, ?)) THEN 1 ELSE 0 END), 0) AS recovered FROM reminders r WHERE r.clinic_id = ? AND r.type = ? AND r.sent_at IS NOT NULL',
    ['confirmed', 'completed', profile.id, 'vaccine_due']
  )).rows[0];

  assert.deepEqual(dashboard.analytics.noShows.days, noShowDays);
  assert.equal(dashboard.analytics.noShows.noShows, noShowDays.reduce((total, day) => total + day.noShows, 0));
  assert.equal(dashboard.analytics.noShows.closedVisits, noShowDays.reduce((total, day) => total + day.closedVisits, 0));
  assert.equal(dashboard.analytics.noShows.rate, percentage(dashboard.analytics.noShows.noShows, dashboard.analytics.noShows.closedVisits));
  assert.deepEqual(dashboard.analytics.busiest.service, { name: busiestService.name, appointments: Number(busiestService.count) });
  assert.deepEqual(dashboard.analytics.busiest.slot, { hour: Number(busiestSlot.hour), appointments: Number(busiestSlot.count) });
  assert.deepEqual(dashboard.analytics.reminderConversion, {
    sent: Number(conversion.sent),
    confirmed: Number(conversion.confirmed),
    rate: Math.round((Number(conversion.confirmed) / Number(conversion.sent)) * 1000) / 10
  });
  assert.deepEqual(dashboard.analytics.vaccineCampaign, {
    sent: Number(campaign.sent),
    recovered: Number(campaign.recovered),
    rate: Math.round((Number(campaign.recovered) / Number(campaign.sent)) * 1000) / 10
  });
});

test('Western profile uses its own English copy without Taglish leakage', () => {
  process.env.ACTIVE_CLINIC_PROFILE = 'western';
  const profile = getActiveClinicProfile();
  const copy = JSON.stringify({ booking: profile.booking, chat: profile.chat, dashboard: profile.dashboard, reminders: profile.reminders });
  assert.equal(profile.language, 'english');
  assert.equal(/\b(kami|alaga|piliin|mag-book|hindi)\b/i.test(copy), false);
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
});
