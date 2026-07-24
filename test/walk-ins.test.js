import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';
import { getDashboard } from '../db/dashboard.js';
import { qrMatrix, qrSvg } from '../public/qr-code.js';
import { createPublicWriteRateLimitMiddleware } from '../routes/demo-access.js';
import vercelWalkIns from '../api/walk-ins.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-walk-ins-test.db';
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
  process.env.DEMO_PASSCODE = 'walk-in-demo';
  process.env.STAFF_PASSCODE = 'walk-in-staff';
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile }
  });
  ({ default: app } = await import('../server.js'));
});

after(() => getDb().close());

test('walk-in QR and intake form are available without a demo passcode', async () => {
  const form = await request('/w');
  assert.equal(form.status, 200);
  assert.match(await form.text(), /walk-in\.js/);
  const print = await request('/qr.html');
  assert.equal(print.status, 200);
  assert.match(await print.text(), /qr\.js/);
});

test('walk-in public pages render the active clinic name and Vercel exposes the same handler', async () => {
  const [form, print] = await Promise.all([
    readFile(new URL('../public/w', import.meta.url), 'utf8'),
    readFile(new URL('../public/qr.html', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(form + print, /VetFlow|Walk-in check-in|Walk-in QR/);
  assert.match(await readFile(new URL('../public/walk-in.js', import.meta.url), 'utf8'), /clinic-wordmark/);
  assert.match(await readFile(new URL('../public/qr.js', import.meta.url), 'utf8'), /clinic-wordmark/);
  assert.equal(typeof vercelWalkIns, 'function');
});

test('public intake rate limiting fails closed before a write', async () => {
  const response = {
    statusCode: 200,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  };
  let proceeded = false;
  const limit = createPublicWriteRateLimitMiddleware({
    now: () => 1_000,
    consumeAttempt: async () => ({ count: 21, resetAt: 61_000 })
  });
  await limit({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, response, () => { proceeded = true; });
  assert.equal(proceeded, false);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['RateLimit-Remaining'], '0');
});

test('submitting an intake creates clinic-scoped owner, pet, appointment, and dashboard queue entry', async () => {
  const response = await request('/api/walk-ins', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ownerName: 'Liza Santos',
      mobile: '+63 917 123 4567',
      petName: 'Mochi',
      species: 'dog',
      breed: 'Aspin',
      reason: 'Biglang nanghina at ayaw kumain'
    })
  });
  assert.equal(response.status, 201);
  const { walkIn } = await response.json();
  const persisted = (await query(
    'SELECT w.clinic_id, w.reason, o.name AS owner_name, o.mobile, p.name AS pet_name, a.status FROM walk_ins w JOIN appointments a ON a.id = w.appointment_id JOIN owners o ON o.id = a.owner_id JOIN pets p ON p.id = a.pet_id WHERE w.id = ?',
    [walkIn.id]
  )).rows[0];
  assert.deepEqual({
    clinicId: persisted.clinic_id,
    reason: persisted.reason,
    ownerName: persisted.owner_name,
    mobile: persisted.mobile,
    petName: persisted.pet_name,
    status: persisted.status
  }, {
    clinicId: 'clinic-pawsitive',
    reason: 'Biglang nanghina at ayaw kumain',
    ownerName: 'Liza Santos',
    mobile: '+63 917 123 4567',
    petName: 'Mochi',
    status: 'confirmed'
  });
  const dashboard = await getDashboard();
  assert.ok(dashboard.walkIns.some((item) => item.id === walkIn.id && item.mobile === '+63 917 123 4567'));
  const staffDashboard = await request('/api/dashboard', { headers: { 'x-staff-passcode': 'walk-in-staff' } });
  assert.equal(staffDashboard.status, 200);
  assert.ok((await staffDashboard.json()).walkIns.some((item) => item.id === walkIn.id));
});

test('walk-in endpoint rejects malformed public submissions without writing records', async () => {
  const beforeCount = Number((await query('SELECT COUNT(*) AS count FROM walk_ins')).rows[0].count);
  const response = await request('/api/walk-ins', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ownerName: 'Liza', mobile: 'bad', petName: 'Mochi', species: 'lizard', reason: '' })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Mobile number is invalid.');
  const afterCount = Number((await query('SELECT COUNT(*) AS count FROM walk_ins')).rows[0].count);
  assert.equal(afterCount, beforeCount);
});

test('local printable QR encoder emits a version-four matrix for the intake URL', () => {
  const matrix = qrMatrix('https://vetflow.example/w');
  assert.equal(matrix.length, 33);
  assert.ok(matrix.every((row) => row.length === 33 && row.every((cell) => typeof cell === 'boolean')));
  assert.match(qrSvg('https://vetflow.example/w'), /<svg/);
  assert.throws(() => qrMatrix('https://example.test/' + 'x'.repeat(100)), RangeError);
});
