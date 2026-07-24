import { createStaffAccessMiddleware } from '../../../routes/demo-access.js';
import { completeAppointmentRoute } from '../../../routes/reviews.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => completeAppointmentRoute(request, response));
}
