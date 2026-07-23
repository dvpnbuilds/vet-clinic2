import ph from './ph.js';
import western from './western.js';

const profiles = { ph, western };

export function getActiveClinicProfile() {
  const key = process.env.ACTIVE_CLINIC_PROFILE || 'ph';
  const profile = profiles[key];

  if (!profile) {
    throw new Error(`Unknown ACTIVE_CLINIC_PROFILE: ${key}`);
  }

  return profile;
}

export { profiles };
