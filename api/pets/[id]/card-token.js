import { createStaffAccessMiddleware } from '../../../routes/demo-access.js';
import { issuePetCardToken } from '../../../routes/pet-cards.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => issuePetCardToken(request, response));
}
