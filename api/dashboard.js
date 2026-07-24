import { createStaffAccessMiddleware } from '../routes/demo-access.js';
import { dashboard } from '../routes/dashboard.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => dashboard(request, response));
}
