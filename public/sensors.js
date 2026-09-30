// Pairing a physical sensor to a machine. The whole point of this page
// is that it replaces per-machine firmware: one file for every sensor,
// and the assignment lives here where it can be changed in a second.

const $ = (id) => document.getElementById(id);
let cfg = null;

async function load() {
  const d = await fetch('/api/devices').then(r => r.json());
  cfg = d;

  const fresh = d.unassigned.concat(
    d.known.filter(k => !d.unassigned.some(u => u.device_id === k.device_id))
      .map(k => ({ device_id: k.device_id, seen_at: k.last_seen, status: 'not heard from recently' }))
  );

  $('newCount').textContent = fresh.length ? `${fresh.length} waiting` : 'none';
  $('newList').innerHTML = fresh.length
    ? fresh.map(u => `
        <div class="slot new">
          <div class="who">
            <b class="mac">${u.device_id}</b>
            <span>${u.status || '—'}${u.distance_mm != null ? ` · reading ${u.distance_mm} mm` : ''}${u.device_ip ? ` · ${u.device_ip}` : ''}</span>
          </div>
          <select data-assign="${u.device_id}">
            <option value="">Which machine is this?</option>
            ${cfg.machines.map(m => `<option value="${m.id}">${m.id} — ${m.name}</option>`).join('')}
          </select>
        </div>`).join('')
    : `<div class="slot"><span class="none">No unpaired sensors. Power one up and it appears here within a few seconds.</span></div>`;

  $('machineList').innerHTML = cfg.machines.map(m => `
    <div class="slot">
      <div class="who">
        <b>${m.name}</b>
        <span>${m.part || ''} · ${m.id}</span>
      </div>
      ${m.device
        ? `<span class="mac"><span class="pulse"></span>${m.device}</span>
           <button class="ghost" data-release="${m.device}">Release</button>`
        : `<span class="none">no sensor paired</span>`}
    </div>`).join('');
}

document.addEventListener('change', async (e) => {
  const deviceId = e.target.dataset?.assign;
  if (!deviceId || !e.target.value) return;
  await assign(deviceId, e.target.value);
});

document.addEventListener('click', async (e) => {
  const deviceId = e.target.dataset?.release;
  if (!deviceId) return;
  if (!confirm(`Release ${deviceId}? Its machine will stop recording until another sensor is paired.`)) return;
  await assign(deviceId, null);
});

async function assign(deviceId, machineId) {
  const r = await fetch('/api/devices/assign', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, machineId }),
  }).then(r => r.json());
  if (!r.ok) alert(r.error || 'Could not save that');
  await load();
}

await load();
setInterval(load, 5000);
