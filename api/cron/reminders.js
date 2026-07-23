import { runReminderCron } from '../../routes/reminders.js';

export default function handler(request, response) {
  return runReminderCron(request, response);
}
