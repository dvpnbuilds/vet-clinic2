import { randomUUID } from 'node:crypto';
import { getDb, query } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';

export class PetCardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function rows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

function validToken(token) {
  return typeof token === 'string' && /^[0-9a-f-]{36}$/i.test(token);
}

function baseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function cardExpiry(profile, now) {
  const days = Number(profile.petCard?.tokenDays);
  if (!Number.isInteger(days) || days < 1 || days > 3660) {
    throw new PetCardError('Pet card access is temporarily unavailable.', 503);
  }
  return new Date(new Date(now).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function clinicDate(profile, date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function nextVaccination(vaccinations, today) {
  const latestByName = new Map();
  for (const vaccination of vaccinations) {
    if (!latestByName.has(vaccination.name)) latestByName.set(vaccination.name, vaccination);
  }
  const current = [...latestByName.values()];
  const upcoming = current.filter((vaccination) => vaccination.due_on >= today);
  return (upcoming.length ? upcoming : current).sort((left, right) => left.due_on.localeCompare(right.due_on))[0] || null;
}

export async function createPetCardToken(petId, { now = new Date() } = {}) {
  if (typeof petId !== 'string' || !petId) throw new PetCardError('Pet is unavailable.', 404);
  const profile = getActiveClinicProfile();
  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new PetCardError('Token time is invalid.');
  const transaction = await getDb().transaction('write');
  try {
    const pet = rows(await transaction.execute({
      sql: 'SELECT id FROM pets WHERE id = ? AND clinic_id = ?', args: [petId, profile.id]
    }))[0];
    if (!pet) throw new PetCardError('Pet is unavailable.', 404);
    const token = randomUUID();
    const expiresAt = cardExpiry(profile, nowDate);
    await transaction.execute({
      sql: 'INSERT INTO pet_card_tokens (id, clinic_id, pet_id, token, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(pet_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP',
      args: [randomUUID(), profile.id, petId, token, expiresAt]
    });
    await transaction.commit();
    return { token, expiresAt, url: baseUrl() + '/pet-card.html?token=' + encodeURIComponent(token) };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

export async function getPetCard(token, { now = new Date() } = {}) {
  if (!validToken(token)) throw new PetCardError('This pet card is unavailable.', 404);
  const profile = getActiveClinicProfile();
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) throw new PetCardError('Pet card access is unavailable.', 404);
  const nowIso = current.toISOString();
  const pet = rows(await query(
    'SELECT p.id, p.name, p.species, p.breed FROM pet_card_tokens t JOIN pets p ON p.id = t.pet_id WHERE t.token = ? AND t.clinic_id = ? AND p.clinic_id = ? AND t.expires_at > ?',
    [token, profile.id, profile.id, nowIso]
  ))[0];
  if (!pet) throw new PetCardError('This pet card is unavailable.', 404);
  const [vaccinations, visits] = await Promise.all([
    query(
      'SELECT name, administered_on, due_on FROM vaccinations WHERE pet_id = ? ORDER BY administered_on DESC, due_on DESC',
      [pet.id]
    ),
    query(
      'SELECT a.starts_at, s.name AS service_name FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.pet_id = ? AND a.clinic_id = ? AND a.status = ? AND a.starts_at <= ? ORDER BY a.starts_at DESC',
      [pet.id, profile.id, 'completed', nowIso]
    )
  ]);
  const vaccineHistory = rows(vaccinations);
  const nextDue = nextVaccination(vaccineHistory, clinicDate(profile, current));
  return {
    pet: {
      name: pet.name,
      species: pet.species,
      breed: pet.breed
    },
    nextDue,
    vaccinations: vaccineHistory,
    visits: rows(visits)
  };
}
