import { mountHeader, api, postJson, $, esc } from './ui.js';

const me = await mountHeader({ active: '', clock: false });
const info = await api('/api/me');
if (!info.user) { $('#who').textContent = 'Accounts are not switched on yet.'; }
else {
  $('#who').textContent = `${info.user.name}, ${info.user.role}, ${info.user.email}`;
  $('#left').textContent = `You have ${info.recoveryLeft} recovery code${info.recoveryLeft === 1 ? '' : 's'} left. Making new ones cancels the old ones.`;
}
$('#chg').onclick = async () => {
  const r = await postJson('/api/auth/password', { current: $('#cur').value, next: $('#nw').value, code: $('#c1').value });
  $('#o1').innerHTML = r.ok ? '<span style="color:var(--run)">Password changed. Other devices were signed out.</span>' : `<span style="color:var(--down)">${esc(r.error)}</span>`;
};
$('#rc').onclick = async () => {
  const r = await postJson('/api/auth/recovery', { password: $('#p2').value, code: $('#c2').value });
  $('#o2').innerHTML = r.ok ? `<div class="codes">${r.recoveryCodes.map(c => `<span>${esc(c)}</span>`).join('')}</div><p class="note">Save these now. They are not shown again.</p>` : `<span style="color:var(--down)">${esc(r.error)}</span>`;
};
