import { getActiveClinicProfile } from './profiles/index.js';
import { query } from './client.js';
import { listUnconfirmedAppointments } from './reminders.js';
import { listCalendar } from './scheduling.js';

function rows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

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

export async function getDashboard() {
  const profile = getActiveClinicProfile();
  const date = clinicToday(profile);
  const [calendar, pending, vaccines, recovered] = await Promise.all([
    listCalendar({ date, view: 'day' }),
    listUnconfirmedAppointments(),
    query(
      'SELECT p.name AS pet_name, o.name AS owner_name, v.name AS vaccine_name, v.due_on FROM vaccinations v JOIN pets p ON p.id = v.pet_id JOIN owners o ON o.id = p.owner_id WHERE p.clinic_id = ? AND v.due_on <= ? ORDER BY v.due_on, p.name',
      [profile.id, date]
    ),
    query(
      'SELECT COUNT(*) AS appointment_count, COALESCE(SUM(s.price_centavos), 0) AS recovered_centavos FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.clinic_id = ? AND a.status = ? AND EXISTS (SELECT 1 FROM reminders r WHERE r.appointment_id = a.id AND r.sent_at IS NOT NULL AND r.type IN (?, ?, ?))',
      [profile.id, 'confirmed', 'confirm', 'appointment_24h', 'appointment_2h']
    )
  ]);
  const recoveredRow = rows(recovered)[0];
  return {
    date,
    calendar: calendar.appointments,
    pending,
    vaccines: rows(vaccines),
    recovered: {
      centavos: Number(recoveredRow.recovered_centavos),
      appointments: Number(recoveredRow.appointment_count)
    }
  };
}
