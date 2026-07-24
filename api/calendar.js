import { createStaffAccessMiddleware } from '../routes/demo-access.js';
import { calendar } from '../routes/scheduling-routes.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => calendar(request, response));
}
