import { previewReviewRoute } from '../../routes/reviews.js';

export default function handler(request, response) {
  return previewReviewRoute(request, response);
}
