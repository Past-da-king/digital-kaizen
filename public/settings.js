// Settings: the escalation ladder (people, roles, levels, timings), the
// limits that start it, the mail account, the downtime reasons and defect
// types, the moulds, and the names operators pick on the QR page.

import { mountHeader, api, postJson, $, $$, esc, toast } from './ui.js';

await mountHeader({ active: '/settings.html', clock: false });
let S = null, guess = '', resendStatus = { keySet: false, from: '' };
let people = [];

async function load() {
  const r = await api('/api/settings');
  S = r.settings; guess = r.baseUrlGuess; resendStatus = r.resend;
  people = (await api('/api/users')).users.filter(u => u.role === 'operator');
  draw();
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function draw() {
  $('#sets').innerHTML = `
  <section class="card"><div class="card-h"><h2>Escalation ladder</h2><div class="spacer"></div>
      <label class="chip" style="cursor:pointer"><input type="checkbox" id="escOn" ${S.escalationEnabled ? 'checked' : ''}> Escalation emails on</label></div>
    <div class="bd">
      <p class="note" style="margin:0 0 14px">When an issue opens (a machine down past the limit or too many defects in a shift) the people at each level are emailed at the time set for that level, until someone acknowledges. The five rows below are only a starting example: change, add or remove anything.</p>
      <div id="levels" class="ladder">${S.ladder.map(levelHtml).join('')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px"><button class="ghost" id="addLevel">Add a level</button>
        <span class="field" style="flex-direction:row;align-items:center;gap:8px"><button class="ghost" id="spread">Space levels every</button><input type="number" id="every" value="30" min="1" style="width:84px;height:40px"><span class="part">minutes</span></span></div>
    </div></section>

  <section class="card"><div class="card-h"><h2>When it counts as an issue</h2></div><div class="bd">
    <div class="field" style="margin-bottom:14px"><label>Machine down for at least (minutes)</label><input type="number" id="dtMin" min="1" value="${S.thresholds.downtimeMin}"><span class="help">Counted from when the sensor last saw a shot.</span></div>
    <div class="field"><label>Defects in one shift, one machine, over (number)</label><input type="number" id="dfMax" min="1" value="${S.thresholds.defectsPerShift}"><span class="help">Raised once per machine per shift.</span></div>
  </div></section>

  <section class="card"><div class="card-h"><h2>Email</h2></div><div class="bd">
    <p class="note">${resendStatus.keySet ? 'Sending with Resend, key set in .env' : 'No Resend key in .env. Existing SMTP settings will be used.'}</p>
    <p class="note">From address in .env: ${esc(resendStatus.from || 'not set')}</p>
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"><input id="testTo" type="email" placeholder="send a test to this address" style="flex:1;min-width:200px"><button class="ghost" id="testBtn">Save and send test</button></div>
    <div id="testOut" class="note" style="margin-top:8px"></div>
  </div></section>

  <section class="card"><div class="card-h"><h2>Downtime reasons</h2></div><div class="bd">
    <p class="note" style="margin:0 0 12px">These are the buttons on the QR page. Tick <b>planned</b> for stops the factory chose (they are left out of Availability).</p>
    <div id="reasons">${S.downtimeReasons.map((r, i) => `<div class="rowline" data-r="${i}"><input value="${esc(r.label)}"><label class="chip" style="cursor:pointer"><input type="checkbox" ${r.planned ? 'checked' : ''}> planned</label><button class="ghost sm" data-del="reasons:${i}">Remove</button></div>`).join('')}</div>
    <button class="ghost sm" id="addReason">Add a reason</button></div></section>

  <section class="card"><div class="card-h"><h2>Defect types</h2></div><div class="bd">
    <div id="dtypes">${S.defectTypes.map((t, i) => `<div class="rowline" data-t="${i}" style="grid-template-columns:1fr auto"><input value="${esc(t)}"><button class="ghost sm" data-del="dtypes:${i}">Remove</button></div>`).join('')}</div>
    <button class="ghost sm" id="addType">Add a type</button></div></section>

  <section class="card"><div class="card-h"><h2>Moulds and ideal cycle time</h2></div><div class="bd">
    <p class="note" style="margin:0 0 12px">Performance in OEE is measured against the <b>ideal cycle</b> of the mould that is running. Set the one in use as active.</p>
    ${Object.entries(S.machines).map(([id, spec]) => `<div style="margin-bottom:16px" data-mach="${id}"><div class="sect">${id}</div>
      ${spec.moulds.map((m, i) => `<div class="mouldrow" data-mould="${i}"><label class="chip" style="cursor:pointer"><input type="radio" name="act-${id}" ${spec.activeMould === i ? 'checked' : ''}> active</label>
        <input value="${esc(m.name)}" placeholder="mould name"><input type="number" step="0.1" value="${m.idealCycleSec}" title="ideal cycle seconds"><input type="number" value="${m.cavities}" title="cavities"><button class="ghost sm" data-delmould="${id}:${i}">Remove</button></div>`).join('')}
      <div class="part" style="margin:0 0 6px">name, ideal cycle (s), cavities</div><button class="ghost sm" data-addmould="${id}">Add a mould</button></div>`).join('')}
  </div></section>

  <section class="card"><div class="card-h"><h2>Operators on the QR page</h2></div><div class="bd">
    <p class="note" style="margin:0 0 12px">People pick their name when they log. Their name is shown on every entry. A PIN per name is optional and off unless you tick the box below.</p>
    <div id="ops">${people.map(p => `<div class="rowline" style="grid-template-columns:1fr auto auto auto"><span style="font-weight:600;${p.status === 'disabled' ? 'opacity:.45;text-decoration:line-through' : ''}">${esc(p.name)}</span>
      <span class="chip">${p.hasPin ? 'PIN set' : 'no PIN'}</span><button class="ghost sm" data-pin="${p.id}">${p.hasPin ? 'Change PIN' : 'Set PIN'}</button>
      <button class="ghost sm" data-opt="${p.id}:${p.status === 'disabled' ? 'active' : 'disabled'}">${p.status === 'disabled' ? 'Bring back' : 'Remove'}</button></div>`).join('') || '<div class="empty" style="padding:14px 0">No names yet. Add the first one.</div>'}</div>
    <div style="display:flex;gap:10px;margin-top:10px"><input id="opName" placeholder="Name, e.g. Thandi Mokoena"><button id="opAdd">Add</button></div>
    <label class="chip" style="cursor:pointer;margin-top:14px"><input type="checkbox" id="pinReq" ${S.operatorPinRequired ? 'checked' : ''}> Names that have a PIN must enter it</label>
  </div></section>

  <section class="card"><div class="card-h"><h2>Dashboard address</h2></div><div class="bd">
    <div class="field"><label>How phones and email links reach this PC</label><input id="baseUrl" placeholder="${esc(guess)}" value="${esc(S.baseUrl)}"><span class="help">Leave blank to use ${esc(guess)}. It goes in the QR codes and in the acknowledge link in every email.</span></div>
  </div></section>

  <div class="card sticky-save"><div class="form-actions"><button id="save">Save settings</button><span id="saved" class="part"></span></div></div>`;
  const names = ['Escalation ladder', 'Limits', 'Email', 'Downtime reasons', 'Defect types', 'Moulds', 'Operators', 'Address'];
  $$('#sets > section').forEach((sec, i) => { sec.id = 'sec' + i; });
  $('#setnav').innerHTML = names.map((n, i) => `<a href="#sec${i}" class="${i === 0 ? 'on' : ''}">${n}</a>`).join('');
}

function levelHtml(st, i, all) {
  return `<div class="lv" data-l="${i}"><span class="dot">${st.level}</span><div class="box"><div class="hd"><span>Told after</span><input type="number" min="0" value="${st.afterMin}" class="lmin"><span>minutes</span><div class="spacer"></div>
      <button class="ghost sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>Up</button><button class="ghost sm" data-down="${i}" ${i === all.length - 1 ? 'disabled' : ''}>Down</button>
      <button class="ghost sm" data-dellevel="${i}">Remove level</button></div>
    ${st.people.map((p, j) => `<div class="pp ${p.enabled ? '' : 'off'}" data-p="${j}"><input class="pn" placeholder="Name" value="${esc(p.name)}"><input class="pr" placeholder="Role, e.g. Supervisor" value="${esc(p.role)}"><input class="pe" type="email" placeholder="email address" value="${esc(p.email)}">
      <label class="chip" style="cursor:pointer"><input type="checkbox" class="pon" ${p.enabled ? 'checked' : ''}> on</label><button class="ghost sm" data-delp="${i}:${j}">Remove</button></div>`).join('')}
    <div style="padding:10px 16px"><button class="ghost sm" data-addp="${i}">Add a person to level ${st.level}</button></div></div></div>`;
}

// read the form back into plain data
function readLadder() {
  return $$('#levels .lv').map(l => ({
    afterMin: num($('.lmin', l).value),
    people: $$('.pp', l).map(p => ({ name: $('.pn', p).value, role: $('.pr', p).value, email: $('.pe', p).value, enabled: $('.pon', p).checked })),
  }));
}
function readAll() {
  return {
    escalationEnabled: $('#escOn').checked,
    ladder: readLadder(),
    thresholds: { downtimeMin: num($('#dtMin').value), defectsPerShift: num($('#dfMax').value) },
    downtimeReasons: $$('#reasons .rowline').map(r => ({ label: $('input', r).value, planned: $('input[type=checkbox]', r).checked })),
    defectTypes: $$('#dtypes .rowline').map(r => $('input', r).value),
    machines: Object.fromEntries($$('[data-mach]').map(m => [m.dataset.mach, {
      activeMould: Math.max(0, $$('[data-mould]', m).findIndex(x => $('input[type=radio]', x).checked)),
      moulds: $$('[data-mould]', m).map(x => { const i = $$('input', x); return { name: i[1].value, idealCycleSec: num(i[2].value), cavities: num(i[3].value) }; }),
    }])),
    operatorPinRequired: $('#pinReq').checked,
    baseUrl: $('#baseUrl').value,
  };
}

function keep() { Object.assign(S, readAll()); }

async function save(extra = {}) {
  const body = readAll();
  const r = await postJson('/api/settings', body);
  $('#errs').innerHTML = r.ok ? '' : `<div class="banner-err"><b>Not saved.</b><br>${r.errors.map(esc).join('<br>')}</div>`;
  if (r.ok) { S = r.settings; toast('Settings saved'); draw(); } else window.scrollTo(0, 0);
  return r.ok;
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (t.id === 'save') return save();
  const edit = (fn) => { keep(); fn(); S.ladder.forEach((l, i) => { l.level = i + 1; }); draw(); };
  if (t.id === 'addLevel') return edit(() => { const last = S.ladder[S.ladder.length - 1]; S.ladder.push({ level: S.ladder.length + 1, afterMin: (last?.afterMin ?? 0) + 30, people: [{ name: '', role: '', email: '', enabled: true }] }); });
  if (t.id === 'spread') return edit(() => { const n = num($('#every').value, 30); S.ladder.forEach((l, i) => { l.afterMin = i * n; }); });
  if (d.up !== undefined) return edit(() => { const i = +d.up; [S.ladder[i - 1], S.ladder[i]] = [S.ladder[i], S.ladder[i - 1]]; });
  if (d.down !== undefined) return edit(() => { const i = +d.down; [S.ladder[i + 1], S.ladder[i]] = [S.ladder[i], S.ladder[i + 1]]; });
  if (d.dellevel !== undefined) return edit(() => { S.ladder.splice(+d.dellevel, 1); });
  if (d.addp !== undefined) return edit(() => { S.ladder[+d.addp].people.push({ name: '', role: '', email: '', enabled: true }); });
  if (d.delp) return edit(() => { const [i, j] = d.delp.split(':').map(Number); S.ladder[i].people.splice(j, 1); });
  if (t.id === 'addReason') return edit(() => { S.downtimeReasons.push({ label: '', planned: false }); });
  if (t.id === 'addType') return edit(() => { S.defectTypes.push(''); });
  if (d.del) return edit(() => { const [k, i] = d.del.split(':'); (k === 'reasons' ? S.downtimeReasons : S.defectTypes).splice(+i, 1); });
  if (d.addmould) return edit(() => { S.machines[d.addmould].moulds.push({ name: 'New mould', idealCycleSec: 30, cavities: 1 }); });
  if (d.delmould) return edit(() => { const [m, i] = d.delmould.split(':'); const s = S.machines[m]; if (s.moulds.length > 1) { s.moulds.splice(+i, 1); s.activeMould = Math.min(s.activeMould, s.moulds.length - 1); } });
  if (t.id === 'testBtn') {
    const to = $('#testTo').value.trim();
    if (!(await save())) return;
    const r = await postJson('/api/mail/test', { to });
    $('#testOut').innerHTML = r.ok ? `<span style="color:var(--run)"><b>Sent.</b> Check ${esc(to)}.</span>` : `<span style="color:var(--down)"><b>Not sent.</b> ${esc(r.error || '')}</span>`;
    return;
  }
  if (t.id === 'opAdd') {
    const name = $('#opName').value.trim(); if (!name) return;
    const r = await postJson('/api/users', { name, role: 'operator' });
    if (!r.ok) return toast(r.error); return load();
  }
  if (d.pin) {
    const pin = prompt('New PIN (4 to 8 digits). Leave empty to remove the PIN.');
    if (pin === null) return;
    const r = await postJson('/api/users/pin', { id: Number(d.pin), pin });
    if (!r.ok) toast(r.error); return load();
  }
  if (d.opt) { const [id, status] = d.opt.split(':'); const r = await postJson('/api/users/update', { id: Number(id), status }); if (!r.ok) toast(r.error); return load(); }
});

await load();
