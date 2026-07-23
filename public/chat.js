const state = { code: '', profile: null, messages: [] };
const byId = (id) => document.getElementById(id);

function renderAccess(profile) {
  document.documentElement.lang = profile.language === 'taglish' ? 'fil' : 'en';
  byId('access-title').textContent = profile.access.chatTitle;
  byId('access-help').textContent = profile.access.help;
  byId('access-label').textContent = profile.access.label;
  byId('access-action').textContent = profile.access.chatAction;
}

async function loadAccessProfile() {
  const response = await fetch('/api/profile');
  if (!response.ok) return;
  state.profile = (await response.json()).clinic;
  renderAccess(state.profile);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-demo-passcode', state.code);
  if (options.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function addBubble(role, content) {
  const bubble = document.createElement('article');
  bubble.className = 'bubble bubble-' + role;
  bubble.textContent = content;
  byId('messages').append(bubble);
  bubble.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function renderProfile() {
  const { chat, name } = state.profile;
  document.title = name + ' chat';
  document.documentElement.lang = state.profile.language === 'taglish' ? 'fil' : 'en';
  byId('clinic-name').textContent = name;
  byId('chat-kicker').textContent = chat.title;
  byId('chat-title').textContent = chat.title;
  byId('chat-intro').textContent = chat.intro;
  byId('chat-input-label').textContent = chat.inputLabel;
  byId('chat-input').placeholder = chat.inputPlaceholder;
  byId('send-action').textContent = chat.sendAction;
  const greeting = chat.greeting.replace('{clinic}', name);
  state.messages.push({ role: 'assistant', content: greeting });
  addBubble('assistant', greeting);
}

byId('access-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  state.code = byId('access-code').value.trim();
  if (!state.code) return;
  try {
    state.profile = (await api('/api/health')).clinic;
    renderProfile();
    byId('access-card').classList.add('is-hidden');
    byId('chat-app').classList.remove('is-hidden');
    sessionStorage.setItem('vetflow-demo-code', state.code);
    byId('chat-input').focus();
  } catch {
    byId('access-message').textContent = state.profile?.access.error || '';
  }
});

byId('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = byId('chat-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  state.messages.push({ role: 'user', content });
  addBubble('user', content);
  const button = byId('send-action');
  button.disabled = true;
  try {
    const reply = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: state.messages })
    });
    state.messages.push({ role: 'assistant', content: reply.message });
    addBubble('assistant', reply.message);
  } catch (error) {
    addBubble('assistant', state.profile?.chat.unavailable || error.message);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

const rememberedCode = sessionStorage.getItem('vetflow-demo-code');
loadAccessProfile();
if (rememberedCode) {
  byId('access-code').value = rememberedCode;
}
