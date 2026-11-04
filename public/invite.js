// One-time link: choose a password, add the account to an authenticator app,
// prove it with the first code, and keep the recovery codes.
import { api, postJson, esc } from './ui.js';

const box = document.getElementById('box');
const t = new URLSearchParams(location.search).get('t') || '';
const brand = '<div class="brand"><span class="mark">K</span><span>Digital Kaizen<small>Set up your account</small></span></div>';
const info = await api(`/api/invite/info?t=${encodeURIComponent(t)}`);

if (!info.ok) {
  box.innerHTML = `${brand}<h1>Link not valid</h1><p>${esc(info.error)}</p>`;
} else step1();

function step1() {
  box.innerHTML = `${brand}<h1>Welcome, ${esc(info.name)}</h1><p>Choose a password for <b>${esc(info.email)}</b>. At least 10 characters; a few words together is best.</p>
    <form id="f"><div class="field"><label>Password</label><input id="pw" type="password" autocomplete="new-password" autofocus></div>
    <div class="field"><label>Repeat it</label><input id="pw2" type="password" autocomplete="new-password"></div>
    <button type="submit">Next</button><div class="err" id="err"></div></form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    if (document.getElementById('pw').value !== document.getElementById('pw2').value) { err.textContent = 'The two passwords are not the same.'; return; }
    const r = await postJson('/api/invite/start', { t, password: document.getElementById('pw').value });
    if (!r.ok) { err.textContent = r.error; return; }
    step2(r);
  };
}

function step2(r) {
  box.innerHTML = `${brand}<h1>Two-step sign-in</h1><p>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy), add an account by scanning this code, then type the 6 digits it shows.</p>
    <div style="text-align:center"><img src="${r.qr}" width="220" height="220" alt="QR code for the authenticator app" style="border-radius:12px;background:#fff"></div>
    <p style="font-size:13px;margin-top:10px">Cannot scan? Type this key in: <b style="font-family:var(--mono);word-break:break-all">${esc(r.secret)}</b></p>
    <form id="f"><div class="field"><label>6-digit code</label><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" autofocus></div>
    <button type="submit">Check and finish</button><div class="err" id="err"></div></form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const f = await postJson('/api/invite/finish', { t, code: document.getElementById('code').value });
    if (!f.ok) { document.getElementById('err').textContent = f.error; return; }
    step3(f.recoveryCodes);
  };
}

function step3(codes) {
  box.innerHTML = `${brand}<h1>Save your recovery codes</h1><p>If you lose your phone, each code signs you in once. They are shown <b>only now</b>. Write them down or print this page and keep them somewhere safe.</p>
    <div class="codes">${codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>
    <button id="print" class="ghost" style="margin-bottom:10px">Print</button><button id="done">I have saved them, open the dashboard</button>`;
  document.getElementById('print').onclick = () => window.print();
  document.getElementById('done').onclick = () => { location.href = '/'; };
}
