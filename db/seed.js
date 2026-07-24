import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDb } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

async function clearDemoData(db) {
  await db.executeMultiple([
    'DELETE FROM demo_rate_limits',
    'DELETE FROM reminder_delivery_attempts',
    'DELETE FROM reminders',
    'DELETE FROM vaccinations',
    'DELETE FROM slot_reservations',
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

  const { vet, owner, pet, vaccination } = profile.seed;
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
    sql: 'INSERT INTO vaccinations (id, pet_id, name, administered_on, due_on) VALUES (?, ?, ?, ?, ?)',
    args: [randomUUID(), pet.id, vaccination.name, vaccination.administeredOn, vaccination.dueOn]
  });
  await db.execute({
    sql: 'INSERT INTO appointments (id, clinic_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, confirmation_token, reschedule_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [randomUUID(), profile.id, vet.id, service.id, owner.id, pet.id, appointmentStart.toISOString(), appointmentEnd.toISOString(), randomUUID(), randomUUID()]
  });

  console.log('Seeded ' + profile.name + ' (' + profile.slug + ') to Turso.');
}

seed().catch((error) => {
  console.error('Seed failed: ' + error.message);
  process.exitCode = 1;
});
