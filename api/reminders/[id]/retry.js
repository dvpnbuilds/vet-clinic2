import { createStaffAccessMiddleware } from '../../../routes/demo-access.js';
import { retryReminderRoute } from '../../../routes/reminders.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => retryReminderRoute(request, response));
}
