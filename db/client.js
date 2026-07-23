import { createClient } from '@libsql/client';

let client;

function getDatabaseConfig() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error('TURSO_DATABASE_URL is not configured. Copy .env.example and add Turso credentials.');
  }

  return authToken ? { url, authToken } : { url };
}

export function getDb() {
  if (!client) {
    client = createClient(getDatabaseConfig());
  }

  return client;
}

export async function query(statement, args = []) {
  return getDb().execute({ sql: statement, args });
}

export async function consumeDemoRateLimit(ip, windowMs, timestamp) {
  const statement = [
    'INSERT INTO demo_rate_limits (ip, window_started_at, request_count)',
    'VALUES (?, ?, 1)',
    'ON CONFLICT(ip) DO UPDATE SET',
    'request_count = CASE',
    'WHEN demo_rate_limits.window_started_at <= excluded.window_started_at - ? THEN 1',
    'ELSE demo_rate_limits.request_count + 1 END,',
    'window_started_at = CASE',
    'WHEN demo_rate_limits.window_started_at <= excluded.window_started_at - ? THEN excluded.window_started_at',
    'ELSE demo_rate_limits.window_started_at END',
    'RETURNING request_count, window_started_at'
  ].join(' ');
  const result = await query(statement, [ip, timestamp, windowMs, windowMs]);
  const row = result.rows[0];
  return {
    count: Number(row.request_count),
    resetAt: Number(row.window_started_at) + windowMs
  };
}
