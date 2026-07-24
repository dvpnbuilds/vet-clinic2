const byId = (id) => document.getElementById(id);
let profile;

function renderProfile() {
  const copy = profile.walkIn;
  document.title = profile.name + ' · ' + copy.title;
  document.documentElement.lang = profile.language === 'taglish' ? 'fil' : 'en';
  byId('clinic-wordmark').textContent = profile.name;
  byId('walk-in-kicker').textContent = copy.kicker;
  byId('walk-in-title').textContent = copy.title;
  byId('walk-in-intro').textContent = copy.intro;
  byId('walk-in-form-title').textContent = copy.formTitle;
  byId('owner-label').textContent = copy.ownerName;
  byId('mobile-label').textContent = copy.mobile;
  byId('pet-label').textContent = copy.petName;
  byId('species-label').textContent = copy.species;
  byId('breed-label').textContent = copy.breed;
  byId('reason-label').textContent = copy.reason;
  byId('walk-in-submit').textContent = copy.submit;
  byId('walk-in-success-title').textContent = copy.successTitle;
  byId('walk-in-success-body').textContent = copy.success;
  byId('walk-in-another').textContent = copy.another;
  const select = byId('species-select');
  select.replaceChildren(...Object.entries(copy.speciesOptions).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

async function loadProfile() {
  const response = await fetch('/api/profile');
  if (!response.ok) throw new Error('Profile unavailable');
  profile = (await response.json()).clinic;
  renderProfile();
}

byId('walk-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    byId('walk-in-message').textContent = profile.walkIn.required;
    form.reportValidity();
    return;
  }
  const submit = byId('walk-in-submit');
  submit.disabled = true;
  submit.textContent = profile.walkIn.submitting;
  byId('walk-in-message').textContent = '';
  try {
    const details = Object.fromEntries(new FormData(form));
    const response = await fetch('/api/walk-ins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(details)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || profile.walkIn.unavailable);
    form.reset();
    byId('walk-in-form-card').classList.add('is-hidden');
    byId('walk-in-success').classList.remove('is-hidden');
  } catch (error) {
    byId('walk-in-message').textContent = error.message || profile.walkIn.unavailable;
  } finally {
    submit.disabled = false;
    submit.textContent = profile.walkIn.submit;
  }
});

byId('walk-in-another').addEventListener('click', () => {
  byId('walk-in-success').classList.add('is-hidden');
  byId('walk-in-form-card').classList.remove('is-hidden');
  byId('walk-in-form').elements.ownerName.focus();
});

loadProfile().catch(() => {
  byId('walk-in-message').textContent = '';
});
