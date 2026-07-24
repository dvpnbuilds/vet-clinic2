import { randomUUID } from 'node:crypto';
import { getDb } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';

const SPECIES = new Set(['dog', 'cat', 'other']);

export class WalkInError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function rows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string') throw new WalkInError(label + ' must be text.');
  const text = value.trim();
  if (!text) throw new WalkInError(label + ' is required.');
  if (text.length > maxLength) throw new WalkInError(label + ' must be ' + maxLength + ' characters or fewer.');
  return text;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, label, maxLength);
}

function validateWalkIn(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new WalkInError('Walk-in details are required.');
  }
  const ownerName = requiredText(input.ownerName, 'Owner name', 120);
  const mobile = requiredText(input.mobile, 'Mobile number', 30);
  if (!/^[+()\d\s-]{7,30}$/.test(mobile)) {
    throw new WalkInError('Mobile number is invalid.');
  }
  const petName = requiredText(input.petName, 'Pet name', 100);
  if (!SPECIES.has(input.species)) throw new WalkInError('Pet type is invalid.');
  return {
    ownerName,
    mobile,
    petName,
    species: input.species,
    breed: optionalText(input.breed, 'Breed', 100),
    reason: requiredText(input.reason, 'Reason for visit', 500)
  };
}

async function transactionRows(transaction, sql, args) {
  return rows(await transaction.execute({ sql, args }));
}

export async function createWalkIn(input, { now = new Date() } = {}) {
  const details = validateWalkIn(input);
  const profile = getActiveClinicProfile();
  const arrivedAt = new Date(now);
  if (Number.isNaN(arrivedAt.getTime())) throw new WalkInError('Arrival time is invalid.');

  const transaction = await getDb().transaction('write');
  try {
    const vet = (await transactionRows(
      transaction,
      'SELECT id FROM vets WHERE clinic_id = ? AND active = 1 ORDER BY id LIMIT 1',
      [profile.id]
    ))[0];
    const service = (await transactionRows(
      transaction,
      'SELECT id, duration_minutes FROM services WHERE clinic_id = ? AND active = 1 ORDER BY id LIMIT 1',
      [profile.id]
    ))[0];
    if (!vet || !service) throw new WalkInError('Walk-in intake is temporarily unavailable.', 503);

    const ownerId = randomUUID();
    const petId = randomUUID();
    const appointmentId = randomUUID();
    const walkInId = randomUUID();
    const startsAt = arrivedAt.toISOString();
    const endsAt = new Date(arrivedAt.getTime() + Number(service.duration_minutes) * 60_000).toISOString();
    const conflict = (await transactionRows(transaction, 'SELECT id FROM appointments WHERE clinic_id = ? AND vet_id = ? AND status IN (?, ?) AND starts_at < ? AND ends_at > ? LIMIT 1', [profile.id, vet.id, 'pending', 'confirmed', endsAt, startsAt]))[0];
    if (conflict) throw new WalkInError('The walk-in slot is unavailable. Please ask the clinic team for the next opening.', 409);
    await transaction.execute({
      sql: 'INSERT INTO owners (id, clinic_id, name, mobile, preferred_channel) VALUES (?, ?, ?, ?, ?)',
      args: [ownerId, profile.id, details.ownerName, details.mobile, 'sms']
    });
    await transaction.execute({
      sql: 'INSERT INTO pets (id, clinic_id, owner_id, name, species, breed) VALUES (?, ?, ?, ?, ?, ?)',
      args: [petId, profile.id, ownerId, details.petName, details.species, details.breed]
    });
    await transaction.execute({
      sql: 'INSERT INTO appointments (id, clinic_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, status, confirmation_token, reschedule_token, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [appointmentId, profile.id, vet.id, service.id, ownerId, petId, startsAt, endsAt, 'confirmed', randomUUID(), randomUUID(), details.reason]
    });
    await transaction.execute({ sql: 'INSERT INTO slot_reservations (id, appointment_id, vet_id, starts_at, capacity_index) VALUES (?, ?, ?, ?, ?)', args: [randomUUID(), appointmentId, vet.id, startsAt, 0] });
    await transaction.execute({
      sql: 'INSERT INTO walk_ins (id, clinic_id, appointment_id, reason, arrived_at) VALUES (?, ?, ?, ?, ?)',
      args: [walkInId, profile.id, appointmentId, details.reason, startsAt]
    });
    await transaction.commit();
    return { id: walkInId, appointmentId, arrivedAt: startsAt };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    if (error instanceof WalkInError) throw error;
    console.error('Walk-in creation failed:', error);
    throw new WalkInError('Walk-in intake is temporarily unavailable.', 503);
  } finally {
    transaction.close();
  }
}
