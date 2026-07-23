import { randomUUID } from 'node:crypto';
import { getDb, query } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';
import { notify } from '../notify/index.js';

const APPOINTMENT_STATUSES = ['pending', 'confirmed'];
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

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
    await insertReminder({
      clinicId: profile.id,
      appointmentId: appointment.id,
      type: 'appointment_24h',
      channel,
      dueAt: iso(startsAt - 24 * 60 * 60 * 1000),
      dedupeKey: appointment.id + ':appointment_24h'
    });
    await insertReminder({
      clinicId: profile.id,
      appointmentId: appointment.id,
      type: 'appointment_2h',
      channel,
      dueAt: iso(startsAt - 2 * 60 * 60 * 1000),
      dedupeKey: appointment.id + ':appointment_2h'
    });
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
  const dueDate = nowIso.slice(0, 10);
  const vaccinations = rows(await query(
    'SELECT v.id, v.pet_id, v.due_on, o.mobile, o.email, o.preferred_channel FROM vaccinations v JOIN pets p ON p.id = v.pet_id JOIN owners o ON o.id = p.owner_id WHERE v.due_on <= ?',
    [dueDate]
  ));
  for (const vaccination of vaccinations) {
    const channel = reminderChannel(vaccination);
    if (!channel) continue;
    await insertReminder({
      clinicId: profile.id,
      petId: vaccination.pet_id,
      type: 'vaccine_due',
      channel,
      dueAt: vaccination.due_on + 'T09:00:00.000Z',
      dedupeKey: vaccination.id + ':vaccine_due'
    });
  }
}

async function claimReminder(reminderId, nowIso, staleBeforeIso) {
  const claimToken = randomUUID();
  const result = await query(
    'UPDATE reminders SET status = ?, claim_token = ?, claimed_at = ?, last_error = NULL WHERE id = ? AND sent_at IS NULL AND (status = ? OR (status = ? AND claimed_at < ?))',
    ['processing', claimToken, nowIso, reminderId, 'pending', 'processing', staleBeforeIso]
  );
  return result.rowsAffected > 0 ? claimToken : null;
}

async function reminderContext(reminderId) {
  const reminder = rows(await query(
    'SELECT r.id, r.type, r.channel, r.appointment_id, r.pet_id, a.starts_at, a.confirmation_token, a.reschedule_token, s.name AS service_name, p.name AS pet_name, o.name AS owner_name, o.mobile, o.email FROM reminders r LEFT JOIN appointments a ON a.id = r.appointment_id LEFT JOIN services s ON s.id = a.service_id LEFT JOIN pets p ON p.id = COALESCE(r.pet_id, a.pet_id) LEFT JOIN owners o ON o.id = p.owner_id WHERE r.id = ?',
    [reminderId]
  ))[0];
  if (!reminder) throw new Error('Reminder not found.');
  if (reminder.type === 'vaccine_due') {
    const vaccination = rows(await query(
      'SELECT name FROM vaccinations WHERE pet_id = ? AND due_on <= date(CURRENT_TIMESTAMP) ORDER BY due_on LIMIT 1',
      [reminder.pet_id]
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
  await query(
    'UPDATE reminders SET status = ?, sent_at = ?, provider_message_id = ?, claim_token = NULL WHERE id = ? AND claim_token = ?',
    ['sent', nowIso, result.providerMessageId || null, reminderId, claimToken]
  );
}

async function releaseFailedClaim(reminderId, claimToken, error) {
  await query(
    'UPDATE reminders SET status = ?, claim_token = NULL, last_error = ? WHERE id = ? AND claim_token = ?',
    ['pending', String(error.message || error).slice(0, 500), reminderId, claimToken]
  );
}

export async function processReminderCron({ now = new Date(), sendNotification = notify } = {}) {
  const profile = getActiveClinicProfile();
  const nowIso = iso(now);
  await flagNoShows(profile, nowIso);
  await enqueueAppointmentReminders(profile, nowIso);
  await enqueueVaccineReminders(profile, nowIso);

  const due = rows(await query(
    'SELECT id FROM reminders WHERE due_at <= ? AND sent_at IS NULL AND (status = ? OR (status = ? AND claimed_at < ?)) ORDER BY due_at',
    [nowIso, 'pending', 'processing', iso(now.getTime() - CLAIM_TIMEOUT_MS)]
  ));
  const delivered = [];
  const failed = [];
  for (const item of due) {
    const claimToken = await claimReminder(item.id, nowIso, iso(now.getTime() - CLAIM_TIMEOUT_MS));
    if (!claimToken) continue;
    try {
      const payload = buildMessage(profile, await reminderContext(item.id));
      const result = await sendNotification(payload);
      await markSent(item.id, claimToken, result, nowIso);
      delivered.push(item.id);
    } catch (error) {
      await releaseFailedClaim(item.id, claimToken, error);
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

export async function applyOwnerAction(action, token) {
  if (!['confirm', 'reschedule'].includes(action) || !token) {
    throw new ReminderError('This link is unavailable.', 404);
  }
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
