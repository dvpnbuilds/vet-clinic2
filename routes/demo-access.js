import { consumeDemoRateLimit } from '../db/client.js';
import { requestHeader, setResponseHeader } from './http.js';

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim()
    || request.ip
    || request.socket?.remoteAddress
    || 'unknown';
}

export function createDemoAccessMiddleware({
  now = () => Date.now(),
  consumeAttempt = consumeDemoRateLimit
} = {}) {
  const windowMs = Number.parseInt(process.env.DEMO_RATE_LIMIT_WINDOW_MS || '60000', 10);
  const maxAttempts = Number.parseInt(process.env.DEMO_RATE_LIMIT_MAX || '60', 10);

  return async function requireDemoAccess(request, response, next) {
    const passcode = process.env.DEMO_PASSCODE;
    if (!passcode) {
      return response.status(503).json({ error: 'Demo access is not configured.' });
    }

    const ip = getClientIp(request);
    const timestamp = now();
    let current;
    try {
      current = await consumeAttempt(ip, windowMs, timestamp);
    } catch (error) {
      console.error('Demo rate limit unavailable:', error.message);
      return response.status(503).json({ error: 'Demo access is temporarily unavailable.' });
    }

    setResponseHeader(response, 'RateLimit-Limit', String(maxAttempts));
    setResponseHeader(response, 'RateLimit-Remaining', String(Math.max(maxAttempts - current.count, 0)));

    if (current.count > maxAttempts) {
      setResponseHeader(response, 'Retry-After', String(Math.ceil((current.resetAt - timestamp) / 1000)));
      return response.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }

    const suppliedPasscode = requestHeader(request, 'x-demo-passcode') || request.query.demo_passcode;
    if (suppliedPasscode !== passcode) {
      return response.status(401).json({ error: 'Demo passcode required.' });
    }

    return next();
  };
}
