// ============================================================
// Storage.
//
// `production` is the CLIENT'S table, column for column, so the
// existing Node-RED "History Data Browser" flow can be pointed at
// a MySQL copy of this and work untouched. One row per shot.
//
// `machine_events` and `heartbeat` are additions this project
// needs and the client's schema does not have. They are separate
// tables on purpose — nothing here changes the shape of the table
// their flow already writes.
//
// Storage is SQLite (node:sqlite, so there is nothing to install and
// nothing native to compile). There is deliberately NO MySQL driver in
// here — sql/schema.mysql.sql exists so the client's EXISTING Node-RED
// flows can be pointed at a MySQL database with the same shape, not so
// that this app can write to one. Do not describe that file as a
// "switch"; nothing in this code reads a MySQL connection string.
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB, KAIZEN, SHIFTS } from './config.js';

mkdirSync(dirname(DB.file), { recursive: true });
const db = new DatabaseSync(DB.file);

db.exec(`
  PRAGMA journal_mode = WAL;

  -- The client's table. Do not add columns to this one.
  CREATE TABLE IF NOT EXISTS production (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT    NOT NULL,
    machine_id TEXT    NOT NULL,
    cycletime  REAL,
    downtime   REAL
  );
  CREATE INDEX IF NOT EXISTS idx_prod_ts      ON production(timestamp);
  CREATE INDEX IF NOT EXISTS idx_prod_machine ON production(machine_id, timestamp);

  -- Ours: every status transition, so downtime can be reported as
  -- real intervals rather than inferred from cycle-time buckets.
  CREATE TABLE IF NOT EXISTS machine_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT    NOT NULL,
    machine_id TEXT    NOT NULL,
    status     TEXT    NOT NULL,
    ended_at   TEXT,
    seconds    REAL
  );
  CREATE INDEX IF NOT EXISTS idx_ev_machine ON machine_events(machine_id, timestamp);

  -- A formal, attributable downtime event. This is the record an
  -- operator answers for and a manager gets escalated about.
  CREATE TABLE IF NOT EXISTS downtime_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id   TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    seconds      REAL,
    level        TEXT NOT NULL DEFAULT 'downtime',   -- downtime | critical
    state        TEXT NOT NULL DEFAULT 'OPEN',       -- OPEN | CLOSED
    reason_code  TEXT,
    reason_label TEXT,
    note         TEXT,
    attributed_at TEXT,
    planned      INTEGER,          -- 1 = downtime the factory chose, 0 = downtime it suffered
    lost_shots   INTEGER,
    lost_value   REAL
  );
  CREATE INDEX IF NOT EXISTS idx_dt_machine ON downtime_events(machine_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_dt_state   ON downtime_events(state);

  -- Micro-stops: recorded but deliberately NOT downtime. Repeated
  -- micro-stops are the Kaizen signal.
  CREATE TABLE IF NOT EXISTS micro_stops (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id TEXT NOT NULL,
    at         TEXT NOT NULL,
    seconds    REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ms_machine ON micro_stops(machine_id, at);

  -- Every alert the escalation ladder fired. One row per rung per
  -- event, which is what stops the same stoppage spamming anyone.
  CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER NOT NULL,
    machine_id TEXT NOT NULL,
    at         TEXT NOT NULL,
    level      TEXT NOT NULL,
    channel    TEXT NOT NULL,
    recipient  TEXT NOT NULL,
    message    TEXT NOT NULL,
    delivered  INTEGER NOT NULL DEFAULT 0,
    detail     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_al_event ON alerts(event_id);

  -- WHICH PHYSICAL SENSOR IS ON WHICH MACHINE.
  --
  -- The sensor no longer knows what machine it is bolted to. It only
  -- knows its own MAC address, which is burned into the chip and can
  -- never be typed wrong. The mapping lives here instead, so every
  -- sensor gets the SAME firmware and moving one to another machine
  -- is a dropdown, not a laptop and a USB cable.
  CREATE TABLE IF NOT EXISTS device_assignments (
    device_id   TEXT PRIMARY KEY,     -- the MAC, lower case, no colons
    machine_id  TEXT,                 -- NULL until somebody assigns it
    assigned_at TEXT,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    note        TEXT
  );

  -- Ours: last time we heard from each device at all.
  CREATE TABLE IF NOT EXISTS heartbeat (
    machine_id TEXT PRIMARY KEY,
    last_seen  TEXT NOT NULL,
    source     TEXT
  );
`);

// Older databases predate the `planned` column.
try { db.exec('ALTER TABLE downtime_events ADD COLUMN planned INTEGER'); } catch { /* already there */ }

// Any downtime event still OPEN at boot belongs to a previous run of
// the server — nothing is watching its clock any more. Close it out
// rather than leaving a phantom event open for ever.
db.exec(`UPDATE downtime_events
            SET state = 'CLOSED',
                ended_at = COALESCE(ended_at, started_at),
                seconds = COALESCE(seconds, 0)
          WHERE state = 'OPEN'`);

const iso = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const stmts = {
  insertShot: db.prepare(
    'INSERT INTO production (timestamp, machine_id, cycletime, downtime) VALUES (?, ?, ?, ?)'
  ),
  openEvent: db.prepare(
    'INSERT INTO machine_events (timestamp, machine_id, status) VALUES (?, ?, ?)'
  ),
  closeEvent: db.prepare(
    `UPDATE machine_events SET ended_at = ?,
       seconds = (julianday(?) - julianday(timestamp)) * 86400
     WHERE id = ?`
  ),
  lastOpenEvent: db.prepare(
    'SELECT id, status FROM machine_events WHERE machine_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
  ),
  beat: db.prepare(
    'INSERT INTO heartbeat (machine_id, last_seen, source) VALUES (?, ?, ?) ' +
    'ON CONFLICT(machine_id) DO UPDATE SET last_seen = excluded.last_seen, source = excluded.source'
  ),
};

// ------------------------------------------------------------
// Downtime events
// ------------------------------------------------------------
const evStmts = {
  open: db.prepare(
    `INSERT INTO downtime_events (machine_id, started_at, level, state) VALUES (?, ?, ?, 'OPEN')`
  ),
  close: db.prepare(
    `UPDATE downtime_events SET ended_at = ?, seconds = ?, state = 'CLOSED',
        lost_shots = ?, lost_value = ? WHERE id = ?`
  ),
  escalate: db.prepare(`UPDATE downtime_events SET level = ? WHERE id = ?`),
  openFor: db.prepare(
    `SELECT * FROM downtime_events WHERE machine_id = ? AND state = 'OPEN' ORDER BY id DESC LIMIT 1`
  ),
  byId: db.prepare(`SELECT * FROM downtime_events WHERE id = ?`),
  attribute: db.prepare(
    `UPDATE downtime_events SET reason_code = ?, reason_label = ?, note = ?, attributed_at = ?, planned = ? WHERE id = ?`
  ),
  recent: db.prepare(
    `SELECT * FROM downtime_events WHERE (? IS NULL OR machine_id = ?)
      ORDER BY id DESC LIMIT ?`
  ),
  microStop: db.prepare(`INSERT INTO micro_stops (machine_id, at, seconds) VALUES (?, ?, ?)`),
  microCount: db.prepare(
    `SELECT COUNT(*) AS n, ROUND(SUM(seconds)/60.0,1) AS min FROM micro_stops
      WHERE machine_id = ? AND at >= ?`
  ),
  addAlert: db.prepare(
    `INSERT INTO alerts (event_id, machine_id, at, level, channel, recipient, message, delivered, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  alertsFor: db.prepare(`SELECT * FROM alerts WHERE event_id = ? ORDER BY id`),
  alertLevels: db.prepare(`SELECT level FROM alerts WHERE event_id = ?`),
  recentAlerts: db.prepare(
    `SELECT * FROM alerts WHERE (? IS NULL OR machine_id = ?) ORDER BY id DESC LIMIT ?`
  ),
};

export function openDowntime(machineId, at) { return evStmts.open.run(machineId, iso(at), 'downtime').lastInsertRowid; }
export function closeDowntime(id, at, seconds, lostShots, lostValue) { evStmts.close.run(iso(at), seconds, lostShots, lostValue, id); }
export function escalateDowntime(id, level) { evStmts.escalate.run(level, id); }
export function openDowntimeFor(machineId) { return evStmts.openFor.get(machineId) || null; }
export function downtimeById(id) { return evStmts.byId.get(id) || null; }
export function attributeDowntime(id, code, label, note, planned) { evStmts.attribute.run(code, label, note || null, iso(new Date()), planned ? 1 : 0, id); }
export function recentDowntime(machineId, limit = 40) { return evStmts.recent.all(machineId ?? null, machineId ?? null, limit); }
export function recordMicroStop(machineId, at, seconds) { evStmts.microStop.run(machineId, iso(at), seconds); }
export function microStopStats(machineId, sinceIso) { return evStmts.microCount.get(machineId, sinceIso) || { n: 0, min: 0 }; }
export function addAlert(a) {
  return evStmts.addAlert.run(
    a.eventId, a.machineId, iso(a.at || new Date()), a.level, a.channel,
    a.recipient, a.message, a.delivered ? 1 : 0, a.detail || null
  ).lastInsertRowid;
}

// Delivery is settled AFTER the network call comes back, so a 401 from
// Meta or a dead webhook is recorded as a failure instead of the row
// claiming success the instant the request was handed to fetch().
const setDelivery = db.prepare('UPDATE alerts SET delivered = ?, detail = ? WHERE id = ?');
export function setAlertDelivery(id, delivered, detail) {
  setDelivery.run(delivered ? 1 : 0, detail || null, id);
}
export function alertsForEvent(id) { return evStmts.alertsFor.all(id); }
export function alertLevelsFired(id) { return evStmts.alertLevels.all(id).map(r => r.level); }
export function recentAlerts(limit = 40, machineId = null) {
  return evStmts.recentAlerts.all(machineId, machineId, limit);
}

// ------------------------------------------------------------
// Sensor -> machine assignment
// ------------------------------------------------------------
const devStmts = {
  seen: db.prepare(
    `INSERT INTO device_assignments (device_id, first_seen, last_seen)
     VALUES (?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen`
  ),
  assign: db.prepare(
    `UPDATE device_assignments SET machine_id = ?, assigned_at = ?, note = ? WHERE device_id = ?`
  ),
  get: db.prepare('SELECT * FROM device_assignments WHERE device_id = ?'),
  all: db.prepare('SELECT * FROM device_assignments ORDER BY machine_id IS NULL DESC, last_seen DESC'),
  byMachine: db.prepare('SELECT * FROM device_assignments WHERE machine_id = ?'),
  clearMachine: db.prepare('UPDATE device_assignments SET machine_id = NULL, assigned_at = NULL WHERE machine_id = ?'),
};

export function seeDevice(deviceId, at = new Date()) {
  devStmts.seen.run(deviceId, iso(at), iso(at));
  return devStmts.get.get(deviceId);
}
export function assignDevice(deviceId, machineId, note) {
  // One sensor per machine: assigning a new one releases whatever was
  // there, otherwise two sensors quietly write to the same machine.
  if (machineId) devStmts.clearMachine.run(machineId);
  devStmts.assign.run(machineId || null, machineId ? iso(new Date()) : null, note || null, deviceId);
  return devStmts.get.get(deviceId);
}
export function deviceFor(deviceId) { return devStmts.get.get(deviceId) || null; }
export function allDevices() { return devStmts.all.all(); }
export function deviceOnMachine(machineId) { return devStmts.byMachine.get(machineId) || null; }

export function recordShot({ machineId, cycletime, downtime, at = new Date() }) {
  stmts.insertShot.run(iso(at), machineId, cycletime ?? 0, downtime ?? 0);
}

export function recordStatus({ machineId, status, at = new Date() }) {
  const open = stmts.lastOpenEvent.get(machineId);
  if (open && open.status === status) return;          // no change
  if (open) stmts.closeEvent.run(iso(at), iso(at), open.id);
  stmts.openEvent.run(iso(at), machineId, status);
}

export function beat(machineId, source, at = new Date()) {
  stmts.beat.run(machineId, iso(at), source);
}

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

// The Kaizen classification the client's own History flow uses:
// a gap is a cycle, a small stop, downtime, or non-scheduled time,
// decided purely by how long it was.
const CLASS_SQL = `
  CASE
    WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC}      THEN 'cycle'
    WHEN cycletime <= ${KAIZEN.SMALL_STOP_MAX_SEC} THEN 'small_stop'
    WHEN cycletime <= ${KAIZEN.DOWNTIME_MAX_SEC}   THEN 'downtime'
    ELSE 'non_scheduled'
  END`;

export function shotsBetween(machineId, fromIso, toIso) {
  return db.prepare(
    `SELECT id, timestamp, machine_id, cycletime, downtime, ${CLASS_SQL} AS class
       FROM production
      WHERE machine_id = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp`
  ).all(machineId, fromIso, toIso);
}

export function summary(machineId, fromIso, toIso) {
  const row = db.prepare(
    `SELECT
       COUNT(*)                                                    AS rows_total,
       SUM(CASE WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC} THEN 1 ELSE 0 END)      AS good_shots,
       AVG(CASE WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC} THEN cycletime END)     AS avg_cycle,
       MIN(CASE WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC} THEN cycletime END)     AS best_cycle,
       SUM(CASE WHEN cycletime > ${KAIZEN.CYCLE_MAX_SEC}
                 AND cycletime <= ${KAIZEN.SMALL_STOP_MAX_SEC} THEN 1 ELSE 0 END) AS small_stops,
       SUM(CASE WHEN cycletime > ${KAIZEN.CYCLE_MAX_SEC}
                 AND cycletime <= ${KAIZEN.SMALL_STOP_MAX_SEC} THEN cycletime END) AS small_stop_sec,
       SUM(CASE WHEN cycletime > ${KAIZEN.SMALL_STOP_MAX_SEC}
                 AND cycletime <= ${KAIZEN.DOWNTIME_MAX_SEC} THEN 1 ELSE 0 END)   AS downtime_events,
       SUM(CASE WHEN cycletime > ${KAIZEN.SMALL_STOP_MAX_SEC}
                 AND cycletime <= ${KAIZEN.DOWNTIME_MAX_SEC} THEN cycletime END)  AS downtime_sec
     FROM production
     WHERE machine_id = ? AND timestamp >= ? AND timestamp < ?`
  ).get(machineId, fromIso, toIso) || {};

  const good = row.good_shots || 0;
  const avg = row.avg_cycle || 0;
  const best = row.best_cycle || 0;
  const runSec = (good * avg) || 0;
  const lostSec = (row.small_stop_sec || 0) + (row.downtime_sec || 0);

  return {
    shots: good,
    avgCycleSec: round1(avg),
    bestCycleSec: round1(best),
    smallStops: row.small_stops || 0,
    smallStopMin: round1((row.small_stop_sec || 0) / 60),
    downtimeEvents: row.downtime_events || 0,
    downtimeMin: round1((row.downtime_sec || 0) / 60),
    // Availability in the OEE sense: running time over running+lost.
    availabilityPct: runSec + lostSec > 0 ? round1((runSec / (runSec + lostSec)) * 100) : 0,
    // Performance: how close the average cycle got to the best one seen.
    performancePct: avg > 0 && best > 0 ? round1((best / avg) * 100) : 0,
  };
}

// Real shift totals — the thing the device fakes.
//
// A shift that crosses midnight belongs to the day it STARTED, not to
// whichever calendar day each row happens to fall in. Bucketing by
// calendar day made today's 00:00-06:00 rows (last night's B shift)
// sum with tonight's 18:00 onwards, which is how the MA1 tile came to
// claim 953 B-shift shots at half past nine at night.
export function shiftTotals(machineId, dayIso) {
  const out = {};

  for (const shift of SHIFTS) {
    const spansMidnight = shift.endHour <= shift.startHour;
    const from = `${dayIso} ${String(shift.startHour).padStart(2, '0')}:00:00`;
    const to = spansMidnight
      ? `date('${dayIso}', '+1 day') || ' ' || '${String(shift.endHour).padStart(2, '0')}:00:00'`
      : `'${dayIso} ${String(shift.endHour).padStart(2, '0')}:00:00'`;

    const row = db.prepare(
      `SELECT
         SUM(CASE WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC} THEN 1 ELSE 0 END) AS shots,
         SUM(CASE WHEN cycletime >  ${KAIZEN.CYCLE_MAX_SEC}
                   AND cycletime <= ${KAIZEN.DOWNTIME_MAX_SEC} THEN cycletime ELSE 0 END) AS down_sec
       FROM production
       WHERE machine_id = ? AND timestamp >= ? AND timestamp < ${to}`
    ).get(machineId, from) || {};

    out[shift.name] = {
      shots: row.shots || 0,
      downtimeMin: round1((row.down_sec || 0) / 60),
      window: `${from.slice(11, 16)}\u2013${String(shift.endHour).padStart(2, '0')}:00${spansMidnight ? ' next day' : ''}`,
    };
  }
  return out;
}

// Bucketed series for the charts. unit: minute|hour|day|week|month|year
const BUCKET = {
  minute: "strftime('%Y-%m-%d %H:%M', timestamp)",
  hour:   "strftime('%Y-%m-%d %H:00', timestamp)",
  day:    "date(timestamp)",
  week:   "strftime('%Y-W%W', timestamp)",
  month:  "strftime('%Y-%m', timestamp)",
  year:   "strftime('%Y', timestamp)",
};

const METRIC = {
  count:      `SUM(CASE WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC} THEN 1 ELSE 0 END)`,
  cycletime:  `ROUND(AVG(CASE WHEN cycletime <= ${KAIZEN.CYCLE_MAX_SEC} THEN cycletime END), 1)`,
  smallstop:  `ROUND(SUM(CASE WHEN cycletime > ${KAIZEN.CYCLE_MAX_SEC} AND cycletime <= ${KAIZEN.SMALL_STOP_MAX_SEC} THEN cycletime ELSE 0 END) / 60.0, 1)`,
  downtime:   `ROUND(SUM(CASE WHEN cycletime > ${KAIZEN.SMALL_STOP_MAX_SEC} AND cycletime <= ${KAIZEN.DOWNTIME_MAX_SEC} THEN cycletime ELSE 0 END) / 60.0, 1)`,
  nstime:     `ROUND(SUM(CASE WHEN cycletime > ${KAIZEN.DOWNTIME_MAX_SEC} THEN cycletime ELSE 0 END) / 3600.0, 2)`,
};

export const METRIC_LABELS = {
  count: 'Shots',
  cycletime: 'Average cycle time (sec)',
  smallstop: 'Total small stop (min)',
  downtime: 'Total down time (min)',
  nstime: 'Non-scheduled time (hours)',
};

export function series({ machineId, metric, unit, fromIso, toIso }) {
  const bucket = BUCKET[unit] || BUCKET.hour;
  const value = METRIC[metric] || METRIC.count;
  return db.prepare(
    `SELECT ${bucket} AS bucket, ${value} AS value
       FROM production
      WHERE machine_id = ? AND timestamp >= ? AND timestamp < ?
      GROUP BY bucket ORDER BY bucket`
  ).all(machineId, fromIso, toIso).map(r => ({ bucket: r.bucket, value: r.value ?? 0 }));
}

export function recentShots(machineId, limit = 60) {
  return db.prepare(
    `SELECT timestamp, cycletime, ${CLASS_SQL} AS class FROM production
      WHERE machine_id = ? ORDER BY id DESC LIMIT ?`
  ).all(machineId, limit).reverse();
}

export function dataRange() {
  return db.prepare('SELECT MIN(timestamp) AS min, MAX(timestamp) AS max, COUNT(*) AS n FROM production').get();
}

export function wipe() {
  db.exec('DELETE FROM production; DELETE FROM machine_events; DELETE FROM heartbeat; DELETE FROM downtime_events; DELETE FROM micro_stops; DELETE FROM alerts;');
  // device_assignments is deliberately NOT wiped — it describes the
  // physical installation, not the data.
}

function round1(n) { return Math.round((n || 0) * 10) / 10; }

export { iso, db };
