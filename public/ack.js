// The page behind the "Acknowledge" button in an escalation email. A GET never
// acknowledges anything (mail scanners open links); the person presses the button.
import { api, postJson, esc, mins } from './ui.js';

const box = document.getElementById('box');
const t = new URLSearchParams(location.search).get('t') || '';
const brand = '<div class="brand"><span class="mark">K</span><span>Digital Kaizen<small>Escalation</small></span></div>';
const r = await api(`/api/ack/info?t=${encodeURIComponent(t)}`);

function show(i, note) {
  const st = i.state;
  box.innerHTML = `${brand}<h1>${esc(i.machine_name)}</h1><p style="margin-bottom:8px"><b style="color:var(--ink)">${esc(i.summary)}</b></p>
    <p>Opened ${esc(i.opened_at.slice(5, 16))} (${mins(i.age_min)} ago). ${i.level_reached ? `Told up to level ${i.level_reached}.` : ''}</p>
    ${st === 'OPEN' ? `<div class="field"><label>Your name (optional)</label><input id="who" placeholder="So the team knows who has it"></div><button id="ack">Acknowledge, stop escalation</button>`
      : `<div class="banner-warn" style="margin:0">${st === 'ACKED' ? `Acknowledged${i.acked_by ? ' by ' + esc(i.acked_by) : ''}. Escalation has stopped.` : 'This issue is resolved. Nothing to do.'}</div>`}
    ${note ? `<p style="margin-top:12px;color:var(--run)">${esc(note)}</p>` : ''}<div class="err" id="err"></div>`;
  document.getElementById('ack')?.addEventListener('click', async () => {
    const a = await postJson('/api/ack', { t, name: document.getElementById('who').value });
    if (a.ok) show(a.issue, 'Thank you. Nobody else will be emailed.'); else document.getElementById('err').textContent = a.error;
  });
}
if (!r.ok) box.innerHTML = `${brand}<h1>Link not valid</h1><p>${esc(r.error || '')}</p>`; else show(r.issue);
