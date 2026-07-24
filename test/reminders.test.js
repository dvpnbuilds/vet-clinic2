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
  processReminderCron
} from '../db/reminders.js';
import { notify } from '../notify/index.js';

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

test('tokenized confirmation and reschedule actions update the appointment safely', async () => {
  const appointment = (await query(
    'SELECT id, confirmation_token, reschedule_token FROM appointments LIMIT 1'
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
