import { createPublicWriteRateLimitMiddleware } from '../../../routes/demo-access.js';
import { submitReviewRatingRoute } from '../../../routes/reviews.js';

const limitPublicWrite = createPublicWriteRateLimitMiddleware({ keyPrefix: 'review' });

export default function handler(request, response) {
  return limitPublicWrite(request, response, () => submitReviewRatingRoute(request, response));
}
