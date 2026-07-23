import { createDemoAccessMiddleware } from '../routes/demo-access.js';
import { health } from '../routes/health.js';

const protectDemo = createDemoAccessMiddleware();

export default function handler(request, response) {
  return protectDemo(request, response, () => health(request, response));
}
