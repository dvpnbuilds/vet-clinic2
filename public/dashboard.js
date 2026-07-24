const state = { staffCode: '', profile: null };
const byId = (id) => document.getElementById(id);

function interpolate(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => values[key] ?? '');
}

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...options.headers, 'x-staff-passcode': state.staffCode }
  });
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

function clinicShortDate(value) {
  return new Intl.DateTimeFormat(state.profile.locale, {
    timeZone: state.profile.timezone,
    weekday: 'short'
  }).format(new Date(value + 'T12:00:00.000Z'));
}

function clockHour(hour) {
  return new Intl.DateTimeFormat(state.profile.locale, {
    timeZone: 'UTC', hour: 'numeric'
  }).format(new Date(Date.UTC(2026, 0, 1, hour)));
}

function metricRate(value) {
  return value === null ? '—' : value + '%';
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

function renderAnalytics(analytics, copy) {
  byId('no-show-rate').textContent = metricRate(analytics.noShows.rate);
  byId('no-show-summary').textContent = analytics.noShows.closedVisits
    ? interpolate(copy.noShowSummary, { noShows: analytics.noShows.noShows, visits: analytics.noShows.closedVisits })
    : copy.noAnalytics;
  const trend = byId('no-show-trend');
  trend.replaceChildren(...analytics.noShows.days.map((day) => {
    const item = document.createElement('li');
    const bar = document.createElement('span');
    bar.className = 'trend-bar';
    bar.style.setProperty('--bar-height', Math.max(day.rate || 0, day.closedVisits ? 8 : 2) + '%');
    const label = document.createElement('span');
    label.textContent = clinicShortDate(day.date);
    item.append(bar, label);
    return item;
  }));
  byId('busiest-time-value').textContent = analytics.busiest.slot ? clockHour(analytics.busiest.slot.hour) : copy.noAnalytics;
  byId('busiest-time-count').textContent = analytics.busiest.slot ? interpolate(copy.appointmentsCount, { count: analytics.busiest.slot.appointments }) : '';
  byId('busiest-service-value').textContent = analytics.busiest.service ? analytics.busiest.service.name : copy.noAnalytics;
  byId('busiest-service-count').textContent = analytics.busiest.service ? interpolate(copy.appointmentsCount, { count: analytics.busiest.service.appointments }) : '';
  byId('conversion-rate').textContent = metricRate(analytics.reminderConversion.rate);
  byId('conversion-summary').textContent = analytics.reminderConversion.sent
    ? interpolate(copy.conversionSummary, { converted: analytics.reminderConversion.confirmed, sent: analytics.reminderConversion.sent })
    : copy.noAnalytics;
  byId('campaign-rate').textContent = metricRate(analytics.vaccineCampaign.rate);
  byId('campaign-summary').textContent = analytics.vaccineCampaign.sent
    ? interpolate(copy.recoverySummary, { recovered: analytics.vaccineCampaign.recovered, sent: analytics.vaccineCampaign.sent })
    : copy.noAnalytics;
}

function renderDashboard(data) {
  const copy = state.profile.dashboard;
  byId('dashboard-date').textContent = clinicDate(data.date);
  byId('recovered-value').textContent = money(data.recovered.centavos);
  byId('recovered-count').textContent = data.recovered.appointments + ' ' + copy.appointments;
  byId('revenue-value').textContent = money(data.invoices.revenueCentavos);
  byId('outstanding-value').textContent = money(data.invoices.outstandingCentavos);
  renderAnalytics(data.analytics, copy);
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
    if (appointment.status === 'completed') {
      const action = document.createElement('button'); action.type = 'button'; action.className = 'dashboard-action';
      action.textContent = appointment.invoice ? copy.receiptAction : copy.invoiceAction;
      action.addEventListener('click', async () => { try { const result = appointment.invoice ? { invoice: appointment.invoice } : await api('/api/appointments/' + encodeURIComponent(appointment.id) + '/invoice', { method: 'POST' }); window.open('/receipt.html?token=' + encodeURIComponent(result.invoice.receipt_token || result.invoice.receiptToken), '_blank', 'noopener'); renderDashboard(await api('/api/dashboard')); } catch { byId('dashboard-status').textContent = copy.invoiceError; } }); details.append(action);
      if (appointment.invoice) { const toggle=document.createElement('button'); toggle.type='button'; toggle.className='dashboard-action'; toggle.textContent=appointment.invoice.status === 'paid' ? copy.unpaidAction : copy.paidAction; toggle.addEventListener('click', async()=>{try{await api('/api/invoices/'+encodeURIComponent(appointment.invoice.id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:appointment.invoice.status === 'paid' ? 'unpaid' : 'paid'})});renderDashboard(await api('/api/dashboard'));}catch{byId('dashboard-status').textContent=copy.invoiceError;}}); details.append(toggle); }
    }
    if (appointment.status !== 'completed') {
      const complete = document.createElement('button');
      complete.type = 'button';
      complete.className = 'dashboard-action';
      complete.textContent = copy.completeAction;
      complete.addEventListener('click', async () => {
        complete.disabled = true;
        try {
          await api('/api/appointments/' + encodeURIComponent(appointment.id) + '/complete', { method: 'POST' });
          byId('dashboard-status').textContent = copy.completed;
          renderDashboard(await api('/api/dashboard'));
        } catch {
          byId('dashboard-status').textContent = copy.completeError;
        } finally {
          complete.disabled = false;
        }
      });
      details.append(complete);
    }
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'dashboard-action';
    card.textContent = copy.petCardAction;
    card.addEventListener('click', async () => {
      card.disabled = true;
      try {
        const response = await api('/api/pets/' + encodeURIComponent(appointment.pet_id) + '/card-token', { method: 'POST' });
        window.open(response.card.url, '_blank', 'noopener');
      } catch {
        byId('dashboard-status').textContent = copy.petCardError;
      } finally {
        card.disabled = false;
      }
    });
    details.append(card);
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
  list('walk-ins-list', data.walkIns, copy.emptyWalkIns, (walkIn) => {
    const item = document.createElement('li');
    const pet = document.createElement('strong');
    pet.textContent = walkIn.pet_name;
    const summary = document.createElement('span');
    summary.textContent = walkIn.owner_name + ' · ' + clinicTime(walkIn.arrived_at) + ' · ' + walkIn.reason;
    item.append(pet, summary);
    return item;
  });
  list('feedback-list', data.privateFeedback, copy.emptyFeedback, (feedback) => {
    const item = document.createElement('li');
    const pet = document.createElement('strong');
    pet.textContent = feedback.pet_name + ' · ' + feedback.rating + '/5';
    const summary = document.createElement('span');
    summary.textContent = feedback.owner_name + ' · ' + feedback.feedback;
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
  byId('walk-ins-title').textContent = copy.walkIns;
  byId('feedback-title').textContent = copy.feedback;
  byId('recovered-title').textContent = copy.recovered;
  byId('recovered-help').textContent = copy.recoveredHelp;
  byId('revenue-title').textContent = copy.revenue;
  byId('outstanding-title').textContent = copy.outstanding;
  byId('analytics-title').textContent = copy.analytics;
  byId('analytics-range').textContent = copy.lastSevenDays;
  byId('no-show-title').textContent = copy.noShowRate;
  byId('busiest-title').textContent = copy.busiest;
  byId('busiest-time-label').textContent = copy.busiestTime;
  byId('busiest-service-label').textContent = copy.busiestService;
  byId('conversion-title').textContent = copy.reminderConversion;
  byId('campaign-title').textContent = copy.vaccineRecovery;
  byId('booking-link').textContent = copy.bookingLink;
  byId('qr-link').textContent = copy.qrLink;
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
