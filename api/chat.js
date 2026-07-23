import { createDemoAccessMiddleware } from '../routes/demo-access.js';
import { receptionistChat } from '../routes/chat.js';

const protectDemo = createDemoAccessMiddleware();

export default function handler(request, response) {
  return protectDemo(request, response, () => receptionistChat(request, response));
}
