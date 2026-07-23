import { sendResendEmail } from './email.js';
import { sendSemaphoreSms } from './semaphore.js';

function dryRunEnabled() {
  return process.env.DRY_RUN !== 'false';
}

export async function notify({ channel, to, subject, message }) {
  if (!['sms', 'email'].includes(channel)) {
    throw new Error('Unsupported notification channel.');
  }
  if (!to) {
    throw new Error('Notification recipient is required.');
  }

  if (dryRunEnabled()) {
    console.log('[DRY_RUN notify]', { channel, to, subject, message });
    return { providerMessageId: 'dry-run', dryRun: true };
  }

  return channel === 'sms'
    ? sendSemaphoreSms({ to, message })
    : sendResendEmail({ to, subject, message });
}
