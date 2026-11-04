// ============================================================
// OEE: Overall Equipment Effectiveness = Availability x Performance x Quality.
//
//   Availability  run time / planned production time
//       planned time  = time in the window, minus time the machine was not
//                       scheduled (gaps over 8 h), minus PLANNED stops an
//                       operator logged (scheduled maintenance, mould change...)
//       run time      = planned time minus UNPLANNED stops
//       unplanned     = gaps between shots the sensor saw (over 60 s), minus
//                       the planned stops that were logged against them
//
//   Performance   (shots x ideal cycle time) / run time, capped at 100%
//       ideal cycle time comes from Settings, per machine and mould
//
//   Quality       (units made - defects logged) / units made
//       units made = shots x cavities of the active mould
//
// Every factor is null (shown as a dash) when there is nothing honest to
// divide, never a made-up 100%.
// ============================================================

import { MACHINES, KAIZEN, SHIFTS } from './config.js';
import { db, iso } from './db.js';
import * as settings from './settings.js';
import { dayOf, shiftOf } from './store.js';

const r1 = (n) => (n == null ? null : Math.round(n * 1000) / 10);   // fraction -> percent, 1 decimal

function windowMath(machineId, from, to, now) {
  const end = new Date(Math.min(to.getTime(), now.getTime()));
  if (end <= from) return null;
  const f = iso(from), t = iso(end);
  const mould = settings.mouldFor(machineId);

  const p = db.prepare(
    `SELECT
       SUM(CASE WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC} THEN 1 ELSE 0 END) AS shots,
       SUM(CASE WHEN cycletime > ${KAIZEN.CYCLE_MAX_SEC} AND cycletime <= ${KAIZEN.DOWNTIME_MAX_SEC} THEN cycletime ELSE 0 END) AS stop_sec,
       SUM(CASE WHEN cycletime > ${KAIZEN.DOWNTIME_MAX_SEC} THEN cycletime ELSE 0 END) AS nonsched_sec
     FROM production WHERE machine_id = ? AND timestamp >= ? AND timestamp < ?`
  ).get(machineId, f, t);

  const shots = p.shots || 0;
  // A stop that is still going has no closing shot yet; count it so far.
  const open = db.prepare(`SELECT started_at FROM downtime_events WHERE machine_id = ? AND state = 'OPEN'`).get(machineId);
  let openSec = 0;
  if (open) {
    const s = new Date(Math.max(new Date(open.started_at.replace(' ', 'T')).getTime(), from.getTime()));
    openSec = Math.max(0, (end.getTime() - s.getTime()) / 1000);
  }
  const stopSec = (p.stop_sec || 0) + openSec;
  const nonSchedSec = p.nonsched_sec || 0;

  const loggedPlannedSec = (db.prepare(
    `SELECT COALESCE(SUM(minutes),0) AS m FROM downtime_logs
      WHERE machine_id = ? AND planned = 1 AND started_at >= ? AND started_at < ?`
  ).get(machineId, f, t).m) * 60;
  // Never take more planned time out than the sensor saw as stopped, when
  // the sensor was there to see it.
  const plannedEff = shots > 0 || openSec > 0 ? Math.min(loggedPlannedSec, stopSec) : loggedPlannedSec;

  const elapsed = (end.getTime() - from.getTime()) / 1000;
  const plannedSec = Math.max(0, elapsed - nonSchedSec - plannedEff);
  const unplannedSec = Math.min(plannedSec, Math.max(0, stopSec - plannedEff));
  const runSec = plannedSec - unplannedSec;

  const units = shots * mould.cavities;
  const defects = db.prepare(
    `SELECT COALESCE(SUM(qty),0) AS n FROM defect_logs WHERE machine_id = ? AND occurred_at >= ? AND occurred_at < ?`
  ).get(machineId, f, t).n;

  return { elapsed, plannedSec, unplannedSec, runSec, shots, units, defects, ideal: mould.idealCycleSec, cavities: mould.cavities, mouldName: mould.name };
}

function factors(w) {
  if (!w) return emptyOee();
  const a = w.plannedSec > 0 ? w.runSec / w.plannedSec : null;
  const perf = w.runSec > 0 && w.shots > 0 ? Math.min(1, (w.shots * w.ideal) / w.runSec) : null;
  const q = w.units > 0 ? Math.max(0, (w.units - w.defects) / w.units) : null;
  const oee = a != null && perf != null && q != null ? a * perf * q : null;
  return {
    availability: r1(a), performance: r1(perf), quality: r1(q), oee: r1(oee),
    shots: w.shots, units: w.units, defects: w.defects,
    plannedMin: Math.round(w.plannedSec / 60), unplannedMin: Math.round(w.unplannedSec / 60), runMin: Math.round(w.runSec / 60),
    idealCycleSec: w.ideal, cavities: w.cavities, mould: w.mouldName,
    _raw: { plannedSec: w.plannedSec, runSec: w.runSec, shotsIdeal: w.shots * w.ideal, units: w.units, defects: w.defects },
  };
}
const emptyOee = () => ({ availability: null, performance: null, quality: null, oee: null, shots: 0, units: 0, defects: 0, plannedMin: 0, unplannedMin: 0, runMin: 0, _raw: { plannedSec: 0, runSec: 0, shotsIdeal: 0, units: 0, defects: 0 } });

// Window for one shift of a shift-day: A is 06:00 to 18:00, B is 18:00 to 06:00 the next morning.
export function shiftWindow(dayStr, shiftName) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const s = SHIFTS.find(x => x.name === shiftName);
  const from = new Date(y, m - 1, d, s.startHour, 0, 0);
  const to = new Date(y, m - 1, d, s.startHour + (s.endHour <= s.startHour ? 24 + s.endHour - s.startHour : s.endHour - s.startHour), 0, 0);
  return { from, to };
}
export function dayWindow(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const first = SHIFTS[0].startHour;
  return { from: new Date(y, m - 1, d, first, 0, 0), to: new Date(y, m - 1, d + 1, first, 0, 0) };
}

export function oeeFor(machineId, from, to, now = new Date()) {
  return factors(windowMath(machineId, from, to, now));
}

// Sum the raw parts across machines so the plant figure is weighted by
// time and parts, not an average of averages.
export function combine(list) {
  const t = list.reduce((a, o) => ({
    plannedSec: a.plannedSec + o._raw.plannedSec, runSec: a.runSec + o._raw.runSec,
    shotsIdeal: a.shotsIdeal + o._raw.shotsIdeal, units: a.units + o._raw.units, defects: a.defects + o._raw.defects,
  }), { plannedSec: 0, runSec: 0, shotsIdeal: 0, units: 0, defects: 0 });
  const a = t.plannedSec > 0 ? t.runSec / t.plannedSec : null;
  const p = t.runSec > 0 && t.shotsIdeal > 0 ? Math.min(1, t.shotsIdeal / t.runSec) : null;
  const q = t.units > 0 ? Math.max(0, (t.units - t.defects) / t.units) : null;
  return { availability: r1(a), performance: r1(p), quality: r1(q), oee: a != null && p != null && q != null ? r1(a * p * q) : null, units: t.units, defects: t.defects };
}

const strip = ({ _raw, ...rest }) => rest;

// Today's picture for the dashboard: the current shift, the whole shift-day,
// both shifts, per machine and for the plant.
export function dashboard(now = new Date()) {
  const cur = shiftOf(now);
  const day = cur.day;
  const per = MACHINES.map(m => {
    const shifts = {};
    for (const s of SHIFTS) { const w = shiftWindow(day, s.name); shifts[s.name] = oeeFor(m.id, w.from, w.to, now); }
    const dw = dayWindow(day);
    return { machine_id: m.id, name: m.name, current: shifts[cur.shift], shifts, day: oeeFor(m.id, dw.from, dw.to, now) };
  });
  return {
    day, currentShift: cur.shift,
    plant: {
      current: combine(per.map(p => p.current)),
      day: combine(per.map(p => p.day)),
      shifts: Object.fromEntries(SHIFTS.map(s => [s.name, combine(per.map(p => p.shifts[s.name]))])),
    },
    machines: per.map(p => ({
      machine_id: p.machine_id, name: p.name,
      current: strip(p.current), day: strip(p.day),
      shifts: Object.fromEntries(Object.entries(p.shifts).map(([k, v]) => [k, strip(v)])),
    })),
  };
}

// One OEE number per shift-day, for the trend chart.
export function trend({ machineId = null, days = 14, now = new Date() } = {}) {
  const out = [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayDay = shiftOf(now).day;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    const day = dayOf(d);
    if (day > todayDay) continue;
    const w = dayWindow(day);
    const ids = machineId ? [machineId] : MACHINES.map(m => m.id);
    const list = ids.map(id => oeeFor(id, w.from, w.to, now));
    const c = ids.length === 1 ? strip(list[0]) : combine(list);
    out.push({ day, ...(({ oee, availability, performance, quality }) => ({ oee, availability, performance, quality }))(c) });
  }
  return out;
}
