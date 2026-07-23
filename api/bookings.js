import { createDemoAccessMiddleware } from '../routes/demo-access.js';
import { booking } from '../routes/scheduling-routes.js';

const protectDemo = createDemoAccessMiddleware();

export default function handler(request, response) {
  return protectDemo(request, response, () => booking(request, response));
}
