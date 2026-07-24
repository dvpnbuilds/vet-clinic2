const byId = (id) => document.getElementById(id);
let profile;
let token;

function interpolate(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key) => values[key] || '');
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || profile.reviews.gate.unavailable);
  return data;
}

function showFeedback() {
  byId('rating-step').classList.add('is-hidden');
  byId('feedback-form').classList.remove('is-hidden');
  byId('feedback').focus();
}

function showThanks() {
  byId('rating-step').classList.add('is-hidden');
  byId('feedback-form').classList.add('is-hidden');
  byId('thanks-step').classList.remove('is-hidden');
}

function render(review) {
  const copy = profile.reviews.gate;
  document.title = profile.name + ' · ' + interpolate(copy.title, { pet: review.petName });
  document.documentElement.lang = profile.language === 'taglish' ? 'fil' : 'en';
  byId('clinic-wordmark').textContent = profile.name;
  byId('review-kicker').textContent = copy.kicker;
  byId('review-title').textContent = interpolate(copy.title, { pet: review.petName });
  byId('review-intro').textContent = copy.intro;
  byId('rating-prompt').textContent = copy.prompt;
  byId('feedback-title').textContent = copy.feedbackTitle;
  byId('feedback-label').textContent = copy.feedbackLabel;
  byId('feedback-action').textContent = copy.feedbackAction;
  byId('thanks-title').textContent = copy.thanksTitle;
  byId('thanks-body').textContent = copy.thanks;
  const scale = byId('rating-scale');
  scale.replaceChildren(...[1, 2, 3, 4, 5].map((rating) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(rating);
    button.setAttribute('aria-label', interpolate(copy.starLabel, { rating }));
    button.addEventListener('click', () => submitRating(rating));
    return button;
  }));
  if (review.feedbackSubmitted) showThanks();
  else if (review.rating && review.rating <= 3) showFeedback();
}

async function submitRating(rating) {
  const buttons = byId('rating-scale').querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });
  byId('rating-message').textContent = '';
  try {
    const result = await request('/api/reviews/' + encodeURIComponent(token) + '/rating', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating })
    });
    if (result.route === 'google') {
      window.location.assign(result.url);
      return;
    }
    showFeedback();
  } catch (error) {
    byId('rating-message').textContent = error.message || profile.reviews.gate.ratingError;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

byId('feedback-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = byId('feedback').value.trim();
  if (!value) {
    byId('feedback-message').textContent = profile.reviews.gate.required;
    return;
  }
  const action = byId('feedback-action');
  action.disabled = true;
  action.textContent = profile.reviews.gate.submitting;
  byId('feedback-message').textContent = '';
  try {
    await request('/api/reviews/' + encodeURIComponent(token) + '/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feedback: value })
    });
    showThanks();
  } catch (error) {
    byId('feedback-message').textContent = error.message || profile.reviews.gate.feedbackError;
  } finally {
    action.disabled = false;
    action.textContent = profile.reviews.gate.feedbackAction;
  }
});

async function initialize() {
  const params = new URLSearchParams(window.location.search);
  token = params.get('token');
  const profileResponse = await fetch('/api/profile');
  if (!profileResponse.ok) throw new Error();
  profile = (await profileResponse.json()).clinic;
  const review = await request('/api/reviews/' + encodeURIComponent(token));
  render(review.review);
}

initialize().catch(() => {
  byId('review-card').replaceChildren();
});
