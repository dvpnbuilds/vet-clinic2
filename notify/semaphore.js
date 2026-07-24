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
  const timeoutMs = Number.parseInt(process.env.NOTIFY_TIMEOUT_MS || '10000', 10);
  let response;
  try {
    response = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('Semaphore request timed out. Delivery status is unknown.');
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Semaphore rejected the SMS request.');
  }
  return { providerMessageId: String(data[0]?.message_id || data[0]?.messageId || '') };
}
