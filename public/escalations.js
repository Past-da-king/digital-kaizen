import { mountHeader, api, postJson, $, esc, hm, mins, toast } from './ui.js';

const me = await mountHeader({ active: '/escalations.html', clock: false });
const canAct = !me || me.role === 'admin' || me.role === 'manager';
const cfg = await api('/api/config');
const levels = cfg.ladder.length;

async function load() {
  const [iss, mail, ev] = await Promise.all([api('/api/issues?limit=40'), api('/api/mail?limit=80'), api('/api/events?limit=40')]);
  const st = mail.status, c = st.counts;
  $('#mailbar').innerHTML = !st.configured
    ? `<div class="banner-warn"><b>Email is not set up.</b> Escalation messages are being written to the queue and will go out as soon as a mail account is added in <a href="/settings.html">Settings</a>. ${c.queued} waiting.</div>`
    : `<div class="chips" style="margin:0 0 18px"><span class="chip">Mail server <b>${esc(st.host)}</b></span><span class="chip"><b>${c.sent}</b> sent</span><span class="chip ${c.queued ? 'on' : ''}"><b>${c.queued}</b> waiting</span><span class="chip" style="${c.failed ? 'color:var(--down)' : ''}"><b>${c.failed}</b> failed</span>
       ${st.lastOkAt ? `<span class="chip">Last sent <b>${esc(st.lastOkAt.slice(5, 16))}</b></span>` : ''}${st.lastError ? `<span class="chip" style="color:var(--idle)">Last problem: ${esc(st.lastError)}</span>` : ''}</div>`;

  $('#issues').innerHTML = iss.issues.map(i => {
    const state = i.state;
    return `<div class="issue" style="grid-template-columns:auto 1fr auto"><span class="ladder-dots" title="Level ${i.level_reached} of ${levels}">${Array.from({ length: levels }, (_, k) => `<i class="${state === 'RESOLVED' ? 'done' : k < i.level_reached ? 'on' : ''}"></i>`).join('')}</span>
      <div><div class="t">${esc(i.machine_name)}: ${esc(i.summary)}</div>
      <div class="s">opened ${esc(i.opened_at.slice(5, 16))} &middot; ${mins(i.age_min)} &middot; raised by ${esc(i.raised_by || 'sensor')} &middot; ${i.level_reached ? `Level ${i.level_reached} told` : 'nobody told yet'}
        ${i.mail.queued ? ` &middot; <span class="un">${i.mail.queued} email waiting</span>` : ''}${i.mail.failed ? ' &middot; <span style="color:var(--down)">' + i.mail.failed + ' failed</span>' : ''}
        ${i.acked_by ? ` &middot; acknowledged by ${esc(i.acked_by)} ${esc((i.acked_at || '').slice(11, 16))}` : ''}</div>${i.detail && i.kind === 'manual' ? `<div class="s">${esc(i.detail)}</div>` : ''}</div>
      <div style="display:flex;gap:8px;align-items:center"><span class="tag ${state}">${state}</span>
        ${canAct && state === 'OPEN' ? `<button class="sm" data-ack="${i.id}">Acknowledge</button>` : ''}${canAct && state !== 'RESOLVED' ? `<button class="ghost sm" data-res="${i.id}">Resolve</button>` : ''}</div></div>`;
  }).join('') || '<div class="empty">No issues yet. All clear.</div>';

  $('#mail').innerHTML = mail.mail.map(m => `<tr title="${esc(m.last_error || m.subject)}"><td>${esc(m.created_at.slice(5, 16))}</td><td>${m.level ? 'L' + m.level : m.kind}</td><td>${esc(m.to_addr)}</td>
    <td><span class="tag ${m.status}">${m.status}</span>${m.status === 'queued' && m.attempts ? ` <span class="part">try ${m.attempts + 1} at ${esc(m.next_attempt_at.slice(11, 16))}</span>` : ''}${m.status === 'failed' && canAct ? ` <button class="ghost sm" data-retry="${m.id}">Retry</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="4" class="empty">No emails yet</td></tr>';

  $('#events').innerHTML = ev.events.map(e => `<tr><td>${e.id}</td><td>${esc(e.machine_id)}</td><td>${esc(e.started_at.slice(5, 19))}</td><td>${e.duration_human || '<span class="un">running…</span>'}</td>
    <td>${e.reason_label ? esc(e.reason_label) : '<span class="un">not explained</span>'}</td><td>${esc(e.attributed_by || '')}</td><td>${e.lost_units != null ? e.lost_units.toLocaleString() : '—'}</td><td><span class="tag ${e.state}">${e.state}</span></td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">No downtime events yet</td></tr>';
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ack) { await postJson('/api/issues/ack', { id: Number(b.dataset.ack) }); toast('Acknowledged, escalation stopped'); }
  if (b.dataset.res) { await postJson('/api/issues/resolve', { id: Number(b.dataset.res) }); toast('Resolved'); }
  if (b.dataset.retry) { await postJson('/api/mail/retry', { id: Number(b.dataset.retry) }); toast('Queued to retry'); }
  if (b.id === 'retryAll') { const r = await postJson('/api/mail/retry', { all: true }); toast(`${r.requeued} queued to retry`); }
  load();
});

await load();
setInterval(() => load().catch(() => {}), 5000);
