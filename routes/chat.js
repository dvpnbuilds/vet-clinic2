import { chatWithReceptionist } from '../ai/chat.js';

export async function receptionistChat(request, response) {
  try {
    return response.status(200).json(await chatWithReceptionist({ messages: request.body?.messages }));
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('Chat route failed:', error);
    return response.status(status).json({ error: error.message || 'Chat is temporarily unavailable.' });
  }
}
