import { getActiveClinicProfile } from './profiles/index.js';
import { query } from './client.js';
import { listUnconfirmedAppointments } from './reminders.js';
import { listCalendar, localDateTimeToIso } from './scheduling.js';

function rows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

function clinicToday(profile, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clinicHour(profile, date) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: profile.timezone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).find((part) => part.type === 'hour').value);
}

function rate(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function top(items, label) {
  return items.sort((left, right) => right.appointments - left.appointments || String(left[label]).localeCompare(String(right[label])))[0] || null;
}

async function getAnalytics(profile, date, nowIso) {
  const trendStart = shiftDate(date, -6);
  const busiestStart = shiftDate(date, -29);
  const trendStartIso = localDateTimeToIso(trendStart, '00:00', profile.timezone);
  const busiestStartIso = localDateTimeToIso(busiestStart, '00:00', profile.timezone);
  const [trendAppointments, busiestAppointments, conversion, vaccineCampaign] = await Promise.all([
    query(
      'SELECT starts_at, status FROM appointments WHERE clinic_id = ? AND starts_at >= ? AND starts_at < ? AND status IN (?, ?)',
      [profile.id, trendStartIso, nowIso, 'completed', 'no_show']
    ),
    query(
      'SELECT a.starts_at, s.name AS service_name FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.clinic_id = ? AND a.starts_at >= ? AND a.starts_at < ? AND a.status NOT IN (?, ?)',
      [profile.id, busiestStartIso, nowIso, 'cancelled', 'rescheduled']
    ),
    query(
      'SELECT COUNT(*) AS sent, COALESCE(SUM(CASE WHEN a.status IN (?, ?) THEN 1 ELSE 0 END), 0) AS confirmed FROM reminders r JOIN appointments a ON a.id = r.appointment_id AND a.clinic_id = r.clinic_id WHERE r.clinic_id = ? AND r.type = ? AND r.sent_at IS NOT NULL',
      ['confirmed', 'completed', profile.id, 'confirm']
    ),
    query(
      'SELECT COUNT(*) AS sent, COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.clinic_id = r.clinic_id AND a.pet_id = r.pet_id AND a.starts_at >= r.sent_at AND a.status IN (?, ?)) THEN 1 ELSE 0 END), 0) AS recovered FROM reminders r WHERE r.clinic_id = ? AND r.type = ? AND r.sent_at IS NOT NULL',
      ['confirmed', 'completed', profile.id, 'vaccine_due']
    )
  ]);

  const days = Array.from({ length: 7 }, (_, index) => ({
    date: shiftDate(trendStart, index),
    noShows: 0,
    closedVisits: 0
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const appointment of rows(trendAppointments)) {
    const day = byDate.get(clinicToday(profile, new Date(appointment.starts_at)));
    if (!day) continue;
    day.closedVisits += 1;
    if (appointment.status === 'no_show') day.noShows += 1;
  }
  for (const day of days) day.rate = rate(day.noShows, day.closedVisits);

  const byHour = new Map();
  const byService = new Map();
  for (const appointment of rows(busiestAppointments)) {
    const hour = clinicHour(profile, new Date(appointment.starts_at));
    byHour.set(hour, (byHour.get(hour) || 0) + 1);
    byService.set(appointment.service_name, (byService.get(appointment.service_name) || 0) + 1);
  }
  const slot = top([...byHour].map(([hour, appointments]) => ({ hour, appointments })), 'hour');
  const service = top([...byService].map(([name, appointments]) => ({ name, appointments })), 'name');
  const conversionRow = rows(conversion)[0];
  const vaccineRow = rows(vaccineCampaign)[0];
  const sent = Number(conversionRow.sent);
  const confirmed = Number(conversionRow.confirmed);
  const campaignSent = Number(vaccineRow.sent);
  const recovered = Number(vaccineRow.recovered);

  return {
    noShows: {
      days,
      noShows: days.reduce((total, day) => total + day.noShows, 0),
      closedVisits: days.reduce((total, day) => total + day.closedVisits, 0),
      rate: rate(days.reduce((total, day) => total + day.noShows, 0), days.reduce((total, day) => total + day.closedVisits, 0))
    },
    busiest: { slot, service },
    reminderConversion: { sent, confirmed, rate: rate(confirmed, sent) },
    vaccineCampaign: { sent: campaignSent, recovered, rate: rate(recovered, campaignSent) }
  };
}

export async function getDashboard({ now = new Date() } = {}) {
  const profile = getActiveClinicProfile();
  const date = clinicToday(profile, now);
  const tomorrow = new Date(date + 'T00:00:00.000Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dayStart = localDateTimeToIso(date, '00:00', profile.timezone);
  const dayEnd = localDateTimeToIso(tomorrow.toISOString().slice(0, 10), '00:00', profile.timezone);
  const [calendar, pending, vaccines, recovered, walkIns, privateFeedback, analytics, invoices, invoiceRows] = await Promise.all([
    listCalendar({ date, view: 'day' }),
    listUnconfirmedAppointments(),
    query(
      'SELECT p.name AS pet_name, o.name AS owner_name, v.name AS vaccine_name, v.due_on FROM vaccinations v JOIN pets p ON p.id = v.pet_id JOIN owners o ON o.id = p.owner_id WHERE p.clinic_id = ? AND v.due_on <= ? ORDER BY v.due_on, p.name',
      [profile.id, date]
    ),
    query(
      'SELECT COUNT(*) AS appointment_count, COALESCE(SUM(s.price_centavos), 0) AS recovered_centavos FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.clinic_id = ? AND a.status = ? AND EXISTS (SELECT 1 FROM reminders r WHERE r.appointment_id = a.id AND r.sent_at IS NOT NULL AND r.type IN (?, ?, ?))',
      [profile.id, 'confirmed', 'confirm', 'appointment_24h', 'appointment_2h']
    ),
    query(
      'SELECT w.id, w.reason, w.arrived_at, a.id AS appointment_id, p.name AS pet_name, o.name AS owner_name, o.mobile FROM walk_ins w JOIN appointments a ON a.id = w.appointment_id JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id WHERE w.clinic_id = ? AND w.arrived_at >= ? AND w.arrived_at < ? ORDER BY w.arrived_at DESC',
      [profile.id, dayStart, dayEnd]
    ),
    query(
      'SELECT r.id, r.rating, r.feedback, r.feedback_at, p.name AS pet_name, o.name AS owner_name FROM reviews r JOIN appointments a ON a.id = r.appointment_id JOIN pets p ON p.id = a.pet_id JOIN owners o ON o.id = a.owner_id WHERE r.clinic_id = ? AND r.feedback IS NOT NULL ORDER BY r.feedback_at DESC',
      [profile.id]
    ),
    getAnalytics(profile, date, new Date(now).toISOString()),
    query('SELECT COALESCE(SUM(CASE WHEN status = ? THEN total_centavos ELSE 0 END), 0) AS revenue_centavos, COALESCE(SUM(CASE WHEN status = ? THEN total_centavos ELSE 0 END), 0) AS outstanding_centavos FROM invoices WHERE clinic_id = ?', ['paid', 'unpaid', profile.id])
    ,query('SELECT appointment_id, id, receipt_token, status, total_centavos FROM invoices WHERE clinic_id = ?', [profile.id])
  ]);
  const recoveredRow = rows(recovered)[0];
  return {
    date,
    calendar: calendar.appointments.map((appointment) => ({ ...appointment, invoice: rows(invoiceRows).find((invoice) => invoice.appointment_id === appointment.id) || null })),
    pending,
    vaccines: rows(vaccines),
    walkIns: rows(walkIns),
    privateFeedback: rows(privateFeedback),
    recovered: {
      centavos: Number(recoveredRow.recovered_centavos),
      appointments: Number(recoveredRow.appointment_count)
    },
    analytics,
    invoices: { revenueCentavos: Number(rows(invoices)[0].revenue_centavos), outstandingCentavos: Number(rows(invoices)[0].outstanding_centavos) }
  };
}
