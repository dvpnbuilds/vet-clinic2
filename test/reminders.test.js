import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';
import {
  applyOwnerAction,
  listUnconfirmedAppointments,
  processReminderCron,
  retryReminder
} from '../db/reminders.js';
import { notify } from '../notify/index.js';
import { localDateTimeToIso } from '../db/scheduling.js';
import retryHandler from '../api/reminders/[id]/retry.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-reminders-test.db';
const deliveredPayloads = [];
let app;

async function request(path, options = {}) {
  const server = await new Promise((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const response = await fetch('http://127.0.0.1:' + server.address().port + path, options);
  await new Promise((resolve) => server.close(resolve));
  return response;
}

before(async () => {
  process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
  process.env.DRY_RUN = 'true';
  process.env.CRON_SECRET = 'cron-test';
  process.env.STAFF_PASSCODE = 'staff-test';
  process.env.NODE_ENV = 'test';
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile }
  });
  ({ default: app } = await import('../server.js'));
});

after(() => {
  getDb().close();
});

test('cron sends due records once and stays idempotent when repeated', async () => {
  const sendNotification = async (payload) => {
    deliveredPayloads.push(payload);
    return { providerMessageId: 'test-' + deliveredPayloads.length };
  };
  const first = await processReminderCron({
    now: new Date(Date.now() + 2_000),
    sendNotification
  });
  const second = await processReminderCron({
    now: new Date(Date.now() + 3_000),
    sendNotification
  });

  assert.equal(first.failed.length, 0);
  assert.ok(first.delivered.length > 0);
  assert.equal(second.delivered.length, 0);
  assert.equal(deliveredPayloads.length, first.delivered.length);
  assert.ok(deliveredPayloads[0].message.includes('/api/owner/confirm?token='));
  assert.ok(deliveredPayloads[0].message.includes('/api/owner/reschedule?token='));
});

test('an ambiguous post-delivery persistence failure is held and never resent automatically', async () => {
  const appointment = (await query('SELECT id, clinic_id FROM appointments LIMIT 1')).rows[0];
  const reminderId = randomUUID();
  await query(
    'INSERT INTO reminders (id, clinic_id, appointment_id, type, channel, due_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [reminderId, appointment.clinic_id, appointment.id, 'confirm', 'sms', '2026-07-01T00:00:00.000Z', 'ambiguous-' + reminderId]
  );

  const delivered = [];
  const first = await processReminderCron({
    now: new Date('2026-07-03T12:00:00.000Z'),
    sendNotification: async (payload) => {
      delivered.push(payload);
      return { providerMessageId: 'provider-accepted' };
    },
    markReminderSent: async () => {
      throw new Error('Turso write failed after provider acceptance');
    }
  });

  assert.equal(delivered.length, 1);
  assert.ok(first.failed.some((item) => item.id === reminderId));
  assert.equal((await query('SELECT status FROM reminders WHERE id = ?', [reminderId])).rows[0].status, 'failed');
  assert.equal((await query('SELECT outcome FROM reminder_delivery_attempts WHERE reminder_id = ?', [reminderId])).rows[0].outcome, 'uncertain');

  await processReminderCron({
    now: new Date('2026-07-03T12:10:00.000Z'),
    sendNotification: async (payload) => {
      delivered.push(payload);
      return { providerMessageId: 'should-not-send' };
    }
  });
  assert.equal(delivered.length, 1);

  const retried = await retryReminder(reminderId, {
    now: new Date('2026-07-03T12:20:00.000Z'),
    sendNotification: async () => ({ providerMessageId: 'staff-reconciled' })
  });
  assert.equal(retried.status, 'sent');
  assert.equal((await query('SELECT status FROM reminders WHERE id = ?', [reminderId])).rows[0].status, 'sent');
  assert.equal((await query('SELECT COUNT(*) AS count FROM reminder_delivery_attempt_history WHERE reminder_id = ?', [reminderId])).rows[0].count, 2);
});

test('the Vercel retry handler reads the dynamic reminder ID from request.query', async () => {
  const appointment = (await query('SELECT id, clinic_id FROM appointments LIMIT 1')).rows[0];
  const reminderId = randomUUID();
  await query(
    'INSERT INTO reminders (id, clinic_id, appointment_id, type, channel, due_at, status, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [reminderId, appointment.clinic_id, appointment.id, 'confirm', 'sms', '2026-07-01T00:00:00.000Z', 'failed', 'vercel-retry-' + reminderId]
  );
  await query(
    'INSERT INTO reminder_delivery_attempts (reminder_id, claim_token, started_at, outcome) VALUES (?, ?, ?, ?)',
    [reminderId, 'old-claim', '2026-07-01T00:00:00.000Z', 'uncertain']
  );

  const result = { status: null, body: null };
  const response = {
    setHeader() {},
    status(status) { result.status = status; return this; },
    json(body) { result.body = body; return this; }
  };
  await retryHandler({
    query: { id: reminderId },
    params: undefined,
    headers: { 'x-staff-passcode': 'staff-test' },
    socket: { remoteAddress: '127.0.0.1' }
  }, response);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.reminder, { id: reminderId, status: 'sent' });
});

test('DRY_RUN never calls a delivery provider', async () => {
  const result = await notify({
    channel: 'sms',
    to: '+639171234567',
    subject: 'Ignored for SMS',
    message: 'Dry-run reminder'
  });
  assert.deepEqual(result, { providerMessageId: 'dry-run', dryRun: true });
});

test('a booking four hours away receives confirmation only, not overdue timed reminders', async () => {
  const now = new Date();
  const createdAt = now.toISOString();
  const startsAt = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(now.getTime() + 4.5 * 60 * 60 * 1000).toISOString();
  const source = (await query(
    'SELECT clinic_id, vet_id, service_id, owner_id, pet_id FROM appointments LIMIT 1'
  )).rows[0];
  const appointmentId = randomUUID();
  await query(
    'INSERT INTO appointments (id, clinic_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, confirmation_token, reschedule_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [appointmentId, source.clinic_id, source.vet_id, source.service_id, source.owner_id, source.pet_id, startsAt, endsAt, randomUUID(), randomUUID(), createdAt]
  );

  await processReminderCron({
    now: new Date(now.getTime() + 1_000),
    sendNotification: async () => ({ providerMessageId: 'short-notice' })
  });

  const reminders = (await query(
    'SELECT type, sent_at FROM reminders WHERE appointment_id = ? ORDER BY type',
    [appointmentId]
  )).rows;
  assert.deepEqual(reminders.map((item) => item.type), ['appointment_2h', 'confirm']);
  assert.equal(reminders.find((item) => item.type === 'appointment_2h').sent_at, null);
  assert.ok(reminders.find((item) => item.type === 'confirm').sent_at);
});

test('vaccine reminders are due at 9 AM in the clinic timezone', async () => {
  const pet = (await query('SELECT id FROM pets LIMIT 1')).rows[0];
  const vaccinationId = randomUUID();
  const now = new Date();
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const dueOn = dateParts.year + '-' + dateParts.month + '-' + dateParts.day;
  await query(
    'INSERT INTO vaccinations (id, pet_id, name, administered_on, due_on) VALUES (?, ?, ?, ?, ?)',
    [vaccinationId, pet.id, 'Local-time vaccine', '2025-08-02', dueOn]
  );
  await processReminderCron({
    now,
    sendNotification: async () => ({ providerMessageId: 'local-time-test' })
  });
  const reminder = (await query('SELECT due_at FROM reminders WHERE dedupe_key = ?', [vaccinationId + ':vaccine_due'])).rows[0];
  assert.equal(reminder.due_at, localDateTimeToIso(dueOn, '09:00', 'Asia/Manila'));
});

test('cron does not enqueue or send reminders owned by another clinic', async () => {
  const clinicId = randomUUID();
  const ownerId = randomUUID();
  const petId = randomUUID();
  const vaccinationId = randomUUID();
  const foreignReminderId = randomUUID();
  const now = new Date();
  await query(
    'INSERT INTO clinics (id, slug, name, locale, timezone, currency) VALUES (?, ?, ?, ?, ?, ?)',
    [clinicId, 'other-' + clinicId, 'Other Clinic', 'en-AU', 'Australia/Sydney', 'AUD']
  );
  await query(
    'INSERT INTO owners (id, clinic_id, name, mobile, preferred_channel) VALUES (?, ?, ?, ?, ?)',
    [ownerId, clinicId, 'Other Owner', '+61400000000', 'sms']
  );
  await query(
    'INSERT INTO pets (id, clinic_id, owner_id, name, species) VALUES (?, ?, ?, ?, ?)',
    [petId, clinicId, ownerId, 'Other Pet', 'dog']
  );
  await query(
    'INSERT INTO vaccinations (id, pet_id, name, administered_on, due_on) VALUES (?, ?, ?, ?, ?)',
    [vaccinationId, petId, 'C5', '2025-01-01', '2025-02-01']
  );
  await query(
    'INSERT INTO reminders (id, clinic_id, pet_id, type, channel, due_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [foreignReminderId, clinicId, petId, 'vaccine_due', 'sms', new Date(now.getTime() - 60_000).toISOString(), 'foreign-' + foreignReminderId]
  );

  const result = await processReminderCron({
    now,
    sendNotification: async () => ({ providerMessageId: 'active-clinic-only' })
  });

  assert.equal(result.delivered.includes(foreignReminderId), false);
  assert.equal((await query('SELECT sent_at FROM reminders WHERE id = ?', [foreignReminderId])).rows[0].sent_at, null);
  assert.equal((await query('SELECT COUNT(*) AS count FROM reminders WHERE pet_id = ? AND dedupe_key = ?', [petId, vaccinationId + ':vaccine_due'])).rows[0].count, 0);
});

test('owner GET links show a confirmation page without changing the appointment', async () => {
  const appointment = (await query(
    "SELECT id, reschedule_token, status FROM appointments WHERE status = 'pending' LIMIT 1"
  )).rows[0];
  const preview = await request('/api/owner/reschedule?token=' + encodeURIComponent(appointment.reschedule_token));
  const previewBody = await preview.text();
  assert.equal(preview.status, 200, previewBody);
  assert.match(preview.headers.get('content-type') || '', /text\/html/);
  assert.match(previewBody, /method="post"/i);
  assert.equal((await query('SELECT status FROM appointments WHERE id = ?', [appointment.id])).rows[0].status, 'pending');

  const applied = await request('/api/owner/reschedule', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: appointment.reschedule_token })
  });
  const appliedBody = await applied.text();
  assert.equal(applied.status, 200, appliedBody);
  assert.equal((await query('SELECT status FROM appointments WHERE id = ?', [appointment.id])).rows[0].status, 'rescheduled');
});

test('tokenized confirmation and reschedule actions update the appointment safely', async () => {
  const appointment = (await query(
    "SELECT id, confirmation_token, reschedule_token FROM appointments WHERE status = 'pending' LIMIT 1"
  )).rows[0];
  const flagged = await listUnconfirmedAppointments();
  assert.ok(flagged.some((item) => item.id === appointment.id));

  const confirmed = await applyOwnerAction('confirm', appointment.confirmation_token);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal((await applyOwnerAction('confirm', appointment.confirmation_token)).status, 'confirmed');
  assert.equal((await listUnconfirmedAppointments()).some((item) => item.id === appointment.id), false);

  const rescheduled = await applyOwnerAction('reschedule', appointment.reschedule_token);
  assert.equal(rescheduled.status, 'rescheduled');
});

test('late pending appointments are flagged as no-shows and receive a reminder', async () => {
  await query(
    'UPDATE appointments SET status = ?, starts_at = ?, ends_at = ?',
    ['pending', '2026-07-01T01:00:00.000Z', '2026-07-01T01:30:00.000Z']
  );
  const sent = [];
  await processReminderCron({
    now: new Date('2026-07-03T12:00:00.000Z'),
    sendNotification: async (payload) => {
      sent.push(payload);
      return { providerMessageId: 'no-show' };
    }
  });
  const status = (await query('SELECT status FROM appointments LIMIT 1')).rows[0].status;
  assert.equal(status, 'no_show');
  assert.ok(sent.some((payload) => payload.subject.includes('Missed') || payload.subject.includes('Missed visit') || payload.subject.includes('visit')));
});

test('cron endpoint requires its dedicated secret and owner links bypass demo access', async () => {
  const denied = await request('/api/cron/reminders', { method: 'POST' });
  assert.equal(denied.status, 401);

  const allowed = await request('/api/cron/reminders', {
    method: 'POST',
    headers: { 'x-cron-secret': 'cron-test' }
  });
  assert.equal(allowed.status, 200);

  const appointment = (await query('SELECT confirmation_token FROM appointments LIMIT 1')).rows[0];
  const action = await request('/api/owner/confirm?token=' + encodeURIComponent(appointment.confirmation_token));
  assert.notEqual(action.status, 401);
});
