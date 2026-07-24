import { consumeDemoRateLimit } from '../db/client.js';
import { requestHeader, setResponseHeader } from './http.js';

function singleIp(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  return ip && !ip.includes(',') ? ip : null;
}

export function getClientIp(request) {
  // Vercel overwrites this platform header on direct deployments, so it cannot
  // be selected by an attacker from a forwarded chain.
  const vercelIp = singleIp(requestHeader(request, 'x-vercel-forwarded-for'));
  if (vercelIp) return vercelIp;

  if (typeof request.ip === 'string' && request.ip) return request.ip;
  if (typeof request.socket?.remoteAddress === 'string' && request.socket.remoteAddress) {
    return request.socket.remoteAddress;
  }
  return 'unknown';
}

function createPasscodeAccessMiddleware({
  envKey,
  headerName,
  unavailableMessage,
  unauthorizedMessage,
  now = () => Date.now(),
  consumeAttempt = consumeDemoRateLimit
}) {
  const windowMs = Number.parseInt(process.env.DEMO_RATE_LIMIT_WINDOW_MS || '60000', 10);
  const maxAttempts = Number.parseInt(process.env.DEMO_RATE_LIMIT_MAX || '60', 10);

  return async function requirePasscode(request, response, next) {
    const passcode = process.env[envKey];
    if (!passcode) {
      return response.status(503).json({ error: unavailableMessage });
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

    const suppliedPasscode = requestHeader(request, headerName);
    if (suppliedPasscode !== passcode) {
      return response.status(401).json({ error: unauthorizedMessage });
    }

    return next();
  };
}

export function createDemoAccessMiddleware(options = {}) {
  return createPasscodeAccessMiddleware({
    envKey: 'DEMO_PASSCODE',
    headerName: 'x-demo-passcode',
    unavailableMessage: 'Demo access is not configured.',
    unauthorizedMessage: 'Demo passcode required.',
    ...options
  });
}

export function createStaffAccessMiddleware(options = {}) {
  return createPasscodeAccessMiddleware({
    envKey: 'STAFF_PASSCODE',
    headerName: 'x-staff-passcode',
    unavailableMessage: 'Staff access is not configured.',
    unauthorizedMessage: 'Staff access required.',
    ...options
  });
}
