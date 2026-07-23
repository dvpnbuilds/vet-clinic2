export async function sendSemaphoreSms({ to, message }) {
  if (!process.env.SEMAPHORE_API_KEY) {
    throw new Error('SEMAPHORE_API_KEY is not configured.');
  }
  const body = new URLSearchParams({
    apikey: process.env.SEMAPHORE_API_KEY,
    number: to,
    message
  });
  if (process.env.SEMAPHORE_SENDER_NAME) {
    body.set('sendername', process.env.SEMAPHORE_SENDER_NAME);
  }
  const response = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Semaphore rejected the SMS request.');
  }
  return { providerMessageId: String(data[0]?.message_id || data[0]?.messageId || '') };
}
