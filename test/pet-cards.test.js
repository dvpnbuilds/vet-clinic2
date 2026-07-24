import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';
import { PetCardError, createPetCardToken, getPetCard } from '../db/pet-cards.js';
import vercelCard from '../api/pets/card/[token].js';
import vercelToken from '../api/pets/[id]/card-token.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-pet-cards-test.db';
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
  process.env.NODE_ENV = 'test';
  process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
  process.env.DEMO_PASSCODE = 'pet-card-demo';
  process.env.STAFF_PASSCODE = 'pet-card-staff';
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile }
  });
  const appointment = (await query('SELECT id FROM appointments WHERE pet_id = ? LIMIT 1', ['pet-bantay'])).rows[0];
  await query('UPDATE appointments SET status = ?, starts_at = ?, ends_at = ? WHERE id = ?', ['completed', '2026-07-01T02:00:00.000Z', '2026-07-01T02:30:00.000Z', appointment.id]);
  ({ default: app } = await import('../server.js'));
});

after(() => getDb().close());

test('a valid pet token exposes only its clinic-scoped profile, vaccine history, next due, and past visits', async () => {
  const token = (await query('SELECT token FROM pet_card_tokens LIMIT 1')).rows[0].token;
  const card = await getPetCard(token, { now: new Date('2026-07-24T00:00:00.000Z') });
  assert.deepEqual(card.pet, {
    name: 'Bantay', species: 'dog', breed: 'Aspin'
  });
  assert.equal(Object.hasOwn(card.pet, 'id'), false);
  assert.equal(Object.hasOwn(card.pet, 'notes'), false);
  assert.equal(Object.hasOwn(card, 'expiresAt'), false);
  assert.deepEqual(card.vaccinations, [{ name: '5-in-1', administered_on: '2025-07-25', due_on: '2026-07-25' }]);
  assert.deepEqual(card.nextDue, { name: '5-in-1', administered_on: '2025-07-25', due_on: '2026-07-25' });
  assert.equal(card.visits.length, 1);
  assert.deepEqual(Object.keys(card.visits[0]).sort(), ['service_name', 'starts_at']);
  const response = await request('/api/pets/card/' + token);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).card.pet.name, 'Bantay');
});

test('the card excludes non-visits and derives the next due date from each vaccine’s latest record', async () => {
  const source = (await query('SELECT clinic_id, vet_id, service_id, owner_id, pet_id FROM appointments WHERE pet_id = ? LIMIT 1', ['pet-bantay'])).rows[0];
  for (const status of ['cancelled', 'no_show', 'rescheduled']) {
    await query(
      'INSERT INTO appointments (id, clinic_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, status, confirmation_token, reschedule_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), source.clinic_id, source.vet_id, source.service_id, source.owner_id, source.pet_id, '2026-07-02T02:00:00.000Z', '2026-07-02T02:30:00.000Z', status, randomUUID(), randomUUID()]
    );
  }
  await query('INSERT INTO vaccinations (id, pet_id, name, administered_on, due_on) VALUES (?, ?, ?, ?, ?)', [randomUUID(), source.pet_id, '5-in-1', '2024-07-01', '2025-07-01']);
  await query('INSERT INTO vaccinations (id, pet_id, name, administered_on, due_on) VALUES (?, ?, ?, ?, ?)', [randomUUID(), source.pet_id, '5-in-1', '2026-07-20', '2027-07-20']);
  await query('INSERT INTO vaccinations (id, pet_id, name, administered_on, due_on) VALUES (?, ?, ?, ?, ?)', [randomUUID(), source.pet_id, 'Anti-rabies', '2026-07-10', '2026-08-10']);
  const token = (await query('SELECT token FROM pet_card_tokens LIMIT 1')).rows[0].token;
  const card = await getPetCard(token, { now: new Date('2026-07-24T00:00:00.000Z') });
  assert.equal(card.visits.length, 1);
  assert.deepEqual(card.nextDue, { name: 'Anti-rabies', administered_on: '2026-07-10', due_on: '2026-08-10' });
});

test('staff can regenerate a card token and the previous token immediately stops working', async () => {
  const oldToken = (await query('SELECT token FROM pet_card_tokens LIMIT 1')).rows[0].token;
  const response = await request('/api/pets/pet-bantay/card-token', {
    method: 'POST', headers: { 'x-staff-passcode': 'pet-card-staff' }
  });
  assert.equal(response.status, 201);
  const issued = (await response.json()).card;
  assert.notEqual(issued.token, oldToken);
  assert.match(issued.url, /pet-card\.html\?token=/);
  await assert.rejects(() => getPetCard(oldToken), PetCardError);
  assert.equal((await getPetCard(issued.token)).pet.name, 'Bantay');
});

test('invalid and expired card tokens are rejected without revealing pet data', async () => {
  const invalid = await request('/api/pets/card/not-a-token');
  assert.equal(invalid.status, 404);
  assert.equal((await invalid.json()).error, 'Hindi na available ang pet card na ito.');
  const issued = await createPetCardToken('pet-bantay', { now: new Date('2025-01-01T00:00:00.000Z') });
  await assert.rejects(() => getPetCard(issued.token, { now: new Date('2027-01-02T00:00:00.000Z') }), PetCardError);
  assert.equal((await request('/api/pets/card/' + issued.token)).status, 404);
});

test('Vercel exposes card read and staff token issuance handlers', () => {
  assert.equal(typeof vercelCard, 'function');
  assert.equal(typeof vercelToken, 'function');
});

test('Western pet-card copy remains profile-owned English', async () => {
  process.env.ACTIVE_CLINIC_PROFILE = 'western';
  const profile = (await (await request('/api/profile')).json()).clinic;
  assert.equal(profile.language, 'english');
  assert.equal(/\b(kami|alaga|piliin|mag-book|hindi)\b/i.test(JSON.stringify(profile.petCard)), false);
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
});
