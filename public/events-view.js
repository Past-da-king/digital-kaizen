const cfg = await fetch('/api/config').then(r => r.json());

// Same URL-driven filter as the live floor, so a link to "MA1's
// downtime" is a link somebody can send.
const only = new URLSearchParams(location.search).get('m');
const scope = only ? `&machine=${encodeURIComponent(only)}` : '';

if (cfg.machines.length > 1) {
  document.getElementById('filter').innerHTML =
    `<span class="lbl">Show</span>` +
    `<a href="/events.html" class="${only ? '' : 'on'}">All machines</a>` +
    cfg.machines.map(m =>
      `<a href="/events.html?m=${m.id}" class="${only === m.id ? 'on' : ''}">${m.id}</a>`).join('');
} else {
  document.getElementById('filter').remove();
}

document.getElementById('ladder').innerHTML = cfg.escalation.map(r =>
  `<tr><td>${r.afterMin} min</td><td><span class="lvl ${r.level}">${r.level}</span></td>
       <td>${r.to}</td><td>${r.channel}</td></tr>`).join('');

const ch = cfg.alerts;
document.getElementById('chan').innerHTML = `
  <div class="chip ${ch.email ? '' : 'off'}">Email (SMTP) — <b>${ch.email ? 'connected' : 'not configured'}</b></div>
  <div class="chip ${ch.webhook ? '' : 'off'}">Webhook fallback — <b>${ch.webhook ? 'connected' : 'not configured'}</b></div>
  ${ch.any ? '' : '<div class="chip off">Alerts are being <b>recorded and shown</b> but not delivered — nothing is configured yet.</div>'}
  ${cfg.alertScale > 1 ? `<div class="chip">Demo mode — escalation running <b>${cfg.alertScale}× faster</b></div>` : ''}`;

async function load() {
  const [ev, al] = await Promise.all([
    fetch(`/api/events?limit=60${scope}`).then(r => r.json()),
    fetch(`/api/alerts?limit=60${scope}`).then(r => r.json()),
  ]);

  document.getElementById('evCount').textContent =
    `${ev.events.length} shown${only ? ` \u00b7 ${only} only` : ''}`;
  document.getElementById('events').innerHTML = ev.events.map(e => `
    <tr>
      <td>${e.id}</td>
      <td>${e.machine_id}</td>
      <td>${e.started_at.slice(5, 19)}</td>
      <td>${e.duration_human || '<span class="un">running…</span>'}</td>
      <td>${e.reason_label ? e.reason_label : '<span class="un">not attributed</span>'}</td>
      <td>${e.lost_units != null ? `${e.lost_units.toLocaleString()} units` : '—'}</td>
      <td><span class="lvl ${e.state}">${e.state}</span></td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty">no downtime events yet</td></tr>`;

  document.getElementById('alCount').textContent = `${al.alerts.length} shown`;
  document.getElementById('alerts').innerHTML = al.alerts.map(a => `
    <tr title="${a.message.replace(/"/g, '&quot;')}">
      <td>${a.at.slice(11, 19)}</td>
      <td><span class="lvl ${a.level}">${a.level}</span></td>
      <td>${a.recipient}</td>
      <td>${a.channel}</td>
      <td>${a.delivered ? '✅ sent' : `<span class="un">recorded only</span>`}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">no alerts fired yet</td></tr>`;
}

await load();
setInterval(load, 5000);
