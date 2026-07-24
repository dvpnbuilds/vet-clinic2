import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDb } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';
import { localDateTimeToIso } from './scheduling.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

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

function appointmentTime(profile, date, time, durationMinutes) {
  const startsAt = localDateTimeToIso(date, time, profile.timezone);
  return { startsAt, endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60 * 1000).toISOString() };
}

async function insertAppointment(db, { profile, vet, service, owner, pet, date, time, status }) {
  const { startsAt, endsAt } = appointmentTime(profile, date, time, service.durationMinutes);
  const id = randomUUID();
  await db.execute({
    sql: 'INSERT INTO appointments (id, clinic_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, status, confirmation_token, reschedule_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [id, profile.id, vet.id, service.id, owner.id, pet.id, startsAt, endsAt, status, randomUUID(), randomUUID()]
  });
  return { id, startsAt };
}

async function insertSentReminder(db, { profile, appointmentId = null, petId = null, type, sentAt, dedupeKey = 'seed-analytics-' + randomUUID() }) {
  await db.execute({
    sql: 'INSERT INTO reminders (id, clinic_id, appointment_id, pet_id, type, channel, due_at, sent_at, status, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [randomUUID(), profile.id, appointmentId, petId, type, 'sms', sentAt, sentAt, 'sent', dedupeKey]
  });
}

async function clearDemoData(db) {
  await db.executeMultiple([
    'DELETE FROM demo_rate_limits',
    'DELETE FROM reminder_delivery_attempts',
    'DELETE FROM reminders',
    'DELETE FROM invoice_items',
    'DELETE FROM invoices',
    'DELETE FROM vaccinations',
    'DELETE FROM slot_reservations',
    'DELETE FROM reviews',
    'DELETE FROM walk_ins',
    'DELETE FROM pet_card_tokens',
    'DELETE FROM appointments',
    'DELETE FROM slots',
    'DELETE FROM block_offs',
    'DELETE FROM pets',
    'DELETE FROM owners',
    'DELETE FROM vet_hours',
    'DELETE FROM vets',
    'DELETE FROM services',
    'DELETE FROM clinics'
  ].join(';\n') + ';');
}

async function seed() {
  const db = getDb();
  const profile = getActiveClinicProfile();
  const schema = await readFile(schemaPath, 'utf8');

  await db.executeMultiple(schema);
  await clearDemoData(db);

  const { vet, owner, pet, vaccination, analyticsOwner, analyticsPets } = profile.seed;
  const service = profile.services[0];
  const appointmentStart = new Date(Date.now() + 4 * 60 * 60 * 1000);
  appointmentStart.setMinutes(0, 0, 0);
  const appointmentEnd = new Date(appointmentStart.getTime() + service.durationMinutes * 60 * 1000);

  await db.execute({
    sql: 'INSERT INTO clinics (id, slug, name, locale, timezone, currency, phone, email, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [profile.id, profile.slug, profile.name, profile.locale, profile.timezone, profile.currency, profile.phone, profile.email, profile.address]
  });

  for (const item of profile.services) {
    await db.execute({
      sql: 'INSERT INTO services (id, clinic_id, name, description, duration_minutes, price_centavos) VALUES (?, ?, ?, ?, ?, ?)',
      args: [item.id, profile.id, item.name, item.description, item.durationMinutes, item.priceCentavos]
    });
  }

  await db.execute({
    sql: 'INSERT INTO vets (id, clinic_id, name, title) VALUES (?, ?, ?, ?)',
    args: [vet.id, profile.id, vet.name, vet.title]
  });

  for (const hours of profile.hours) {
    await db.execute({
      sql: 'INSERT INTO vet_hours (id, vet_id, weekday, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?, ?, ?)',
      args: [randomUUID(), vet.id, hours.weekday, hours.startsAt, hours.endsAt, hours.capacity]
    });
  }

  await db.execute({
    sql: 'INSERT INTO owners (id, clinic_id, name, mobile, email, preferred_channel) VALUES (?, ?, ?, ?, ?, ?)',
    args: [owner.id, profile.id, owner.name, owner.mobile, owner.email, owner.preferredChannel]
  });
  await db.execute({
    sql: 'INSERT INTO pets (id, clinic_id, owner_id, name, species, breed) VALUES (?, ?, ?, ?, ?, ?)',
    args: [pet.id, profile.id, owner.id, pet.name, pet.species, pet.breed]
  });
  await db.execute({
    sql: 'INSERT INTO pet_card_tokens (id, clinic_id, pet_id, token, expires_at) VALUES (?, ?, ?, ?, ?)',
    args: [randomUUID(), profile.id, pet.id, randomUUID(), new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()]
  });
  await db.execute({
    sql: 'INSERT INTO vaccinations (id, pet_id, name, administered_on, due_on) VALUES (?, ?, ?, ?, ?)',
    args: [randomUUID(), pet.id, vaccination.name, vaccination.administeredOn, vaccination.dueOn]
  });
  await db.execute({
    sql: 'INSERT INTO appointments (id, clinic_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, confirmation_token, reschedule_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [randomUUID(), profile.id, vet.id, service.id, owner.id, pet.id, appointmentStart.toISOString(), appointmentEnd.toISOString(), randomUUID(), randomUUID()]
  });

  await db.execute({
    sql: 'INSERT INTO owners (id, clinic_id, name, mobile, email, preferred_channel) VALUES (?, ?, ?, ?, ?, ?)',
    args: [analyticsOwner.id, profile.id, analyticsOwner.name, analyticsOwner.mobile, analyticsOwner.email, analyticsOwner.preferredChannel]
  });
  for (const analyticsPet of analyticsPets) {
    await db.execute({
      sql: 'INSERT INTO pets (id, clinic_id, owner_id, name, species, breed) VALUES (?, ?, ?, ?, ?, ?)',
      args: [analyticsPet.id, profile.id, analyticsOwner.id, analyticsPet.name, analyticsPet.species, analyticsPet.breed]
    });
  }

  const today = clinicDate(profile);
  const noShow = await insertAppointment(db, { profile, vet, service: profile.services[1], owner: analyticsOwner, pet: analyticsPets[0], date: shiftDate(today, -6), time: '10:00', status: 'no_show' });
  const completedVaccination = await insertAppointment(db, { profile, vet, service: profile.services[1], owner: analyticsOwner, pet: analyticsPets[0], date: shiftDate(today, -5), time: '10:00', status: 'completed' });
  await insertAppointment(db, { profile, vet, service: profile.services[3], owner: analyticsOwner, pet: analyticsPets[0], date: shiftDate(today, -4), time: '15:00', status: 'completed' });
  const secondNoShow = await insertAppointment(db, { profile, vet, service: profile.services[1], owner: analyticsOwner, pet: analyticsPets[0], date: shiftDate(today, -3), time: '10:00', status: 'no_show' });
  const confirmed = await insertAppointment(db, { profile, vet, service: profile.services[0], owner: analyticsOwner, pet: analyticsPets[0], date: shiftDate(today, -2), time: '12:00', status: 'completed' });
  const recoveredVisit = await insertAppointment(db, { profile, vet, service: profile.services[2], owner: analyticsOwner, pet: analyticsPets[0], date: shiftDate(today, -1), time: '14:00', status: 'completed' });

  await insertSentReminder(db, { profile, appointmentId: noShow.id, type: 'confirm', sentAt: new Date(new Date(noShow.startsAt).getTime() - 60 * 60 * 1000).toISOString() });
  await insertSentReminder(db, { profile, appointmentId: completedVaccination.id, type: 'confirm', sentAt: new Date(new Date(completedVaccination.startsAt).getTime() - 60 * 60 * 1000).toISOString() });
  await insertSentReminder(db, { profile, appointmentId: confirmed.id, type: 'confirm', sentAt: new Date(new Date(confirmed.startsAt).getTime() - 60 * 60 * 1000).toISOString() });
  await insertSentReminder(db, { profile, petId: analyticsPets[0].id, type: 'vaccine_due', sentAt: new Date(new Date(recoveredVisit.startsAt).getTime() - 24 * 60 * 60 * 1000).toISOString() });
  await insertSentReminder(db, { profile, petId: analyticsPets[1].id, type: 'vaccine_due', sentAt: appointmentTime(profile, shiftDate(today, -3), '09:00', 0).startsAt });
  await insertSentReminder(db, { profile, appointmentId: noShow.id, type: 'no_show', sentAt: noShow.startsAt, dedupeKey: noShow.id + ':no_show' });
  await insertSentReminder(db, { profile, appointmentId: secondNoShow.id, type: 'no_show', sentAt: secondNoShow.startsAt, dedupeKey: secondNoShow.id + ':no_show' });

  console.log('Seeded ' + profile.name + ' (' + profile.slug + ') to Turso.');
}

seed().catch((error) => {
  console.error('Seed failed: ' + error.message);
  process.exitCode = 1;
});
