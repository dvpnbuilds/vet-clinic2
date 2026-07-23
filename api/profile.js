import { publicProfile } from '../routes/profile.js';

export default function handler(request, response) {
  return publicProfile(request, response);
}
