import { randomUUID } from 'node:crypto';
import { getDb, query } from './client.js';
import { getActiveClinicProfile } from './profiles/index.js';
import { notify } from '../notify/index.js';
import { generateInvoice } from './invoices.js';

const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export class ReviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function rows(result) {
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

function iso(value) {
  return new Date(value).toISOString();
}

function baseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function reviewUrl(token) {
  return baseUrl() + '/review.html?token=' + encodeURIComponent(token);
}

function chooseChannel(owner) {
  if (owner.preferred_channel === 'email' && owner.email) return 'email';
  if (owner.mobile) return 'sms';
  if (owner.email) return 'email';
  return null;
}

function interpolate(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => values[key] || '');
}

function reviewDelay(profile) {
  const hours = Number(profile.reviews?.delayHours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
    throw new ReviewError('Review requests are temporarily unavailable.', 503);
  }
  return hours;
}

function tokenFrom(request) {
  const token = request.params?.token || request.query?.token;
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) {
    throw new ReviewError('This review link is unavailable.', 404);
  }
  return token;
}

function feedbackText(value) {
  if (typeof value !== 'string') throw new ReviewError('Feedback must be text.');
  const text = value.trim();
  if (!text) throw new ReviewError('Feedback is required.');
  if (text.length > 1_000) throw new ReviewError('Feedback must be 1000 characters or fewer.');
  return text;
}

function ratingValue(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ReviewError('Rating must be between 1 and 5.');
  }
  return rating;
}

async function transactionRows(transaction, statement, args) {
  return rows(await transaction.execute({ sql: statement, args }));
}

export async function completeAppointment(appointmentId, { now = new Date() } = {}) {
  if (typeof appointmentId !== 'string' || !appointmentId) throw new ReviewError('Appointment is unavailable.', 404);
  const profile = getActiveClinicProfile();
  const completedAt = new Date(now);
  if (Number.isNaN(completedAt.getTime())) throw new ReviewError('Completion time is invalid.');
  const transaction = await getDb().transaction('write');
  try {
    const appointment = (await transactionRows(transaction,
      'SELECT a.id, a.status, o.mobile, o.email, o.preferred_channel FROM appointments a JOIN owners o ON o.id = a.owner_id WHERE a.id = ? AND a.clinic_id = ?',
      [appointmentId, profile.id]
    ))[0];
    if (!appointment) throw new ReviewError('Appointment is unavailable.', 404);
    const existing = (await transactionRows(transaction,
      'SELECT id, due_at, status FROM reviews WHERE appointment_id = ? AND clinic_id = ?',
      [appointmentId, profile.id]
    ))[0];
    if (appointment.status === 'completed') {
      await transaction.commit();
      return { appointmentId, status: 'completed', review: existing || null, alreadyCompleted: true };
    }
    if (!['pending', 'confirmed'].includes(appointment.status)) {
      throw new ReviewError('Only active appointments can be completed.', 409);
    }
    await transaction.execute({
      sql: 'UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND clinic_id = ?',
      args: ['completed', appointmentId, profile.id]
    });
    const channel = chooseChannel(appointment);
    let review = null;
    if (channel) {
      const dueAt = iso(completedAt.getTime() + reviewDelay(profile) * 60 * 60 * 1000);
      const id = randomUUID();
      const token = randomUUID();
      await transaction.execute({
        sql: 'INSERT OR IGNORE INTO reviews (id, clinic_id, appointment_id, token, channel, due_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [id, profile.id, appointmentId, token, channel, dueAt]
      });
      review = (await transactionRows(transaction,
        'SELECT id, due_at, status FROM reviews WHERE appointment_id = ? AND clinic_id = ?',
        [appointmentId, profile.id]
      ))[0];
    }
    await transaction.commit();
    return { appointmentId, status: 'completed', review, alreadyCompleted: false };
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}

async function claimReview(id, clinicId, nowIso) {
  const claimToken = randomUUID();
  const result = await query(
    'UPDATE reviews SET status = ?, claim_token = ?, claimed_at = ?, last_error = NULL WHERE id = ? AND clinic_id = ? AND sent_at IS NULL AND delivery_started_at IS NULL AND (status = ? OR (status = ? AND claimed_at < ?))',
    ['processing', claimToken, nowIso, id, clinicId, 'pending', 'processing', iso(new Date(nowIso).getTime() - CLAIM_TIMEOUT_MS)]
  );
  return result.rowsAffected ? claimToken : null;
}

async function reviewContext(id, clinicId) {
  const review = rows(await query(
    'SELECT r.id, r.token, r.channel, o.name AS owner_name, o.mobile, o.email, p.name AS pet_name FROM reviews r JOIN appointments a ON a.id = r.appointment_id JOIN owners o ON o.id = a.owner_id JOIN pets p ON p.id = a.pet_id WHERE r.id = ? AND r.clinic_id = ?',
    [id, clinicId]
  ))[0];
  if (!review) throw new Error('Review request not found.');
  return review;
}

function reviewMessage(profile, review) {
  const template = profile.reviews.request;
  const values = { clinic: profile.name, owner: review.owner_name, pet: review.pet_name, reviewUrl: reviewUrl(review.token) };
  return {
    channel: review.channel,
    to: review.channel === 'sms' ? review.mobile : review.email,
    subject: interpolate(template.subject, values),
    message: interpolate(template.message, values)
  };
}

async function beginDelivery(id, clinicId, claimToken, nowIso) {
  const result = await query(
    'UPDATE reviews SET delivery_started_at = ? WHERE id = ? AND clinic_id = ? AND claim_token = ? AND delivery_started_at IS NULL',
    [nowIso, id, clinicId, claimToken]
  );
  return result.rowsAffected > 0;
}

async function markSent(id, clinicId, claimToken, result, nowIso) {
  const updated = await query(
    'UPDATE reviews SET status = ?, sent_at = ?, provider_message_id = ?, claim_token = NULL WHERE id = ? AND clinic_id = ? AND claim_token = ?',
    ['sent', nowIso, result.providerMessageId || null, id, clinicId, claimToken]
  );
  if (!updated.rowsAffected) throw new Error('Review delivery could not be recorded.');
}

async function markFailed(id, clinicId, claimToken, error) {
  await query(
    'UPDATE reviews SET status = ?, last_error = ?, claim_token = NULL WHERE id = ? AND clinic_id = ? AND claim_token = ?',
    ['failed', String(error.message || error).slice(0, 500), id, clinicId, claimToken]
  );
}

async function releasePreDeliveryClaim(id, clinicId, claimToken, error) {
  await query(
    'UPDATE reviews SET status = ?, claim_token = NULL, last_error = ? WHERE id = ? AND clinic_id = ? AND claim_token = ? AND delivery_started_at IS NULL',
    ['pending', String(error.message || error).slice(0, 500), id, clinicId, claimToken]
  );
}

export async function processReviewRequests({ now = new Date(), sendNotification = notify } = {}) {
  const profile = getActiveClinicProfile();
  const nowIso = iso(now);
  const due = rows(await query(
    'SELECT id FROM reviews WHERE clinic_id = ? AND due_at <= ? AND sent_at IS NULL AND delivery_started_at IS NULL AND (status = ? OR (status = ? AND claimed_at < ?)) ORDER BY due_at',
    [profile.id, nowIso, 'pending', 'processing', iso(new Date(nowIso).getTime() - CLAIM_TIMEOUT_MS)]
  ));
  const delivered = [];
  const failed = [];
  for (const item of due) {
    const claimToken = await claimReview(item.id, profile.id, nowIso);
    if (!claimToken) continue;
    let deliveryStarted = false;
    try {
      const payload = reviewMessage(profile, await reviewContext(item.id, profile.id));
      if (!await beginDelivery(item.id, profile.id, claimToken, nowIso)) continue;
      deliveryStarted = true;
      const result = await sendNotification(payload);
      await markSent(item.id, profile.id, claimToken, result, nowIso);
      delivered.push(item.id);
    } catch (error) {
      if (deliveryStarted) await markFailed(item.id, profile.id, claimToken, error);
      else await releasePreDeliveryClaim(item.id, profile.id, claimToken, error);
      failed.push({ id: item.id, error: error.message });
    }
  }
  return { delivered, failed };
}

export async function previewReview(token) {
  const profile = getActiveClinicProfile();
  const review = rows(await query(
    'SELECT r.id, r.rating, r.feedback, p.name AS pet_name FROM reviews r JOIN appointments a ON a.id = r.appointment_id JOIN pets p ON p.id = a.pet_id WHERE r.token = ? AND r.clinic_id = ? AND r.sent_at IS NOT NULL',
    [token, profile.id]
  ))[0];
  if (!review) throw new ReviewError('This review link is unavailable.', 404);
  return { rating: review.rating, feedbackSubmitted: Boolean(review.feedback), petName: review.pet_name };
}

export async function submitRating(token, value) {
  const profile = getActiveClinicProfile();
  const rating = ratingValue(value);
  const review = rows(await query(
    'SELECT id, rating FROM reviews WHERE token = ? AND clinic_id = ? AND sent_at IS NOT NULL',
    [token, profile.id]
  ))[0];
  if (!review) throw new ReviewError('This review link is unavailable.', 404);
  if (review.rating !== null && Number(review.rating) !== rating) {
    throw new ReviewError('This review link has already been used.', 409);
  }
  if (review.rating === null) {
    const saved = await query('UPDATE reviews SET rating = ?, rated_at = ? WHERE id = ? AND clinic_id = ? AND rating IS NULL', [rating, new Date().toISOString(), review.id, profile.id]);
    if (!saved.rowsAffected) {
      const winner = rows(await query('SELECT rating FROM reviews WHERE id = ? AND clinic_id = ?', [review.id, profile.id]))[0];
      if (!winner || Number(winner.rating) !== rating) throw new ReviewError('This review link has already been used.', 409);
    }
  }
  return rating >= 4
    ? { route: 'google', url: profile.reviews.googleReviewUrl }
    : { route: 'feedback' };
}

export async function submitFeedback(token, value) {
  const profile = getActiveClinicProfile();
  const feedback = feedbackText(value);
  const review = rows(await query(
    'SELECT id, rating, feedback FROM reviews WHERE token = ? AND clinic_id = ? AND sent_at IS NOT NULL',
    [token, profile.id]
  ))[0];
  if (!review) throw new ReviewError('This review link is unavailable.', 404);
  if (!review.rating || Number(review.rating) > 3) throw new ReviewError('Private feedback is unavailable for this rating.', 409);
  if (review.feedback) return { status: 'saved' };
  await query('UPDATE reviews SET feedback = ?, feedback_at = ? WHERE id = ? AND clinic_id = ? AND feedback IS NULL', [feedback, new Date().toISOString(), review.id, profile.id]);
  return { status: 'saved' };
}

export async function completeAppointmentRoute(request, response) {
  try {
    const appointment = await completeAppointment(request.params?.id || request.query?.id);
    return response.status(200).json({ appointment, invoice: await generateInvoice(appointment.appointmentId) });
  } catch (error) {
    if (error instanceof ReviewError) return response.status(error.status).json({ error: error.message });
    console.error('Appointment completion failed:', error);
    return response.status(500).json({ error: 'Appointment completion is temporarily unavailable.' });
  }
}

export async function previewReviewRoute(request, response) {
  try {
    return response.status(200).json({ review: await previewReview(tokenFrom(request)) });
  } catch (error) {
    if (error instanceof ReviewError) return response.status(error.status).json({ error: error.message });
    console.error('Review preview failed:', error);
    return response.status(500).json({ error: 'Review link is temporarily unavailable.' });
  }
}

export async function submitReviewRatingRoute(request, response) {
  try {
    return response.status(200).json(await submitRating(tokenFrom(request), request.body?.rating));
  } catch (error) {
    if (error instanceof ReviewError) return response.status(error.status).json({ error: error.message });
    console.error('Review rating failed:', error);
    return response.status(500).json({ error: 'Review rating is temporarily unavailable.' });
  }
}

export async function submitReviewFeedbackRoute(request, response) {
  try {
    return response.status(200).json(await submitFeedback(tokenFrom(request), request.body?.feedback));
  } catch (error) {
    if (error instanceof ReviewError) return response.status(error.status).json({ error: error.message });
    console.error('Review feedback failed:', error);
    return response.status(500).json({ error: 'Review feedback is temporarily unavailable.' });
  }
}
