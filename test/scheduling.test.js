import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb } from '../db/client.js';
import {
  SchedulingError,
  bookSlot,
  createBlockOff,
  listCalendar,
  listSlots
} from '../db/scheduling.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-scheduling-test.db';
process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
process.env.ACTIVE_CLINIC_PROFILE = 'ph';

function bookingInput(slotId, suffix) {
  return {
    slotId,
    owner: { name: 'Owner ' + suffix, mobile: '+63917000' + suffix.padStart(4, '0') },
    pet: { name: 'Pet ' + suffix, species: 'dog', breed: 'Aspin' }
  };
}

before(async () => {
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile }
  });
});

after(async () => {
  getDb().close();
});

test('generated slots respect clinic hours and service duration', async () => {
  const slots = await listSlots({ date: '2026-07-27', serviceId: 'service-consult' });
  assert.ok(slots.length > 0);
  assert.equal(slots[0].startsAt, '2026-07-27T01:00:00.000Z');
  assert.equal(slots[0].endsAt, '2026-07-27T01:30:00.000Z');
  assert.ok(slots.every((slot) => slot.startsAt >= '2026-07-27T01:00:00.000Z'));
  assert.ok(slots.every((slot) => slot.endsAt <= '2026-07-27T09:00:00.000Z'));
});

test('concurrent requests cannot double-book the same slot', async () => {
  const slots = await listSlots({ date: '2026-07-28', serviceId: 'service-consult' });
  const slot = slots[0];
  const attempts = await Promise.allSettled(
    ['0001', '0002', '0003', '0004'].map((suffix) => bookSlot(bookingInput(slot.id, suffix)))
  );
  const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
  const rejected = attempts.filter((attempt) => attempt.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((attempt) => attempt.reason instanceof SchedulingError && attempt.reason.status === 409));

  const remaining = await listSlots({ date: '2026-07-28', serviceId: 'service-consult' });
  assert.equal(remaining.some((candidate) => candidate.id === slot.id), false);
});

test('block-offs remove overlapping slots and calendar exposes bookings', async () => {
  const slots = await listSlots({ date: '2026-07-29', serviceId: 'service-5in1' });
  const blockedSlot = slots[2];
  await createBlockOff({
    vetId: blockedSlot.vetId,
    startsAt: blockedSlot.startsAt,
    endsAt: blockedSlot.endsAt,
    reason: 'Team meeting'
  });

  const remaining = await listSlots({ date: '2026-07-29', serviceId: 'service-5in1' });
  assert.equal(remaining.some((candidate) => candidate.id === blockedSlot.id), false);

  const appointmentCalendar = await listCalendar({ date: '2026-07-28', view: 'day' });
  const blockCalendar = await listCalendar({ date: '2026-07-29', view: 'day' });
  assert.ok(appointmentCalendar.appointments.length > 0);
  assert.ok(blockCalendar.blockOffs.some((item) => item.reason === 'Team meeting'));
});
