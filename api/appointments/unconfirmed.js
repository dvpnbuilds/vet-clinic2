import { createDemoAccessMiddleware } from '../../routes/demo-access.js';
import { unconfirmedAppointments } from '../../routes/reminders.js';

const protectDemo = createDemoAccessMiddleware();

export default function handler(request, response) {
  return protectDemo(request, response, () => unconfirmedAppointments(request, response));
}
