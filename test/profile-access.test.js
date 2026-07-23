import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { requestHeader, setResponseHeader } from '../routes/http.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';

test('profile-owned access copy switches with the active clinic language', () => {
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
  assert.equal(getActiveClinicProfile().access.bookingAction, 'Magpatuloy');

  process.env.ACTIVE_CLINIC_PROFILE = 'western';
  assert.equal(getActiveClinicProfile().access.bookingAction, 'Continue');
  assert.equal(getActiveClinicProfile().access.error.includes('Hindi'), false);
  process.env.ACTIVE_CLINIC_PROFILE = 'ph';
});

test('pre-access pages do not embed an English access-screen fallback', async () => {
  for (const file of ['public/index.html', 'public/chat.html', 'public/dashboard.html']) {
    const source = await readFile(file, 'utf8');
    assert.equal(source.includes('Enter your demo access code'), false);
    assert.equal(source.includes('Continue</button>'), false);
  }
});

test('public clients set the document language from the active profile before access', async () => {
  for (const file of ['public/booking.js', 'public/chat.js', 'public/dashboard.js']) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /document\.documentElement\.lang = profile\.language/);
  }
});

test('request header helpers support Vercel-style request and response objects', () => {
  const request = { headers: { 'x-demo-passcode': 'vercel-code' } };
  const response = {
    values: {},
    setHeader(name, value) {
      this.values[name] = value;
    }
  };
  assert.equal(requestHeader(request, 'x-demo-passcode'), 'vercel-code');
  setResponseHeader(response, 'RateLimit-Limit', '60');
  assert.equal(response.values['RateLimit-Limit'], '60');
});
