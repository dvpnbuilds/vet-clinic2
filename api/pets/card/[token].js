import { petCard } from '../../../routes/pet-cards.js';

export default function handler(request, response) {
  return petCard(request, response);
}
