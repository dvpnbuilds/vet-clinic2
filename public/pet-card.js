const byId = (id) => document.getElementById(id);
let profile;

function interpolate(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => values[key] || '');
}

function localDate(value) {
  return new Intl.DateTimeFormat(profile.locale, {
    timeZone: profile.timezone,
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(new Date(value + 'T12:00:00.000Z'));
}

function localDateTime(value) {
  return new Intl.DateTimeFormat(profile.locale, {
    timeZone: profile.timezone,
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
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

function render(card) {
  const copy = profile.petCard;
  document.title = profile.name + ' · ' + interpolate(copy.title, { pet: card.pet.name });
  document.documentElement.lang = profile.language === 'taglish' ? 'fil' : 'en';
  byId('clinic-wordmark').textContent = profile.name;
  byId('pet-card-kicker').textContent = copy.kicker;
  byId('pet-card-title').textContent = interpolate(copy.title, { pet: card.pet.name });
  byId('profile-title').textContent = copy.profile;
  byId('pet-name').textContent = card.pet.name;
  byId('species-label').textContent = copy.species;
  byId('pet-species').textContent = copy.speciesOptions[card.pet.species] || card.pet.species;
  byId('breed-label').textContent = copy.breed;
  byId('pet-breed').textContent = card.pet.breed || '—';
  byId('next-due-title').textContent = copy.nextDue;
  byId('vaccines-title').textContent = copy.vaccines;
  byId('visits-title').textContent = copy.visits;
  if (card.nextDue) {
    byId('next-due-name').textContent = card.nextDue.name;
    byId('next-due-date').textContent = localDate(card.nextDue.due_on);
  } else {
    byId('next-due-name').textContent = copy.noNextDue;
    byId('next-due-date').textContent = '';
  }
  list('vaccines-list', card.vaccinations, copy.noVaccines, (vaccination) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = vaccination.name;
    const given = document.createElement('span');
    given.textContent = copy.administered + ' · ' + localDate(vaccination.administered_on);
    const due = document.createElement('time');
    due.textContent = copy.due + ' · ' + localDate(vaccination.due_on);
    item.append(name, given, due);
    return item;
  });
  list('visits-list', card.visits, copy.noVisits, (visit) => {
    const item = document.createElement('li');
    const service = document.createElement('strong');
    service.textContent = visit.service_name;
    const date = document.createElement('time');
    date.textContent = localDateTime(visit.starts_at);
    item.append(service, date);
    return item;
  });
}

async function initialize() {
  const token = new URLSearchParams(window.location.search).get('token');
  const profileResponse = await fetch('/api/profile');
  if (!profileResponse.ok) throw new Error();
  profile = (await profileResponse.json()).clinic;
  const response = await fetch('/api/pets/card/' + encodeURIComponent(token || ''));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || profile.petCard.unavailable);
  render(data.card);
}

initialize().catch((error) => {
  if (profile) {
    byId('passport-error').textContent = error.message || profile.petCard.unavailable;
    byId('passport-error').classList.remove('is-hidden');
  }
});
