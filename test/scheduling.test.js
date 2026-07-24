import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';
import {
  SchedulingError,
  bookSlot,
  createBlockOff,
  listCalendar,
  listSlots,
  localDateTimeToIso
} from '../db/scheduling.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-scheduling-test.db';
process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
process.env.ACTIVE_CLINIC_PROFILE = 'ph';

function bookingInput(slotId, suffix) {
  return {
    slotId,
    idempotencyKey: 'booking-' + suffix,
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

test('scheduling rejects malformed values before starting a write transaction', async () => {
  const slot = (await listSlots({ date: '2026-07-31', serviceId: 'service-consult' }))[0];
  await assert.rejects(
    () => bookSlot({
      slotId: slot.id,
      owner: { name: 42, mobile: '+639171234567' },
      pet: { name: 'Mochi', species: 'dog' }
    }),
    (error) => error instanceof SchedulingError && error.status === 400 && error.message === 'Owner name must be text.'
  );
  await assert.rejects(
    () => listSlots({ date: '2026-07-31', serviceId: ['service-consult'] }),
    (error) => error instanceof SchedulingError && error.status === 400
  );
  await assert.rejects(
    () => createBlockOff(null),
    (error) => error instanceof SchedulingError && error.status === 400 && error.message === 'Block-off details are required.'
  );
});

test('past dates are hidden and a slot is rechecked before booking', async () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  await assert.rejects(
    () => listSlots({ date: '2026-07-30', serviceId: 'service-consult' }, { now }),
    (error) => error instanceof SchedulingError && error.status === 400 && error.message === 'Please choose a future date.'
  );

  const slots = await listSlots(
    { date: '2026-08-03', serviceId: 'service-consult' },
    { now }
  );
  assert.ok(slots.length > 0);
  await assert.rejects(
    () => bookSlot(bookingInput(slots[0].id, '0099'), { now: new Date('2026-08-04T00:00:00.000Z') }),
    (error) => error instanceof SchedulingError && error.status === 409 && error.message === 'That time has already passed.'
  );
});

test('Sydney DST gaps are skipped and overlaps resolve to one stable instant', () => {
  const timeZone = 'Australia/Sydney';
  assert.equal(localDateTimeToIso('2026-10-04', '02:00', timeZone), null);
  assert.equal(localDateTimeToIso('2026-10-04', '02:50', timeZone), null);
  assert.equal(localDateTimeToIso('2026-10-04', '03:00', timeZone), '2026-10-03T16:00:00.000Z');

  const repeatedHour = ['02:00', '02:10', '02:20', '02:30', '02:40', '02:50']
    .map((clock) => localDateTimeToIso('2026-04-05', clock, timeZone));
  assert.deepEqual(repeatedHour, [
    '2026-04-04T15:00:00.000Z',
    '2026-04-04T15:10:00.000Z',
    '2026-04-04T15:20:00.000Z',
    '2026-04-04T15:30:00.000Z',
    '2026-04-04T15:40:00.000Z',
    '2026-04-04T15:50:00.000Z'
  ]);
  assert.equal(new Set(repeatedHour).size, repeatedHour.length);
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

test('an Idempotency-Key replays the original capacity-two booking exactly once', async () => {
  await query('UPDATE vet_hours SET capacity = 2');
  const slot = (await listSlots({ date: '2026-08-06', serviceId: 'service-consult' }))[0];
  const input = bookingInput(slot.id, '0102');
  const first = await bookSlot(input);
  const replay = await bookSlot(input);

  assert.deepEqual(replay, first);
  assert.equal((await query('SELECT COUNT(*) AS count FROM appointments WHERE slot_id = ?', [slot.id])).rows[0].count, 1);
  assert.equal((await query('SELECT COUNT(*) AS count FROM booking_idempotency WHERE idempotency_key = ?', [input.idempotencyKey])).rows[0].count, 1);
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

test('a block-off and booking race resolve with exactly one winner', async () => {
  const slot = (await listSlots({ date: '2026-08-05', serviceId: 'service-consult' }))[0];
  const attempts = await Promise.allSettled([
    bookSlot(bookingInput(slot.id, '0101')),
    createBlockOff({ vetId: slot.vetId, startsAt: slot.startsAt, endsAt: slot.endsAt, reason: 'Urgent meeting' })
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  assert.ok(attempts.find((attempt) => attempt.status === 'rejected').reason instanceof SchedulingError);
});
