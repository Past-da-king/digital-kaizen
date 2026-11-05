import { $, postJson, api } from './ui.js';

const st = await api('/api/auth/state');
if (!st.accounts && !st.legacy) location.href = st.needsSetup ? '/setup' : '/';
if (st.user) location.href = '/';
if (st.legacy) { $('#emailRow').classList.add('hidden'); $('#sub').textContent = 'Enter the dashboard password.'; $('#pw').focus(); }
let stage = 1;

$('#f').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('#err'); err.textContent = '';
  $('#go').disabled = true;
  try {
    if (st.legacy) {
      const r = await postJson('/api/login', { password: $('#pw').value });
      if (r.ok) location.href = '/'; else err.textContent = r.error || 'Wrong password';
    } else if (stage === 1) {
      const r = await postJson('/api/auth/login', { email: $('#email').value, password: $('#pw').value });
      if (r.ok) { stage = 2; $('#step1').classList.add('hidden'); $('#step2').classList.remove('hidden'); $('#title').textContent = 'Two-step check'; $('#sub').textContent = 'Open your authenticator app.'; $('#code').focus(); $('#go').textContent = 'Sign in'; }
      else err.textContent = r.error || 'Could not sign in';
    } else {
      const r = await postJson('/api/auth/2fa', { code: $('#code').value });
      if (r.ok) location.href = '/';
      else { err.textContent = r.error || 'That code is not right'; if (/timed out/.test(r.error || '')) setTimeout(() => location.reload(), 1500); }
    }
  } catch { err.textContent = 'Could not reach the server'; }
  $('#go').disabled = false;
};
