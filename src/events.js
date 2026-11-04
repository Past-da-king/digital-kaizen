// ============================================================
// The downtime engine — the part that turns "the machine isn't
// moving" into something a factory can actually act on.
//
// Three levels, deliberately:
//   MICRO-STOP   recorded, never called downtime. A machine that
//                pauses 40 seconds twenty times a shift is a Kaizen
//                problem, but calling each one "downtime" produces
//                garbage data.
//   DOWNTIME     a formal event with an id, a clock, and a person
//                who has to say why.
//   CRITICAL     the same event, escalated.
//
// Every threshold is per machine, because "stopped" means something
// different on a 19-second cycle than on a 28-second one.
//
// Alerts climb a ladder and fire ONCE per rung per event. A machine
// down for an hour produces five messages, not a hundred and twenty.
// ============================================================

import { DOWNTIME_RULES, MACHINES } from './config.js';
import * as db from './db.js';
import * as settings from './settings.js';
import * as store from './store.js';
import { tick as escalationTick } from './escalation.js';

// Demo aid only: makes the 30-minute escalation ladder play out in
// about a minute so the whole thing can be shown in a meeting.
const ALERT_SCALE = Number(process.env.DK_ALERT_SCALE || 1);

const state = new Map();   // machine_id -> { lastShots, lastShotAt, stopSince, eventId, fired:Set }

for (const m of MACHINES) {
  state.set(m.id, { lastShots: null, lastShotAt: Date.now(), stopSince: null, eventId: null, fired: new Set() });
}

let broadcast = () => {};
export function onEvent(fn) { broadcast = fn; }

export function rulesFor(id) {
  return DOWNTIME_RULES[id] || { expectedCycleSec: 30, microStopSec: 60, downtimeSec: 120, criticalSec: 600 };
}

// In demo mode every clock is divided by the same factor, so a
// 30-minute escalation ladder plays out in about 90 seconds and the
// rungs still fire in the right order and spacing. The dashboard
// always shows the REAL configured thresholds, never these.
// The longest gap this machine can legitimately produce while still
// running: a jittered cycle plus its worst cooling overrun. Anything
// at or below this is NOT downtime, however fast the demo is running.
function worstHonestCycleSec(id) {
  const m = MACHINES.find(x => x.id === id);
  const r = rulesFor(id);
  if (!m) return r.expectedCycleSec * 2;
  const jittered = m.cycleSec * (1 + (m.cycleJitterPct || 0));
  const overrun = Array.isArray(m.slowCycleExtraSec) ? m.slowCycleExtraSec[1] : 0;
  return jittered + overrun;
}

function effective(id) {
  const r = rulesFor(id);
  if (ALERT_SCALE <= 1) return r;
  // Floor every scaled threshold above the machine's own worst HONEST
  // cycle. The previous floor (expectedCycleSec * 1.6) sat BELOW the
  // configured worst slow cycle, so a single slow cooling cycle was
  // filed as a formal downtime event with lost parts and alerts —
  // 9 of the 22 events on disk were that, and were false.
  const worst = worstHonestCycleSec(id);
  return {
    ...r,
    microStopSec: Math.max(r.microStopSec / ALERT_SCALE, worst * 1.05),
    downtimeSec:  Math.max(r.downtimeSec  / ALERT_SCALE, worst * 1.25),
    criticalSec:  Math.max(r.criticalSec  / ALERT_SCALE, worst * 2.0),
  };
}

// Called for every payload that arrives from a device.
export function observe(payload, now = new Date()) {
  const id = payload?.machine_id;
  const s = state.get(id);
  if (!s) return;
  const rules = effective(id);
  const t = now.getTime();

  // A device still learning its stroke is not a stopped machine.
  // Without this the gap clock runs from boot and manufactures a
  // downtime event before the sensor has ever counted anything.
  if (payload.status === 'LEARNING' || !payload.status) {
    s.lastShotAt = t;
    s.stopSince = null;
    return;
  }

  // ---- did a part come off the machine?
  if (typeof payload.shots === 'number') {
    if (s.lastShots === null) { s.lastShots = payload.shots; s.lastShotAt = t; }
    else if (payload.shots < s.lastShots) {
      // The device rebooted; its counter restarted at zero. That is NOT
      // production. Re-baseline without touching the downtime clock,
      // otherwise a power blip fires a false RECOVERED on a machine
      // that is still standing still.
      s.lastShots = payload.shots;
    } else if (payload.shots > s.lastShots) {
      s.lastShots = payload.shots;
      s.lastShotAt = t;
      closeIfOpen(id, s, rules, now);
      s.stopSince = null;
    }
  }

  const gapSec = (t - s.lastShotAt) / 1000;

  // ---- a gap has started
  if (gapSec > rules.microStopSec && s.stopSince === null) {
    s.stopSince = s.lastShotAt;
  }

  // ---- the gap is now long enough to be a real downtime event
  if (s.stopSince !== null && s.eventId === null && gapSec >= rules.downtimeSec) {
    s.eventId = db.openDowntime(id, new Date(s.stopSince));
    s.fired = new Set();
    emit('downtime-open', id, s.eventId, { startedAt: new Date(s.stopSince).toISOString() });
  }

  // ---- the event is escalated by the issue ladder (escalation.js): once it
  // is older than the limit in Settings it becomes an issue and the people
  // on the ladder are emailed. Here we only mark it critical.
  if (s.eventId !== null && gapSec >= rules.criticalSec) db.escalateDowntime(s.eventId, 'critical');
}

function closeIfOpen(id, s, rules, now) {
  if (s.eventId === null) {
    // It was only ever a micro-stop — record it, do not call it downtime.
    if (s.stopSince !== null) {
      const secs = (now.getTime() - s.stopSince) / 1000;
      if (secs >= rules.microStopSec) db.recordMicroStop(id, new Date(s.stopSince), Math.round(secs));
    }
    return;
  }

  const secs = (now.getTime() - s.stopSince) / 1000;
  // Cycles the machine did not run, and the units those cycles would
  // have produced. Deliberately NOT money — a rand figure needs a part
  // price nobody has given us, and a made-up one is worse than none.
  const mould = settings.mouldFor(id);
  const lostShots = Math.max(0, Math.round(secs / (mould.idealCycleSec || rules.expectedCycleSec)));
  const lostUnits = lostShots * (mould.cavities || 1);

  db.closeDowntime(s.eventId, now, Math.round(secs), lostShots, lostUnits);

  const ev = db.downtimeById(s.eventId);
  const reason = ev?.reason_label || 'Not attributed';

  // The stop is over: its issue resolves (and tells whoever was told), and
  // if an operator already explained it, it joins the downtime log.
  syncLogForEvent(s.eventId);
  escalationTick(now);

  emit('downtime-close', id, s.eventId, { seconds: Math.round(secs), lostShots, lostUnits, reason });
  s.eventId = null;
  s.fired = new Set();
}


export function attribute(eventId, code, note, operator = null) {
  const r = settings.reasons().find(x => x.code === code);
  if (!r) return { ok: false, error: 'unknown reason' };

  // Verify the event exists BEFORE reporting success. Without this an
  // UPDATE that matches zero rows still returns ok:true and the
  // operator's phone says "Logged" while the answer went nowhere.
  const id = Number(eventId);
  if (!Number.isInteger(id) || !db.downtimeById(id)) {
    return { ok: false, error: `no downtime event #${eventId}` };
  }

  db.attributeDowntime(id, r.code, r.label, note, r.planned, operator);
  syncLogForEvent(id);
  emit('attributed', db.downtimeById(id)?.machine_id, id, { reason: r.label, planned: r.planned });
  return { ok: true, reason: r.label, planned: r.planned };
}

// A stop the sensor saw and a person explained becomes a row in the
// downtime log, so the reports have ONE place to read from.
export function syncLogForEvent(id) {
  const ev = db.downtimeById(id);
  if (!ev || ev.state !== 'CLOSED' || !ev.reason_code || store.downtimeLogForEvent(id)) return null;
  return store.addDowntimeLog({
    machineId: ev.machine_id, reasonCode: ev.reason_code, reasonLabel: ev.reason_label, planned: Boolean(ev.planned),
    startedAt: ev.started_at, endedAt: ev.ended_at, minutes: Math.round(((ev.seconds || 0) / 60) * 10) / 10,
    note: ev.note, eventId: id, operator: ev.attributed_by || null, source: 'sensor',
  });
}

// What the QR page needs: the open event for this machine, if any.
export function openFor(machineId) {
  const ev = db.openDowntimeFor(machineId);
  if (!ev) return null;
  const s = state.get(machineId);
  const secs = s?.stopSince ? (Date.now() - s.stopSince) / 1000 : (ev.seconds || 0);
  return { ...ev, elapsed_seconds: Math.round(secs), elapsed_human: human(secs) };
}

export function liveEventState() {
  return MACHINES.map(m => {
    const s = state.get(m.id);
    const rules = rulesFor(m.id);
    const eff = effective(m.id);
    const gapSec = s ? (Date.now() - s.lastShotAt) / 1000 : 0;
    return {
      machine_id: m.id,
      gap_seconds: Math.round(gapSec),
      gap_human: human(gapSec),
      level: s?.eventId ? (gapSec >= eff.criticalSec ? 'critical' : 'downtime')
           : (gapSec > eff.microStopSec ? 'micro' : 'ok'),
      event_id: s?.eventId ?? null,
      rules,
      fired: [...(s?.fired || [])],
    };
  });
}

function emit(type, machineId, eventId, extra = {}) {
  broadcast({ type, machine_id: machineId, event_id: eventId, ...extra });
}

export function human(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function baseUrl() {
  return process.env.DK_BASE_URL || `http://localhost:${process.env.DK_WEB_PORT || 4310}`;
}
