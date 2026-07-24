import { getPublicClinicProfile } from '../db/profiles/index.js';

export function health(request, response) {
  try {
    const clinic = getPublicClinicProfile();
    return response.status(200).json({ status: 'ok', clinic });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
