import { createStaffAccessMiddleware } from '../routes/demo-access.js';
import { blockOff } from '../routes/scheduling-routes.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => blockOff(request, response));
}
