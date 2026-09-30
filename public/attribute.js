// The page an operator lands on after scanning the QR code stuck to
// the machine. It has one job: link a human reason to the downtime
// event the sensor already opened. Built thumb-first — big targets,
// no typing required, works on a cracked factory phone.

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const machineId = params.get('m') || 'MA1';
// The key printed into the QR code. It is what lets a person on the
// floor answer without ever seeing a login screen.
const machineKey = params.get('k') || '';
let chosen = null, data = null, tick = null;

async function load() {
  const res = await fetch(`/api/events/open?machine=${encodeURIComponent(machineId)}&k=${encodeURIComponent(machineKey)}`);
  if (res.status === 403) {
    app.textContent = '';
    const el = document.createElement('p');
    el.className = 'hint';
    el.textContent = 'This link is not valid for that machine. Scan the code on the machine itself.';
    app.appendChild(el);
    return;
  }
  data = await res.json();
  render();
}

function render() {
  if (!data.machine) {
    // textContent, never innerHTML — machineId comes straight off the
    // URL and ?m=<img src=x onerror=...> would otherwise execute.
    app.textContent = '';
    const el = document.createElement('p');
    el.className = 'hint';
    el.textContent = `Unknown machine "${machineId}". Check the QR label.`;
    app.appendChild(el);
    return;
  }

  const ev = data.event;
  const pending = ev || data.recent?.[0] || null;

  if (!pending) {
    // NO SENSOR is not the same as RUNNING. Saying "running" when
    // nothing is reporting is a lie the operator will catch instantly,
    // and once they catch it they stop trusting the whole thing.
    const offline = data.live?.offline !== false;
    app.innerHTML = offline
      ? `
      <div class="machine"><h1>${data.machine.name}</h1><div class="p">${data.machine.part || ''}</div></div>
      <div class="timer off"><div class="k">Machine status</div><div class="t">No sensor</div>
        <div class="s">Nothing is reporting from this machine.</div></div>
      <p class="hint">There is no sensor sending readings for
      <b>${data.machine.name}</b> right now, so we cannot tell whether it is running or stopped,
      and there is nothing to attribute.<br><br>
      If a sensor has just been fitted, it needs pairing to this machine on the dashboard.</p>`
      : `
      <div class="machine"><h1>${data.machine.name}</h1><div class="p">${data.machine.part || ''}</div></div>
      <div class="timer ok"><div class="k">Machine status</div><div class="t">Running</div>
        <div class="s">Nothing to attribute right now.</div></div>
      <p class="hint">Scan this code again when the machine stops and it will
      ask you why. You can also attribute a stop you missed, it stays here until someone answers it.</p>`;
    return;
  }

  const live = Boolean(ev);
  app.innerHTML = `
    <div class="machine"><h1>${data.machine.name}</h1><div class="p">${data.machine.part || ''}</div></div>
    <div class="timer">
      <div class="k">${live ? 'Stopped for' : 'Stopped for'}</div>
      <div class="t" id="t">${live ? pending.elapsed_human : pending.duration_human}</div>
      <div class="s">Event #${pending.id} · started ${(pending.started_at || '').slice(11, 19)}${live ? '' : ' · already restarted'}</div>
    </div>
    <p class="q">Why did the machine stop?</p>
    <div class="reasons">${data.reasons.map(r =>
      `<button class="reason" data-c="${r.code}"><span class="i">${r.icon}</span>${r.label}</button>`).join('')}</div>
    <textarea id="note" placeholder="Anything else worth knowing? (optional)"></textarea>
    <button class="submit" id="go" disabled>Submit</button>
    <p class="hint">This links your answer to what the sensor recorded, so the
    downtime report says <b>why</b> and not just <b>how long</b>.</p>`;

  app.querySelectorAll('.reason').forEach(b => b.onclick = () => {
    app.querySelectorAll('.reason').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    chosen = b.dataset.c;
    document.getElementById('go').disabled = false;
  });

  document.getElementById('go').onclick = async () => {
    const btn = document.getElementById('go');
    btn.disabled = true; btn.textContent = 'Sending…';

    let r;
    try {
      const res = await fetch('/api/attribute', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: pending.id, code: chosen,
          note: document.getElementById('note').value,
          machine: machineId, key: machineKey,
        }),
      });
      r = await res.json();
    } catch {
      // Factory wifi dropped mid-submit. Say so and let them retry
      // instead of leaving the button disabled reading "Sending…".
      btn.disabled = false;
      btn.textContent = 'Try again, no connection';
      return;
    }

    // Only claim it landed if the server says it did.
    if (!r?.ok) {
      btn.disabled = false;
      btn.textContent = 'Could not save, try again';
      const p = document.createElement('p');
      p.className = 'hint';
      p.style.color = '#ffb020';
      p.textContent = r?.error || 'The server rejected it.';
      btn.after(p);
      return;
    }

    clearInterval(tick);
    app.innerHTML = `<div class="done"><div class="tick">✅</div>
      <h2>Logged</h2>
      <p><b>${r.reason}</b><br>${data.machine.name} · event #${pending.id}</p>
      <p style="margin-top:16px">It is on the downtime report now, and the recovery
      message will carry the reason when the machine restarts.</p></div>`;
  };

  clearInterval(tick);
  if (live) {
    let secs = pending.elapsed_seconds;
    tick = setInterval(() => {
      secs++;
      const el = document.getElementById('t');
      if (el) el.textContent = human(secs);
    }, 1000);
  }
}

function human(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

await load();
setInterval(() => { if (!chosen) load(); }, 15000);
