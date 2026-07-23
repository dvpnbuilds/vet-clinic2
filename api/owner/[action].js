import { ownerAction } from '../../routes/reminders.js';

export default function handler(request, response) {
  return ownerAction(request, response);
}
