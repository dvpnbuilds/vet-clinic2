import { createStaffAccessMiddleware } from '../../routes/demo-access.js';
import { reminderReconciliation } from '../../routes/reminders.js';

const protectStaff = createStaffAccessMiddleware();

export default function handler(request, response) {
  return protectStaff(request, response, () => reminderReconciliation(request, response));
}
