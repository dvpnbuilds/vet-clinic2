import { qrSvg } from './qr-code.js';

const byId = (id) => document.getElementById(id);

async function setup() {
  const response = await fetch('/api/profile');
  if (!response.ok) throw new Error('Profile unavailable');
  const profile = (await response.json()).clinic;
  const copy = profile.walkIn;
  const url = new URL('/w', window.location.origin).toString();
  document.title = profile.name + ' · ' + copy.qrTitle;
  document.documentElement.lang = profile.language === 'taglish' ? 'fil' : 'en';
  byId('clinic-wordmark').textContent = profile.name;
  byId('qr-clinic').textContent = profile.name;
  byId('qr-title').textContent = copy.qrTitle;
  byId('qr-intro').textContent = copy.qrIntro;
  byId('print-qr').textContent = copy.print;
  byId('qr-url').textContent = url;
  try {
    byId('qr-code').innerHTML = qrSvg(url, copy.qrTitle);
  } catch {
    byId('qr-message').textContent = copy.qrError;
  }
}

byId('print-qr').addEventListener('click', () => window.print());
setup().catch(() => {
  byId('qr-message').textContent = '';
});
