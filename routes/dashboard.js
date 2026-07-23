import { getDashboard } from '../db/dashboard.js';

export async function dashboard(request, response) {
  try {
    return response.status(200).json(await getDashboard());
  } catch (error) {
    console.error('Dashboard route failed:', error);
    return response.status(500).json({ error: 'Dashboard data is temporarily unavailable.' });
  }
}
