const state = { profile: null, accessCode: '', service: null, slot: null, bookingKey: null };

const el = (id) => document.getElementById(id);
const accessCard = el('access-card');
const flow = el('booking-flow');

function renderAccess(profile) {
  document.documentElement.lang = profile.language === 'taglish' ? 'fil' : 'en';
  const access = profile.access;
  addText('access-title', access.bookingTitle);
  addText('access-help', access.help);
  addText('access-label', access.label);
  addText('access-action', access.bookingAction);
}

async function loadAccessProfile() {
  const response = await fetch('/api/profile');
  if (!response.ok) return;
  const data = await response.json();
  state.profile = data.clinic;
  renderAccess(state.profile);
}

function setMessage(id, message = '') {
  el(id).textContent = message;
}

function setVisible(id, visible) {
  el(id).classList.toggle('is-hidden', !visible);
}

function clinicToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: state.profile.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function money(value) {
  return new Intl.NumberFormat(state.profile.locale, {
    style: 'currency',
    currency: state.profile.currency,
    maximumFractionDigits: 0
  }).format(value / 100);
}

function time(iso) {
  return new Intl.DateTimeFormat(state.profile.locale, {
    timeZone: state.profile.timezone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

function dateTime(iso) {
  return new Intl.DateTimeFormat(state.profile.locale, {
    timeZone: state.profile.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-demo-passcode', state.accessCode);
  if (options.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function addText(id, value) {
  el(id).textContent = value;
}

function renderProfile() {
  const { booking, name, address, phone } = state.profile;
  document.documentElement.lang = state.profile.language === 'taglish' ? 'fil' : 'en';
  document.title = name;
  addText('kicker', booking.kicker);
  addText('clinic-name', name);
  addText('intro', booking.headline + ' ' + booking.intro);
  addText('clinic-address', address);
  el('clinic-phone').textContent = phone;
  el('clinic-phone').href = 'tel:' + phone.replace(/\s/g, '');
  addText('service-heading', booking.serviceHeading);
  addText('service-help', booking.serviceHelp);
  addText('slot-heading', booking.slotsHeading);
  addText('slot-help', booking.slotsHelp);
  addText('date-label', booking.dateLabel);
  addText('timezone-note', booking.timeZoneNote);
  addText('details-heading', booking.detailsHeading);
  addText('owner-name-label', booking.ownerName);
  addText('mobile-label', booking.mobile);
  addText('email-label', booking.email);
  addText('pet-name-label', booking.petName);
  addText('species-label', booking.species);
  addText('breed-label', booking.breed);
  addText('book-action', booking.bookAction);
  addText('success-kicker', booking.kicker);
  addText('success-heading', booking.bookedHeading);
  addText('success-body', booking.bookedBody);
  addText('another-action', booking.anotherAction);
  const date = el('booking-date');
  date.min = clinicToday();
  date.value = clinicToday();
  el('pet-species').innerHTML = Object.entries(booking.speciesOptions)
    .map(([value, label]) => '<option value="' + value + '">' + label + '</option>')
    .join('');
  renderServices();
}

function renderServices() {
  const services = el('services');
  services.replaceChildren(...state.profile.services.map((service) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'service-card';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(state.service?.id === service.id));
    button.innerHTML = '<strong>' + service.name + '</strong><span>' + service.description + '</span><small>'
      + service.durationMinutes + ' min · ' + money(service.priceCentavos) + '</small>';
    button.addEventListener('click', () => chooseService(service));
    return button;
  }));
}

async function chooseService(service) {
  state.service = service;
  state.slot = null;
  setVisible('details-section', false);
  el('availability-section').classList.remove('is-muted');
  renderServices();
  await loadSlots();
}

async function loadSlots() {
  if (!state.service) return;
  const copy = state.profile.booking;
  setMessage('slots-message', copy.loading);
  el('slots').replaceChildren();
  try {
    const date = el('booking-date').value;
    const data = await api('/api/slots?date=' + encodeURIComponent(date) + '&serviceId=' + encodeURIComponent(state.service.id));
    setMessage('slots-message', data.slots.length ? '' : copy.slotsEmpty);
    el('slots').replaceChildren(...data.slots.map((slot) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot-button';
      button.setAttribute('aria-pressed', String(state.slot?.id === slot.id));
      button.textContent = time(slot.startsAt);
      button.addEventListener('click', () => chooseSlot(slot));
      return button;
    }));
  } catch (error) {
    setMessage('slots-message', error.message);
  }
}

function chooseSlot(slot) {
  state.slot = slot;
  state.bookingKey = null;
  el('chosen-slot').textContent = state.service.name + ' · ' + dateTime(slot.startsAt) + ' · ' + slot.vetName;
  setVisible('details-section', true);
  document.querySelectorAll('.slot-button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.textContent === time(slot.startsAt)));
  });
  el('owner-name').focus({ preventScroll: true });
  el('details-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function authenticate(code) {
  state.accessCode = code;
  const data = await api('/api/health');
  state.profile = data.clinic;
  renderProfile();
  accessCard.classList.add('is-hidden');
  flow.classList.remove('is-hidden');
}

el('access-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = el('access-code').value.trim();
  if (!code) return;
  el('access-action').disabled = true;
  setMessage('access-message');
  try {
    await authenticate(code);
    sessionStorage.setItem('vetflow-demo-code', code);
  } catch {
    setMessage('access-message', state.profile?.access.error || '');
  } finally {
    el('access-action').disabled = false;
  }
});

el('booking-date').addEventListener('change', () => {
  state.slot = null;
  setVisible('details-section', false);
  loadSlots();
});

el('booking-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const copy = state.profile.booking;
  if (!state.slot || !event.currentTarget.reportValidity()) {
    setMessage('booking-message', copy.required);
    return;
  }
  const form = new FormData(event.currentTarget);
  const button = el('book-action');
  button.disabled = true;
  button.textContent = copy.booking;
  setMessage('booking-message');
  try {
    state.bookingKey ||= crypto.randomUUID();
    const { appointment } = await api('/api/bookings', {
      method: 'POST',
      headers: { 'idempotency-key': state.bookingKey },
      body: JSON.stringify({
        slotId: state.slot.id,
        owner: { name: form.get('ownerName'), mobile: form.get('mobile'), email: form.get('email') },
        pet: { name: form.get('petName'), species: form.get('species'), breed: form.get('breed') }
      })
    });
    addText('success-summary', state.service.name + ' · ' + dateTime(appointment.startsAt));
    setVisible('details-section', false);
    setVisible('availability-section', false);
    setVisible('thank-you', true);
    el('thank-you').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setMessage('booking-message', error.status === 409 ? copy.unavailable : error.message);
    if (error.status === 409) loadSlots();
  } finally {
    button.disabled = false;
    button.textContent = copy.bookAction;
  }
});

el('another-action').addEventListener('click', () => {
  state.service = null;
  state.slot = null;
  state.bookingKey = null;
  el('booking-form').reset();
  setVisible('thank-you', false);
  setVisible('availability-section', true);
  el('availability-section').classList.add('is-muted');
  renderServices();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

el('booking-form').addEventListener('input', () => {
  state.bookingKey = null;
});

const rememberedCode = sessionStorage.getItem('vetflow-demo-code');
loadAccessProfile();
if (rememberedCode) {
  el('access-code').value = rememberedCode;
  authenticate(rememberedCode).catch(() => sessionStorage.removeItem('vetflow-demo-code'));
}
