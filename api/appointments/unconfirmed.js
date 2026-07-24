import { createStaffAccessMiddleware } from '../../routes/demo-access.js';
import { unconfirmedAppointments } from '../../routes/reminders.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => unconfirmedAppointments(request, response));
}
