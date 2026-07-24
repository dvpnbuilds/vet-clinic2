import { getPublicClinicProfile } from '../db/profiles/index.js';

export function publicProfile(request, response) {
  try {
    return response.status(200).json({ clinic: getPublicClinicProfile() });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
