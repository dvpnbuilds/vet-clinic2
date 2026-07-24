import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test, { after, before } from 'node:test';
import { getDb, query } from '../db/client.js';
import { getDashboard } from '../db/dashboard.js';
import { completeAppointment, processReviewRequests, submitFeedback, submitRating } from '../db/reviews.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';
import vercelComplete from '../api/appointments/[id]/complete.js';
import vercelFeedback from '../api/reviews/[token]/feedback.js';
import vercelPreview from '../api/reviews/[token].js';
import vercelRating from '../api/reviews/[token]/rating.js';

const run = promisify(execFile);
const databaseFile = '.vetflow-reviews-test.db';
let app;

async function request(path, options = {}) {
  const server = await new Promise((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const response = await fetch('http://127.0.0.1:' + server.address().port + path, options);
  await new Promise((resolve) => server.close(resolve));
  return response;
}

async function additionalAppointment() {
  const source = (await query('SELECT clinic_id, vet_id, service_id, owner_id, pet_id FROM appointments LIMIT 1')).rows[0];
  const id = randomUUID();
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  await query(
    'INSERT INTO appointments (id, clinic_id, vet_id, service_id, owner_id, pet_id, starts_at, ends_at, status, confirmation_token, reschedule_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, source.clinic_id, source.vet_id, source.service_id, source.owner_id, source.pet_id, start, end, 'confirmed', randomUUID(), randomUUID()]
  );
  return id;
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.TURSO_DATABASE_URL = 'file:./' + databaseFile;
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
  process.env.DEMO_PASSCODE = 'review-demo';
  process.env.STAFF_PASSCODE = 'review-staff';
  await rm(databaseFile, { force: true });
  await run(process.execPath, ['db/seed.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TURSO_DATABASE_URL: 'file:./' + databaseFile }
  });
  ({ default: app } = await import('../server.js'));
});

after(() => getDb().close());

test('staff completion queues exactly one delayed review request and it is sent once', async () => {
  const appointment = (await query('SELECT id FROM appointments WHERE status = ? LIMIT 1', ['pending'])).rows[0];
  const completedAt = new Date('2026-08-01T01:00:00.000Z');
  const completed = await completeAppointment(appointment.id, { now: completedAt });
  assert.equal(completed.status, 'completed');
  assert.ok(completed.review);
  assert.equal(completed.review.due_at, '2026-08-01T03:00:00.000Z');
  const replay = await completeAppointment(appointment.id, { now: completedAt });
  assert.equal(replay.alreadyCompleted, true);
  assert.equal(Number((await query('SELECT COUNT(*) AS count FROM reviews WHERE appointment_id = ?', [appointment.id])).rows[0].count), 1);

  const sent = [];
  assert.deepEqual(await processReviewRequests({ now: new Date('2026-08-01T02:59:59.000Z'), sendNotification: async (message) => sent.push(message) }), { delivered: [], failed: [] });
  const delivered = await processReviewRequests({
    now: new Date('2026-08-01T03:00:00.000Z'),
    sendNotification: async (message) => { sent.push(message); return { providerMessageId: 'review-dry-run' }; }
  });
  assert.equal(delivered.delivered.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /review\.html\?token=/);
  assert.deepEqual(await processReviewRequests({ now: new Date('2026-08-01T04:00:00.000Z'), sendNotification: async (message) => sent.push(message) }), { delivered: [], failed: [] });
  assert.equal(sent.length, 1);
});

test('the rating gate routes high ratings to profile Google URL and saves low-rating feedback for staff', async () => {
  const high = (await query('SELECT token FROM reviews LIMIT 1')).rows[0];
  const highResult = await submitRating(high.token, 5);
  assert.equal(highResult.route, 'google');
  assert.match(highResult.url, /google\.com/);

  const appointmentId = await additionalAppointment();
  await completeAppointment(appointmentId, { now: new Date('2026-08-02T01:00:00.000Z') });
  const low = (await query('SELECT token FROM reviews WHERE appointment_id = ?', [appointmentId])).rows[0];
  await processReviewRequests({ now: new Date('2026-08-02T03:00:00.000Z'), sendNotification: async () => ({ providerMessageId: 'low-review' }) });
  assert.deepEqual(await submitRating(low.token, 2), { route: 'feedback' });
  assert.deepEqual(await submitFeedback(low.token, 'Matagal ang hintay bago kami natawag.'), { status: 'saved' });
  const dashboard = await getDashboard();
  assert.ok(dashboard.privateFeedback.some((item) => item.feedback === 'Matagal ang hintay bago kami natawag.' && Number(item.rating) === 2));
});

test('a pre-delivery review error returns the claim to due-and-unsent processing', async () => {
  const appointmentId = await additionalAppointment();
  await completeAppointment(appointmentId, { now: new Date('2026-08-03T01:00:00.000Z') });
  const review = (await query('SELECT id FROM reviews WHERE appointment_id = ?', [appointmentId])).rows[0];
  const profile = getActiveClinicProfile();
  const template = profile.reviews.request;
  profile.reviews.request = null;
  const failed = await processReviewRequests({ now: new Date('2026-08-03T03:00:00.000Z'), sendNotification: async () => ({ providerMessageId: 'should-not-send' }) });
  profile.reviews.request = template;
  assert.equal(failed.delivered.length, 0);
  assert.equal(failed.failed.length, 1);
  assert.equal((await query('SELECT status, delivery_started_at FROM reviews WHERE id = ?', [review.id])).rows[0].status, 'pending');
  const recovered = await processReviewRequests({ now: new Date('2026-08-03T03:01:00.000Z'), sendNotification: async () => ({ providerMessageId: 'recovered-review' }) });
  assert.deepEqual(recovered.delivered, [review.id]);
});

test('staff completion and tokenized review routes are exposed through Express', async () => {
  const appointmentId = await additionalAppointment();
  const completed = await request('/api/appointments/' + appointmentId + '/complete', {
    method: 'POST', headers: { 'x-staff-passcode': 'review-staff' }
  });
  assert.equal(completed.status, 200);
  const review = (await query('SELECT token FROM reviews WHERE appointment_id = ?', [appointmentId])).rows[0];
  await processReviewRequests({ now: new Date(Date.now() + 3 * 60 * 60 * 1000), sendNotification: async () => ({ providerMessageId: 'route-review' }) });
  const preview = await request('/api/reviews/' + review.token);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).review.feedbackSubmitted, false);
});

test('Vercel exposes handlers for completion and every review-gate action', () => {
  assert.equal(typeof vercelComplete, 'function');
  assert.equal(typeof vercelPreview, 'function');
  assert.equal(typeof vercelRating, 'function');
  assert.equal(typeof vercelFeedback, 'function');
});

test('Western review copy remains English-only', async () => {
  process.env.ACTIVE_CLINIC_PROFILE = 'western';
  const profile = (await (await request('/api/profile')).json()).clinic;
  assert.equal(profile.language, 'english');
  assert.equal(/\b(kami|alaga|piliin|mag-book|hindi)\b/i.test(JSON.stringify(profile.reviews)), false);
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
});
