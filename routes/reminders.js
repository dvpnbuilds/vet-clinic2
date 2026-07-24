import { ReminderError, applyOwnerAction, listReminderReconciliation, listUnconfirmedAppointments, previewOwnerAction, processReminderCron, retryReminder } from '../db/reminders.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';
import { requestHeader } from './http.js';

function sendError(response, error) {
  if (error instanceof ReminderError) {
    return response.status(error.status).json({ error: error.message });
  }
  console.error('Reminder route failed:', error);
  return response.status(500).json({ error: 'Reminder processing is temporarily unavailable.' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function ownerActionPage(action, token) {
  const profile = getActiveClinicProfile();
  const copy = profile.reminders.ownerActions;
  const isConfirmation = action === 'confirm';
  const title = isConfirmation ? copy.confirmTitle : copy.rescheduleTitle;
  const prompt = isConfirmation ? copy.confirmPrompt : copy.reschedulePrompt;
  return '<!doctype html><html lang="' + escapeHtml(profile.language === 'taglish' ? 'fil' : 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escapeHtml(title) + '</title></head><body><main><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(prompt) + '</p><form method="post" action="/api/owner/' + encodeURIComponent(action) + '"><input type="hidden" name="token" value="' + escapeHtml(token) + '"><button type="submit">' + escapeHtml(copy.continueAction) + '</button></form></main></body></html>';
}

export async function runReminderCron(request, response) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return response.status(503).json({ error: 'Cron access is not configured.' });
  }
  if (requestHeader(request, 'x-cron-secret') !== secret) {
    return response.status(401).json({ error: 'Cron authorization required.' });
  }
  try {
    return response.status(200).json(await processReminderCron());
  } catch (error) {
    return sendError(response, error);
  }
}

export async function ownerAction(request, response) {
  try {
    const action = request.params?.action || request.query.action;
    const token = request.body?.token || request.query.token;
    if (request.method === 'GET') {
      await previewOwnerAction(action, token);
      return response.status(200).type('html').send(ownerActionPage(action, token));
    }
    if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Method not allowed.' });
    }
    return response.status(200).json(await applyOwnerAction(action, token));
  } catch (error) {
    return sendError(response, error);
  }
}

export async function unconfirmedAppointments(request, response) {
  try {
    return response.status(200).json({ appointments: await listUnconfirmedAppointments() });
  } catch (error) {
    return sendError(response, error);
  }
}

export async function reminderReconciliation(request, response) {
  try {
    return response.status(200).json({ reminders: await listReminderReconciliation() });
  } catch (error) {
    return sendError(response, error);
  }
}

export async function retryReminderRoute(request, response) {
  try {
    return response.status(200).json({ reminder: await retryReminder(request.params?.id) });
  } catch (error) {
    return sendError(response, error);
  }
}
