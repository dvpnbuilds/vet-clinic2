import { createDemoAccessMiddleware } from '../routes/demo-access.js';
import { calendar } from '../routes/scheduling-routes.js';

const protectDemo = createDemoAccessMiddleware();

export default function handler(request, response) {
  return protectDemo(request, response, () => calendar(request, response));
}
