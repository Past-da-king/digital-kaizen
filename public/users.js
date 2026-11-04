import { mountHeader, api, postJson, $, esc, toast } from './ui.js';

const me = await mountHeader({ active: '/users.html', clock: false });

function showLink(title, link, emailed) {
  $('#linkBox').innerHTML = `<div class="banner-warn"><b>${esc(title)}</b><br>Give this link to the person. It works once and expires in 72 hours.${emailed ? ' It was also emailed.' : ''}
    <div style="display:flex;gap:8px;margin-top:10px"><input id="lk" readonly value="${esc(link)}"><button class="ghost" id="cp">Copy</button></div></div>`;
  $('#cp').onclick = async () => { $('#lk').select(); try { await navigator.clipboard.writeText(link); } catch { document.execCommand('copy'); } toast('Copied'); };
}

async function load() {
  const [u, l] = await Promise.all([api('/api/users'), api('/api/auth-log')]);
  const staff = u.users.filter(x => x.role !== 'operator');
  $('#rows').innerHTML = staff.map(x => `<tr><td><b>${esc(x.name)}</b><div class="part">${esc(x.email)}</div></td>
    <td><select data-role="${x.id}" style="height:36px;min-width:110px">${['viewer', 'manager', 'admin'].map(r => `<option ${x.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
    <td>${x.status === 'invited' ? '<span class="tag queued">waiting for setup</span>' : x.status === 'disabled' ? '<span class="tag failed">disabled</span>' : '<span class="tag sent">active</span>'}${x.locked ? ' <span class="tag failed">locked</span>' : ''}<div class="part">${x.twoFactor ? '2-step on' : ''}${x.lastLogin ? ' &middot; last ' + esc(x.lastLogin.slice(5, 16)) : ''}</div></td>
    <td style="white-space:nowrap">${x.locked ? `<button class="ghost sm" data-unlock="${x.id}">Unlock</button> ` : ''}<button class="ghost sm" data-reset="${x.id}" title="New link: forgotten password or lost phone">Reset</button>
      <button class="ghost sm" data-tog="${x.id}:${x.status === 'disabled' ? 'active' : 'disabled'}">${x.status === 'disabled' ? 'Enable' : 'Disable'}</button></td></tr>`).join('');
  $('#log').innerHTML = l.log.map(e => `<tr><td>${esc(e.at.slice(5, 19))}</td><td>${esc(e.event)}</td><td>${esc(e.who || '')}</td><td>${esc(e.ip || '')}</td></tr>`).join('');
}

$('#add').onclick = async () => {
  $('#err').textContent = '';
  const r = await postJson('/api/users', { name: $('#nm').value, email: $('#em').value, role: $('#rl').value, emailInvite: $('#mailIt').checked });
  if (!r.ok) { $('#err').textContent = r.error; return; }
  showLink(`Account created for ${r.user.name}`, r.inviteLink, r.emailed);
  $('#nm').value = ''; $('#em').value = ''; load();
};

document.addEventListener('change', async (e) => {
  if (e.target.dataset.role) { const r = await postJson('/api/users/update', { id: Number(e.target.dataset.role), role: e.target.value }); if (!r.ok) toast(r.error); load(); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.reset) { if (!confirm('This signs them out and their old password and authenticator stop working. Make a new setup link?')) return; const r = await postJson('/api/users/reset', { id: Number(d.reset) }); if (r.ok) showLink('New setup link', r.inviteLink); else toast(r.error); load(); }
  if (d.tog) { const [id, status] = d.tog.split(':'); const r = await postJson('/api/users/update', { id: Number(id), status }); if (!r.ok) toast(r.error); load(); }
  if (d.unlock) { await postJson('/api/users/unlock', { id: Number(d.unlock) }); load(); }
});
await load();
