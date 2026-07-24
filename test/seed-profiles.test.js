import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-western-seed-test.db';
process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
process.env.ACTIVE_CLINIC_PROFILE = 'western';

before(async () => {
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile, ACTIVE_CLINIC_PROFILE: 'western' }
  });
});

after(() => {
  getDb().close();
});

test('Western seeding uses its own clinic, staff, owner, pet, and vaccine profile data', async () => {
  const clinic = (await query('SELECT name, currency FROM clinics LIMIT 1')).rows[0];
  const appointment = (await query(
    'SELECT v.name AS vet_name, o.name AS owner_name, p.name AS pet_name, p.breed, vaccination.name AS vaccine_name FROM appointments a JOIN vets v ON v.id = a.vet_id JOIN owners o ON o.id = a.owner_id JOIN pets p ON p.id = a.pet_id JOIN vaccinations vaccination ON vaccination.pet_id = p.id LIMIT 1'
  )).rows[0];

  assert.deepEqual(clinic, { name: 'Harbour Veterinary', currency: 'AUD' });
  assert.deepEqual(appointment, {
    vet_name: 'Dr. Charlotte Reid',
    owner_name: 'Amelia Harris',
    pet_name: 'Scout',
    breed: 'Australian Kelpie',
    vaccine_name: 'C5'
  });
});
