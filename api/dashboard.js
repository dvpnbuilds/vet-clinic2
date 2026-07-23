import { createDemoAccessMiddleware } from '../routes/demo-access.js';
import { dashboard } from '../routes/dashboard.js';

const protectDemo = createDemoAccessMiddleware();

export default function handler(request, response) {
  return protectDemo(request, response, () => dashboard(request, response));
}
