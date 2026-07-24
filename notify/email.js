export async function sendResendEmail({ to, subject, message }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw new Error('RESEND_API_KEY and RESEND_FROM_EMAIL must be configured.');
  }
  const timeoutMs = Number.parseInt(process.env.NOTIFY_TIMEOUT_MS || '10000', 10);
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [to],
      subject,
      text: message
    }),
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('Resend request timed out. Delivery status is unknown.');
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Resend rejected the email request.');
  }
  return { providerMessageId: String(data.id || '') };
}
