import { createDemoAccessMiddleware } from '../routes/demo-access.js';
import { slots } from '../routes/scheduling-routes.js';

const protectDemo = createDemoAccessMiddleware();

export default function handler(request, response) {
  return protectDemo(request, response, () => slots(request, response));
}
