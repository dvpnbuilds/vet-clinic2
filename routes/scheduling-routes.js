import {
  SchedulingError,
  bookSlot,
  createBlockOff,
  listCalendar,
  listSlots
} from '../db/scheduling.js';
import { requestHeader } from './http.js';

function sendError(response, error) {
  if (error instanceof SchedulingError) {
    return response.status(error.status).json({ error: error.message });
  }
  console.error('Scheduling route failed:', error);
  return response.status(500).json({ error: 'Scheduling is temporarily unavailable.' });
}

export async function slots(request, response) {
  try {
    const data = await listSlots({ date: request.query.date, serviceId: request.query.serviceId });
    return response.status(200).json({ slots: data });
  } catch (error) {
    return sendError(response, error);
  }
}

export async function booking(request, response) {
  try {
    const appointment = await bookSlot(request.body, { idempotencyKey: requestHeader(request, 'idempotency-key') });
    return response.status(201).json({ appointment });
  } catch (error) {
    return sendError(response, error);
  }
}

export async function blockOff(request, response) {
  try {
    const block = await createBlockOff(request.body);
    return response.status(201).json({ block });
  } catch (error) {
    return sendError(response, error);
  }
}

export async function calendar(request, response) {
  try {
    const data = await listCalendar({ date: request.query.date, view: request.query.view });
    return response.status(200).json(data);
  } catch (error) {
    return sendError(response, error);
  }
}
