import { randomUUID } from 'node:crypto';
import { getDb, query } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';
import { localDateTimeToIso } from './scheduling.js';
import { notify } from '../notify/index.js';

const APPOINTMENT_STATUSES = ['pending', 'confirmed'];
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
let deliveryAttemptSchemaReady = false;

export class ReminderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function rows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

function iso(date) {
  return new Date(date).toISOString();
}

function clinicDate(profile, date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function interpolate(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => values[key] || '');
}

function baseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function ownerActionUrl(action, token) {
  return baseUrl() + '/api/owner/' + action + '?token=' + encodeURIComponent(token);
}

function appointmentTime(profile, startsAt) {
  return new Intl.DateTimeFormat(profile.locale, {
    timeZone: profile.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(startsAt));
}

function reminderChannel(item) {
  if (item.preferred_channel === 'email' && item.email) return 'email';
  if (item.mobile) return 'sms';
  if (item.email) return 'email';
  return null;
}

async function ensureDeliveryAttemptSchema() {
  if (deliveryAttemptSchemaReady) return;
  await query([
    'CREATE TABLE IF NOT EXISTS reminder_delivery_attempts (',
    'reminder_id TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE CASCADE,',
    'claim_token TEXT NOT NULL,',
    'started_at TEXT NOT NULL,',
    "outcome TEXT NOT NULL DEFAULT 'delivering' CHECK (outcome IN ('delivering', 'sent', 'uncertain')),",
    'provider_message_id TEXT,',
    'last_error TEXT',
    ')'
  ].join(' '));
  await query('CREATE INDEX IF NOT EXISTS idx_reminder_delivery_attempts_outcome ON reminder_delivery_attempts (outcome, started_at)');
  await query('CREATE TABLE IF NOT EXISTS reminder_delivery_attempt_history (id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE, claim_token TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, outcome TEXT NOT NULL CHECK (outcome IN (\'delivering\', \'sent\', \'uncertain\')), provider_message_id TEXT, last_error TEXT)');
  await query('CREATE INDEX IF NOT EXISTS idx_reminder_delivery_attempt_history_reminder ON reminder_delivery_attempt_history (reminder_id, started_at)');
  deliveryAttemptSchemaReady = true;
}

async function insertReminder({ clinicId, appointmentId = null, petId = null, type, channel, dueAt, dedupeKey }) {
  await query(
    'INSERT OR IGNORE INTO reminders (id, clinic_id, appointment_id, pet_id, type, channel, due_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), clinicId, appointmentId, petId, type, channel, dueAt, dedupeKey]
  );
}

async function flagNoShows(profile, nowIso) {
  await query(
    'UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE clinic_id = ? AND status = ? AND ends_at < ?',
    ['no_show', profile.id, 'pending', nowIso]
  );
}

async function enqueueAppointmentReminders(profile, nowIso) {
  const appointments = rows(await query(
    'SELECT a.id, a.starts_at, a.created_at, a.status, o.mobile, o.email, o.preferred_channel FROM appointments a JOIN owners o ON o.id = a.owner_id WHERE a.clinic_id = ? AND a.status IN (?, ?)',
    [profile.id, ...APPOINTMENT_STATUSES]
  ));
  const nowTimestamp = new Date(nowIso).getTime();
  for (const appointment of appointments) {
    const channel = reminderChannel(appointment);
    if (!channel) continue;
    const startsAt = new Date(appointment.starts_at).getTime();
    await insertReminder({
      clinicId: profile.id,
      appointmentId: appointment.id,
      type: 'confirm',
      channel,
      dueAt: appointment.created_at,
      dedupeKey: appointment.id + ':confirm'
    });
    if (startsAt - nowTimestamp >= 24 * 60 * 60 * 1000) {
      await insertReminder({
        clinicId: profile.id,
        appointmentId: appointment.id,
        type: 'appointment_24h',
        channel,
        dueAt: iso(startsAt - 24 * 60 * 60 * 1000),
        dedupeKey: appointment.id + ':appointment_24h'
      });
    }
    if (startsAt - nowTimestamp >= 2 * 60 * 60 * 1000) {
      await insertReminder({
        clinicId: profile.id,
        appointmentId: appointment.id,
        type: 'appointment_2h',
        channel,
        dueAt: iso(startsAt - 2 * 60 * 60 * 1000),
        dedupeKey: appointment.id + ':appointment_2h'
      });
    }
  }

  const noShows = rows(await query(
    'SELECT a.id, a.ends_at, o.mobile, o.email, o.preferred_channel FROM appointments a JOIN owners o ON o.id = a.owner_id WHERE a.clinic_id = ? AND a.status = ?',
    [profile.id, 'no_show']
  ));
  for (const appointment of noShows) {
    const channel = reminderChannel(appointment);
    if (!channel) continue;
    await insertReminder({
      clinicId: profile.id,
      appointmentId: appointment.id,
      type: 'no_show',
      channel,
      dueAt: appointment.ends_at,
      dedupeKey: appointment.id + ':no_show'
    });
  }
}

async function enqueueVaccineReminders(profile, nowIso) {
  const dueDate = clinicDate(profile, new Date(nowIso));
  const vaccinations = rows(await query(
    'SELECT v.id, v.pet_id, v.due_on, o.mobile, o.email, o.preferred_channel FROM vaccinations v JOIN pets p ON p.id = v.pet_id JOIN owners o ON o.id = p.owner_id WHERE p.clinic_id = ? AND v.due_on <= ?',
    [profile.id, dueDate]
  ));
  for (const vaccination of vaccinations) {
    const channel = reminderChannel(vaccination);
    if (!channel) continue;
    await insertReminder({
      clinicId: profile.id,
      petId: vaccination.pet_id,
      type: 'vaccine_due',
      channel,
      dueAt: localDateTimeToIso(vaccination.due_on, '09:00', profile.timezone),
      dedupeKey: vaccination.id + ':vaccine_due'
    });
  }
}

async function claimReminder(reminderId, clinicId, nowIso, staleBeforeIso) {
  const claimToken = randomUUID();
  const result = await query(
    'UPDATE reminders SET status = ?, claim_token = ?, claimed_at = ?, last_error = NULL WHERE id = ? AND clinic_id = ? AND sent_at IS NULL AND NOT EXISTS (SELECT 1 FROM reminder_delivery_attempts WHERE reminder_id = reminders.id) AND (status = ? OR (status = ? AND claimed_at < ?))',
    ['processing', claimToken, nowIso, reminderId, clinicId, 'pending', 'processing', staleBeforeIso]
  );
  return result.rowsAffected > 0 ? claimToken : null;
}

async function beginDelivery(reminderId, claimToken, nowIso) {
  const result = await query(
    'INSERT OR IGNORE INTO reminder_delivery_attempts (reminder_id, claim_token, started_at) VALUES (?, ?, ?)',
    [reminderId, claimToken, nowIso]
  );
  if (result.rowsAffected === 0) return false;
  await query(
    'INSERT INTO reminder_delivery_attempt_history (id, reminder_id, claim_token, started_at, outcome) VALUES (?, ?, ?, ?, ?)',
    [randomUUID(), reminderId, claimToken, nowIso, 'delivering']
  );
  return true;
}

async function reminderContext(reminderId, clinicId) {
  const reminder = rows(await query(
    'SELECT r.id, r.type, r.channel, r.appointment_id, r.pet_id, a.starts_at, a.confirmation_token, a.reschedule_token, s.name AS service_name, p.name AS pet_name, o.name AS owner_name, o.mobile, o.email FROM reminders r LEFT JOIN appointments a ON a.id = r.appointment_id LEFT JOIN services s ON s.id = a.service_id LEFT JOIN pets p ON p.id = COALESCE(r.pet_id, a.pet_id) LEFT JOIN owners o ON o.id = p.owner_id WHERE r.id = ? AND r.clinic_id = ?',
    [reminderId, clinicId]
  ))[0];
  if (!reminder) throw new Error('Reminder not found.');
  if (reminder.type === 'vaccine_due') {
    const vaccination = rows(await query(
      'SELECT v.name FROM vaccinations v JOIN pets p ON p.id = v.pet_id WHERE v.pet_id = ? AND p.clinic_id = ? AND v.due_on <= ? ORDER BY v.due_on LIMIT 1',
      [reminder.pet_id, clinicId, clinicDate(getActiveClinicProfile(), new Date())]
    ))[0];
    reminder.vaccine_name = vaccination?.name || '';
  }
  return reminder;
}

function buildMessage(profile, reminder) {
  const template = profile.reminders[reminder.type];
  if (!template) throw new Error('Missing profile reminder template: ' + reminder.type);
  const values = {
    clinic: profile.name,
    owner: reminder.owner_name,
    pet: reminder.pet_name,
    service: reminder.service_name,
    vaccine: reminder.vaccine_name,
    appointmentTime: reminder.starts_at ? appointmentTime(profile, reminder.starts_at) : '',
    confirmUrl: reminder.confirmation_token ? ownerActionUrl('confirm', reminder.confirmation_token) : '',
    rescheduleUrl: reminder.reschedule_token ? ownerActionUrl('reschedule', reminder.reschedule_token) : '',
    bookingUrl: baseUrl()
  };
  return {
    to: reminder.channel === 'sms' ? reminder.mobile : reminder.email,
    channel: reminder.channel,
    subject: interpolate(template.subject, values),
    message: interpolate(template.message, values)
  };
}

async function markSent(reminderId, claimToken, result, nowIso) {
  const updated = await query(
    'UPDATE reminders SET status = ?, sent_at = ?, provider_message_id = ?, claim_token = NULL WHERE id = ? AND claim_token = ? AND EXISTS (SELECT 1 FROM reminder_delivery_attempts WHERE reminder_id = reminders.id AND claim_token = ?)',
    ['sent', nowIso, result.providerMessageId || null, reminderId, claimToken, claimToken]
  );
  if (updated.rowsAffected === 0) throw new Error('Reminder delivery could not be recorded.');
  await query(
    'UPDATE reminder_delivery_attempts SET outcome = ?, provider_message_id = ?, last_error = NULL WHERE reminder_id = ? AND claim_token = ?',
    ['sent', result.providerMessageId || null, reminderId, claimToken]
  );
  await query(
    'UPDATE reminder_delivery_attempt_history SET outcome = ?, completed_at = ?, provider_message_id = ?, last_error = NULL WHERE reminder_id = ? AND claim_token = ?',
    ['sent', nowIso, result.providerMessageId || null, reminderId, claimToken]
  );
}

async function markDeliveryUncertain(reminderId, claimToken, error) {
  const message = String(error.message || error).slice(0, 500);
  try {
    await query(
      'UPDATE reminder_delivery_attempts SET outcome = ?, last_error = ? WHERE reminder_id = ? AND claim_token = ?',
      ['uncertain', message, reminderId, claimToken]
    );
    await query(
      'UPDATE reminder_delivery_attempt_history SET outcome = ?, completed_at = ?, last_error = ? WHERE reminder_id = ? AND claim_token = ?',
      ['uncertain', new Date().toISOString(), message, reminderId, claimToken]
    );
  } finally {
    await query(
      'UPDATE reminders SET status = ?, last_error = ? WHERE id = ? AND claim_token = ? AND sent_at IS NULL',
      ['failed', message, reminderId, claimToken]
    );
    console.error('[REMINDER_RECONCILIATION_REQUIRED]', { reminderId, error: message });
  }
}

async function releasePreDeliveryClaim(reminderId, claimToken, error) {
  await query(
    'UPDATE reminders SET status = ?, claim_token = NULL, last_error = ? WHERE id = ? AND claim_token = ?',
    ['pending', String(error.message || error).slice(0, 500), reminderId, claimToken]
  );
}

export async function processReminderCron({ now = new Date(), sendNotification = notify, markReminderSent = markSent } = {}) {
  const profile = getActiveClinicProfile();
  const nowIso = iso(now);
  await ensureDeliveryAttemptSchema();
  await flagNoShows(profile, nowIso);
  await enqueueAppointmentReminders(profile, nowIso);
  await enqueueVaccineReminders(profile, nowIso);

  const due = rows(await query(
    'SELECT r.id FROM reminders r WHERE r.clinic_id = ? AND r.due_at <= ? AND r.sent_at IS NULL AND NOT EXISTS (SELECT 1 FROM reminder_delivery_attempts d WHERE d.reminder_id = r.id) AND (r.status = ? OR (r.status = ? AND r.claimed_at < ?)) ORDER BY r.due_at',
    [profile.id, nowIso, 'pending', 'processing', iso(now.getTime() - CLAIM_TIMEOUT_MS)]
  ));
  const delivered = [];
  const failed = [];
  for (const item of due) {
    const claimToken = await claimReminder(item.id, profile.id, nowIso, iso(now.getTime() - CLAIM_TIMEOUT_MS));
    if (!claimToken) continue;
    try {
      const payload = buildMessage(profile, await reminderContext(item.id, profile.id));
      if (!await beginDelivery(item.id, claimToken, nowIso)) continue;
      let result;
      try {
        result = await sendNotification(payload);
      } catch (error) {
        await markDeliveryUncertain(item.id, claimToken, error);
        failed.push({ id: item.id, error: error.message });
        continue;
      }
      try {
        await markReminderSent(item.id, claimToken, result, nowIso);
        delivered.push(item.id);
      } catch (error) {
        await markDeliveryUncertain(item.id, claimToken, error);
        failed.push({ id: item.id, error: error.message });
      }
    } catch (error) {
      await releasePreDeliveryClaim(item.id, claimToken, error);
      failed.push({ id: item.id, error: error.message });
    }
  }
  return { delivered, failed };
}

export async function listUnconfirmedAppointments() {
  const profile = getActiveClinicProfile();
  return rows(await query(
    'SELECT a.id, a.starts_at, a.ends_at, p.name AS pet_name, o.name AS owner_name, s.name AS service_name FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id JOIN services s ON s.id = a.service_id WHERE a.clinic_id = ? AND a.status = ? AND a.starts_at > ? ORDER BY a.starts_at',
    [profile.id, 'pending', new Date().toISOString()]
  ));
}

export async function listReminderReconciliation() {
  const profile = getActiveClinicProfile();
  return rows(await query(
    'SELECT r.id, r.type, r.channel, r.due_at, r.last_error, p.name AS pet_name, o.name AS owner_name FROM reminders r LEFT JOIN appointments a ON a.id = r.appointment_id LEFT JOIN pets p ON p.id = COALESCE(r.pet_id, a.pet_id) LEFT JOIN owners o ON o.id = p.owner_id WHERE r.clinic_id = ? AND r.status = ? AND r.sent_at IS NULL ORDER BY r.due_at',
    [profile.id, 'failed']
  ));
}

export async function retryReminder(reminderId, { now = new Date(), sendNotification = notify } = {}) {
  const profile = getActiveClinicProfile();
  if (typeof reminderId !== 'string' || !reminderId) throw new ReminderError('Reminder is unavailable.', 404);
  await ensureDeliveryAttemptSchema();
  const nowIso = iso(now);
  const claimToken = randomUUID();
  const claimed = await query(
    'UPDATE reminders SET status = ?, claim_token = ?, claimed_at = ?, last_error = NULL WHERE id = ? AND clinic_id = ? AND status = ? AND sent_at IS NULL',
    ['processing', claimToken, nowIso, reminderId, profile.id, 'failed']
  );
  if (claimed.rowsAffected === 0) throw new ReminderError('Reminder is not awaiting reconciliation.', 409);
  await query(
    'UPDATE reminder_delivery_attempts SET claim_token = ?, started_at = ?, outcome = ?, provider_message_id = NULL, last_error = NULL WHERE reminder_id = ?',
    [claimToken, nowIso, 'delivering', reminderId]
  );
  await query(
    'INSERT INTO reminder_delivery_attempt_history (id, reminder_id, claim_token, started_at, outcome) VALUES (?, ?, ?, ?, ?)',
    [randomUUID(), reminderId, claimToken, nowIso, 'delivering']
  );
  try {
    const result = await sendNotification(buildMessage(profile, await reminderContext(reminderId, profile.id)));
    await markSent(reminderId, claimToken, result, nowIso);
    return { id: reminderId, status: 'sent' };
  } catch (error) {
    await markDeliveryUncertain(reminderId, claimToken, error);
    throw new ReminderError('Reminder retry failed and remains in reconciliation.', 502);
  }
}

function validateOwnerAction(action, token) {
  if (!['confirm', 'reschedule'].includes(action) || typeof token !== 'string' || !token) {
    throw new ReminderError('This link is unavailable.', 404);
  }
}

export async function previewOwnerAction(action, token) {
  validateOwnerAction(action, token);
  const profile = getActiveClinicProfile();
  const tokenColumn = action === 'confirm' ? 'confirmation_token' : 'reschedule_token';
  const appointment = rows(await query(
    'SELECT status FROM appointments WHERE ' + tokenColumn + ' = ? AND clinic_id = ?',
    [token, profile.id]
  ))[0];
  if (!appointment) throw new ReminderError(profile.reminders.ownerActions.unavailable, 404);
  return { action, status: appointment.status };
}

export async function applyOwnerAction(action, token) {
  validateOwnerAction(action, token);
  const profile = getActiveClinicProfile();
  const tokenColumn = action === 'confirm' ? 'confirmation_token' : 'reschedule_token';
  const transaction = await getDb().transaction('write');
  try {
    const appointment = rows(await transaction.execute({
      sql: 'SELECT id, slot_id, status FROM appointments WHERE ' + tokenColumn + ' = ? AND clinic_id = ?',
      args: [token, profile.id]
    }))[0];
    if (!appointment) throw new ReminderError(profile.reminders.ownerActions.unavailable, 404);
    if (action === 'confirm') {
      if (appointment.status === 'confirmed') {
        await transaction.commit();
        return { message: profile.reminders.ownerActions.alreadyConfirmed, status: 'confirmed' };
      }
      if (appointment.status !== 'pending') throw new ReminderError(profile.reminders.ownerActions.unavailable, 409);
      await transaction.execute({
        sql: 'UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: ['confirmed', appointment.id]
      });
      await transaction.commit();
      return { message: profile.reminders.ownerActions.confirmed, status: 'confirmed' };
    }

    if (!['pending', 'confirmed'].includes(appointment.status)) {
      throw new ReminderError(profile.reminders.ownerActions.unavailable, 409);
    }
    await transaction.execute({
      sql: 'UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: ['rescheduled', appointment.id]
    });
    await transaction.execute({
      sql: 'DELETE FROM slot_reservations WHERE appointment_id = ?',
      args: [appointment.id]
    });
    await transaction.execute({
      sql: 'UPDATE slots SET status = ? WHERE id = ?',
      args: ['available', appointment.slot_id]
    });
    await transaction.commit();
    return { message: profile.reminders.ownerActions.rescheduled, status: 'rescheduled' };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}
