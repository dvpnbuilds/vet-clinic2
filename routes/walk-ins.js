import { WalkInError, createWalkIn } from '../db/walk-ins.js';

export async function createWalkInRoute(request, response) {
  try {
    const walkIn = await createWalkIn(request.body);
    return response.status(201).json({ walkIn });
  } catch (error) {
    if (error instanceof WalkInError) return response.status(error.status).json({ error: error.message });
    console.error('Walk-in route failed:', error);
    return response.status(500).json({ error: 'Walk-in intake is temporarily unavailable.' });
  }
}
