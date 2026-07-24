import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';
import { getDashboard } from '../db/dashboard.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';
import { localDateTimeToIso } from '../db/scheduling.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-western-seed-test.db';
process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
process.env.ACTIVE_CLINIC_PROFILE = 'western';

before(async () => {
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile, ACTIVE_CLINIC_PROFILE: 'western' }
  });
});

after(() => {
  getDb().close();
});

function clinicDate(profile, now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clinicHour(profile, value) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: profile.timezone,
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value)).find((part) => part.type === 'hour').value);
}

test('Western seeding uses its own clinic, staff, owner, pet, and vaccine profile data', async () => {
  const clinic = (await query('SELECT name, currency FROM clinics LIMIT 1')).rows[0];
  const appointment = (await query(
    'SELECT v.name AS vet_name, o.name AS owner_name, p.name AS pet_name, p.breed, vaccination.name AS vaccine_name FROM appointments a JOIN vets v ON v.id = a.vet_id JOIN owners o ON o.id = a.owner_id JOIN pets p ON p.id = a.pet_id JOIN vaccinations vaccination ON vaccination.pet_id = p.id LIMIT 1'
  )).rows[0];

  assert.deepEqual(clinic, { name: 'Harbour Veterinary', currency: 'AUD' });
  assert.deepEqual(appointment, {
    vet_name: 'Dr. Charlotte Reid',
    owner_name: 'Amelia Harris',
    pet_name: 'Scout',
    breed: 'Australian Kelpie',
    vaccine_name: 'C5'
  });
});

test('Western analytics reconciles its busiest local slot without a fixed UTC offset', async () => {
  const profile = getActiveClinicProfile();
  const dashboard = await getDashboard();
  const monthStart = localDateTimeToIso(shiftDate(clinicDate(profile), -29), '00:00', profile.timezone);
  const rows = (await query(
    'SELECT starts_at FROM appointments WHERE clinic_id = ? AND starts_at >= ? AND starts_at < ? AND status NOT IN (?, ?)',
    [profile.id, monthStart, new Date().toISOString(), 'cancelled', 'rescheduled']
  )).rows;
  const counts = new Map();
  for (const row of rows) {
    const hour = clinicHour(profile, row.starts_at);
    counts.set(hour, (counts.get(hour) || 0) + 1);
  }
  const [hour, appointments] = [...counts].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];

  assert.equal(profile.timezone, 'Australia/Sydney');
  assert.deepEqual(dashboard.analytics.busiest.slot, { hour, appointments });
});
