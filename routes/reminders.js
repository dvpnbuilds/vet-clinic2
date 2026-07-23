import { ReminderError, applyOwnerAction, listUnconfirmedAppointments, processReminderCron } from '../db/reminders.js';
import { requestHeader } from './http.js';

function sendError(response, error) {
  if (error instanceof ReminderError) {
    return response.status(error.status).json({ error: error.message });
  }
  console.error('Reminder route failed:', error);
  return response.status(500).json({ error: 'Reminder processing is temporarily unavailable.' });
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
    return response.status(200).json(await applyOwnerAction(action, request.query.token));
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
