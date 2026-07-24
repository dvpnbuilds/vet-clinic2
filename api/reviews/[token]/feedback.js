import { createPublicWriteRateLimitMiddleware } from '../../../routes/demo-access.js';
import { submitReviewFeedbackRoute } from '../../../routes/reviews.js';

const limitPublicWrite = createPublicWriteRateLimitMiddleware({ keyPrefix: 'review' });

export default function handler(request, response) {
  return limitPublicWrite(request, response, () => submitReviewFeedbackRoute(request, response));
}
