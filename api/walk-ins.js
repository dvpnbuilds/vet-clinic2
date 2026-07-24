import { createPublicWriteRateLimitMiddleware } from '../routes/demo-access.js';
import { createWalkInRoute } from '../routes/walk-ins.js';

const limitPublicWrite = createPublicWriteRateLimitMiddleware();

export default function handler(request, response) {
  return limitPublicWrite(request, response, () => createWalkInRoute(request, response));
}
