import { PetCardError, createPetCardToken, getPetCard } from '../db/pet-cards.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';

function errorResponse(response, error, { publicCard = false } = {}) {
  if (error instanceof PetCardError) {
    const message = publicCard ? getActiveClinicProfile().petCard.unavailable : error.message;
    return response.status(error.status).json({ error: message });
  }
  console.error('Pet card route failed:', error);
  const message = publicCard
    ? getActiveClinicProfile().petCard.unavailable
    : 'Pet card access is temporarily unavailable.';
  return response.status(500).json({ error: message });
}

export async function petCard(request, response) {
  try {
    return response.status(200).json({ card: await getPetCard(request.params?.token || request.query?.token) });
  } catch (error) {
    return errorResponse(response, error, { publicCard: true });
  }
}

export async function issuePetCardToken(request, response) {
  try {
    return response.status(201).json({ card: await createPetCardToken(request.params?.id || request.query?.id) });
  } catch (error) {
    return errorResponse(response, error);
  }
}
