import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createDemoAccessMiddleware } from '../routes/demo-access.js';
import { health } from '../routes/health.js';

async function request(app, passcode) {
  const server = await new Promise((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/api/health';
  const response = await fetch(url, { headers: passcode ? { 'x-demo-passcode': passcode } : {} });
  await new Promise((resolve) => server.close(resolve));
  return response;
}

function createApp({ consumeAttempt } = {}) {
  const app = express();
  app.get('/api/health', createDemoAccessMiddleware({ consumeAttempt }), health);
  return app;
}

test('health endpoint blocks requests without the demo passcode', async () => {
  process.env.DEMO_PASSCODE = 'test-passcode';
  const response = await request(createApp({
    consumeAttempt: async () => ({ count: 1, resetAt: Date.now() + 60000 })
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Demo passcode required.' });
});

test('health endpoint returns the active clinic profile after authentication', async () => {
  process.env.DEMO_PASSCODE = 'test-passcode';
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
  const response = await request(createApp({
    consumeAttempt: async () => ({ count: 1, resetAt: Date.now() + 60000 })
  }), 'test-passcode');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.clinic.name, 'Pawsitive Vet Care');
  assert.equal(body.clinic.language, 'taglish');
});

test('rate limit rejects requests over the configured per-IP maximum', async () => {
  const counts = new Map();
  process.env.DEMO_PASSCODE = 'test-passcode';
  process.env.DEMO_RATE_LIMIT_MAX = '2';
  const consumeAttempt = async (ip) => {
    const count = (counts.get(ip) || 0) + 1;
    counts.set(ip, count);
    return { count, resetAt: Date.now() + 60000 };
  };
  const app = createApp({ consumeAttempt });

  assert.equal((await request(app, 'test-passcode')).status, 200);
  assert.equal((await request(app, 'test-passcode')).status, 200);
  assert.equal((await request(app, 'test-passcode')).status, 429);
  process.env.DEMO_RATE_LIMIT_MAX = '60';
});
