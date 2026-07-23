export class OpenRouterError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

export async function chatCompletion({ messages, tools }) {
  if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL) {
    throw new OpenRouterError('AI chat is not configured.', 503);
  }
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.3
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new OpenRouterError(payload.error?.message || 'AI chat is temporarily unavailable.', response.status);
  }
  const message = payload.choices?.[0]?.message;
  if (!message) {
    throw new OpenRouterError('AI chat returned an empty response.');
  }
  return message;
}
