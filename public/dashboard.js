const state = { staffCode: '', profile: null };
const byId = (id) => document.getElementById(id);

function renderAccess(profile) {
  document.documentElement.lang = profile.language === 'taglish' ? 'fil' : 'en';
  byId('access-title').textContent = profile.access.staffTitle;
  byId('access-help').textContent = profile.access.staffHelp;
  byId('access-label').textContent = profile.access.staffLabel;
  byId('access-action').textContent = profile.access.staffAction;
}

async function loadAccessProfile() {
  const response = await fetch('/api/profile');
  if (!response.ok) return;
  state.profile = (await response.json()).clinic;
  renderAccess(state.profile);
}

async function api(path) {
  const response = await fetch(path, { headers: { 'x-staff-passcode': state.staffCode } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function money(centavos) {
  return new Intl.NumberFormat(state.profile.locale, {
    style: 'currency',
    currency: state.profile.currency,
    maximumFractionDigits: 0
  }).format(centavos / 100);
}

function clinicDate(value) {
  return new Intl.DateTimeFormat(state.profile.locale, {
    timeZone: state.profile.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(new Date(value + 'T12:00:00.000Z'));
}

function clinicTime(value) {
  return new Intl.DateTimeFormat(state.profile.locale, {
    timeZone: state.profile.timezone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function list(target, items, emptyText, render) {
  const node = byId(target);
  node.replaceChildren();
  if (!items.length) {
    const item = document.createElement('li');
    item.className = 'empty-state';
    item.textContent = emptyText;
    node.append(item);
    return;
  }
  node.replaceChildren(...items.map(render));
}

function renderDashboard(data) {
  const copy = state.profile.dashboard;
  byId('dashboard-date').textContent = clinicDate(data.date);
  byId('recovered-value').textContent = money(data.recovered.centavos);
  byId('recovered-count').textContent = data.recovered.appointments + ' ' + copy.appointments;
  list('calendar-list', data.calendar, copy.emptyToday, (appointment) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = clinicTime(appointment.starts_at);
    const details = document.createElement('div');
    const pet = document.createElement('strong');
    pet.textContent = appointment.pet_name;
    const summary = document.createElement('span');
    summary.textContent = appointment.service_name + ' · ' + appointment.owner_name;
    details.append(pet, summary);
    item.append(time, details);
    return item;
  });
  list('pending-list', data.pending, copy.emptyPending, (appointment) => {
    const item = document.createElement('li');
    const pet = document.createElement('strong');
    pet.textContent = appointment.pet_name;
    const summary = document.createElement('span');
    summary.textContent = appointment.owner_name + ' · ' + clinicTime(appointment.starts_at);
    item.append(pet, summary);
    return item;
  });
  list('vaccines-list', data.vaccines, copy.emptyVaccines, (vaccine) => {
    const item = document.createElement('li');
    const pet = document.createElement('strong');
    pet.textContent = vaccine.pet_name;
    const summary = document.createElement('span');
    summary.textContent = vaccine.vaccine_name + ' · ' + vaccine.owner_name;
    item.append(pet, summary);
    return item;
  });
}

function renderProfile() {
  const copy = state.profile.dashboard;
  document.title = state.profile.name + ' dashboard';
  document.documentElement.lang = state.profile.language === 'taglish' ? 'fil' : 'en';
  byId('clinic-name').textContent = state.profile.name;
  byId('dashboard-title').textContent = copy.title;
  byId('dashboard-intro').textContent = copy.intro;
  byId('calendar-title').textContent = copy.today;
  byId('pending-title').textContent = copy.pending;
  byId('vaccines-title').textContent = copy.vaccines;
  byId('recovered-title').textContent = copy.recovered;
  byId('recovered-help').textContent = copy.recoveredHelp;
  byId('booking-link').textContent = copy.bookingLink;
}

byId('access-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  state.staffCode = byId('access-code').value.trim();
  if (!state.staffCode) return;
  try {
    state.profile = (await api('/api/profile')).clinic;
    renderProfile();
    byId('dashboard-status').textContent = state.profile.dashboard.loading;
    renderDashboard(await api('/api/dashboard'));
    byId('dashboard-status').textContent = '';
    byId('access-card').classList.add('is-hidden');
    byId('dashboard-app').classList.remove('is-hidden');
    sessionStorage.setItem('vetflow-staff-code', state.staffCode);
  } catch {
    byId('access-message').textContent = state.profile?.access.staffError || '';
  }
});

const rememberedCode = sessionStorage.getItem('vetflow-staff-code');
loadAccessProfile();
if (rememberedCode) byId('access-code').value = rememberedCode;
