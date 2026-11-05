// First-time setup: make the first admin. Reached only with the one-time setup code the
// server prints when it starts (or, on an older install, after the shared password).
import { api, postJson, esc } from './ui.js';

const box = document.getElementById('box');
const brand = '<div class="brand"><span class="mark">K</span><span>Digital Kaizen<small>First-time setup</small></span></div>';
const code = new URLSearchParams(location.search).get('t') || '';
const st = await api('/api/setup/state');

if (!st.open) {
  const link = st.reason === 'accounts-exist' ? '<p><a href="/login.html">Go to sign in</a></p>'
    : st.reason === 'sign-in-first' ? '<p><a href="/login.html">Enter the dashboard password</a></p>' : '';
  box.innerHTML = `${brand}<h1>Setup is closed</h1><p>${esc(st.message || 'Setup is not available.')}</p>${link}`;
} else {
  const needCode = st.via === 'token';
  box.innerHTML = `${brand}<h1>Make the first admin</h1>
    <p>This person manages the dashboard and can add everyone else. Next you choose a password and set up an authenticator app on their phone.</p>
    <form id="f">
      <div class="field"><label for="name">Full name</label><input id="name" autocomplete="name" autofocus></div>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email"></div>
      ${needCode ? `<div class="field"><label for="tok">Setup code</label><input id="tok" autocomplete="off" spellcheck="false" value="${esc(code)}"><span class="help">It is in the link printed in the server window when the app started. A new code is made every time the app starts.</span></div>` : ''}
      <button type="submit" id="go">Continue</button><div class="err" id="err"></div>
    </form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('err'); err.textContent = '';
    const go = document.getElementById('go'); go.disabled = true;
    try {
      const r = await postJson('/api/setup/create', {
        name: document.getElementById('name').value, email: document.getElementById('email').value,
        token: needCode ? document.getElementById('tok').value.trim() : undefined,
      });
      if (r.ok) { location.href = r.invite; return; }
      err.textContent = r.error || 'Could not make the account';
    } catch { err.textContent = 'Could not reach the server'; }
    go.disabled = false;
  };
}
