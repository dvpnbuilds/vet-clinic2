import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb } from '../db/client.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-funnel-test.db';
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
  process.env.DEMO_PASSCODE = 'funnel-test';
  process.env.STAFF_PASSCODE = 'staff-test';
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile }
  });
  ({ default: app } = await import('../server.js'));
});

after(async () => {
  getDb().close();
});

test('public funnel books a live slot and staff calendar receives the appointment', async () => {
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /booking\.js/);

  const headers = { 'x-demo-passcode': 'funnel-test' };
  const slotsResponse = await request('/api/slots?date=2026-07-30&serviceId=service-consult', { headers });
  assert.equal(slotsResponse.status, 200);
  const slots = (await slotsResponse.json()).slots;
  assert.ok(slots.length > 0);

  const bookingResponse = await request('/api/bookings', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      slotId: slots[0].id,
      owner: { name: 'Liza Santos', mobile: '+639171234567' },
      pet: { name: 'Mochi', species: 'dog', breed: 'Aspin' }
    })
  });
  assert.equal(bookingResponse.status, 201);
  const appointment = (await bookingResponse.json()).appointment;

  const publicCalendarResponse = await request('/api/calendar?date=2026-07-30&view=day', { headers });
  assert.equal(publicCalendarResponse.status, 401);

  const calendarResponse = await request('/api/calendar?date=2026-07-30&view=day', {
    headers: { 'x-staff-passcode': 'staff-test' }
  });
  assert.equal(calendarResponse.status, 200);
  const calendar = await calendarResponse.json();
  assert.ok(calendar.appointments.some((item) => item.id === appointment.id));
});

test('a public demo code cannot read or mutate staff-only routes', async () => {
  const headers = { 'x-demo-passcode': 'funnel-test' };
  for (const path of ['/api/dashboard', '/api/appointments/unconfirmed']) {
    assert.equal((await request(path, { headers })).status, 401);
  }
  assert.equal((await request('/api/block-offs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({})
  })).status, 401);
});

test('public clinic profile never exposes seed fixtures', async () => {
  const response = await request('/api/profile');
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn((await response.json()).clinic, 'seed'), false);
});

test('malformed public and staff scheduling requests return safe validation errors', async () => {
  const publicResponse = await request('/api/bookings', {
    method: 'POST',
    headers: { 'x-demo-passcode': 'funnel-test', 'content-type': 'application/json' },
    body: JSON.stringify({
      slotId: 'not-a-real-slot',
      owner: { name: 42, mobile: '+639171234567' },
      pet: { name: 'Mochi', species: 'dog' }
    })
  });
  assert.equal(publicResponse.status, 400);
  assert.equal((await publicResponse.json()).error, 'Owner name must be text.');

  const staffResponse = await request('/api/block-offs', {
    method: 'POST',
    headers: { 'x-staff-passcode': 'staff-test', 'content-type': 'application/json' },
    body: 'null'
  });
  assert.equal(staffResponse.status, 400);
  assert.equal((await staffResponse.json()).error, 'Invalid JSON request body.');
});
