// ============================================================
// Storage for what people log (downtime and defects from the QR
// page) and for the escalation machinery (issues and the mail queue).
//
// Same SQLite file as the sensor data. Nothing here touches the
// client's `production` table.
// ============================================================

import { db, iso } from './db.js';
import { SHIFTS } from './config.js';

db.exec(`
  -- Downtime an operator logged by hand (or attributed from a sensor stop).
  CREATE TABLE IF NOT EXISTS downtime_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id    TEXT UNIQUE,            -- made by the phone, so a retry cannot double-log
    machine_id   TEXT NOT NULL,
    reason_code  TEXT NOT NULL,
    reason_label TEXT NOT NULL,
    planned      INTEGER NOT NULL DEFAULT 0,
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    minutes      REAL NOT NULL,
    shift        TEXT NOT NULL,
    shift_day    TEXT NOT NULL,
    note         TEXT,
    event_id     INTEGER,                -- the sensor-detected stop this explains, if any
    operator_id  INTEGER,
    operator     TEXT,
    logged_at    TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'qr'
  );
  CREATE INDEX IF NOT EXISTS idx_dl_machine ON downtime_logs(machine_id, started_at);

  CREATE TABLE IF NOT EXISTS defect_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   TEXT UNIQUE,
    machine_id  TEXT NOT NULL,
    qty         INTEGER NOT NULL,
    type_code   TEXT NOT NULL,
    type_label  TEXT NOT NULL,
    shift       TEXT NOT NULL,
    shift_day   TEXT NOT NULL,
    note        TEXT,
    photo       TEXT,                    -- file name inside data/photos
    operator_id INTEGER,
    operator    TEXT,
    occurred_at TEXT NOT NULL,
    logged_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_df_machine ON defect_logs(machine_id, occurred_at);

  -- Something that needs a person above the operator. One row per
  -- issue; the ladder walks it up until somebody acknowledges.
  CREATE TABLE IF NOT EXISTS issues (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,            -- downtime | defects | manual
    machine_id TEXT NOT NULL,
    summary    TEXT NOT NULL,
    detail     TEXT,
    source_key TEXT,                     -- stops the same cause opening twice
    opened_at  TEXT NOT NULL,
    state      TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN | ACKED | RESOLVED
    ack_token  TEXT NOT NULL,
    acked_at   TEXT,
    acked_by   TEXT,
    resolved_at TEXT,
    raised_by  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_issue_state ON issues(state);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_key ON issues(source_key) WHERE source_key IS NOT NULL;

  -- Every email the ladder wants sent. Written FIRST, sent second, so a
  -- dead network never loses a message: it waits here and retries.
  CREATE TABLE IF NOT EXISTS mail_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id        INTEGER,
    level           INTEGER,
    kind            TEXT NOT NULL,       -- escalation | recovered | test
    role            TEXT,
    to_addr         TEXT NOT NULL,
    subject         TEXT NOT NULL,
    body_text       TEXT NOT NULL,
    body_html       TEXT,
    created_at      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',   -- queued | sent | failed
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error      TEXT,
    sent_at         TEXT,
    message_id      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mail_status ON mail_queue(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_mail_issue ON mail_queue(issue_id);
`);

// ---------- time ----------
export const parse = (s) => new Date(String(s).replace(' ', 'T'));
const pad = (n) => String(n).padStart(2, '0');
export const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Which shift a moment belongs to, and which DAY that shift counts
// for. B runs 18:00 to 06:00, so 02:00 on the 5th is still the 4th's B.
export function shiftOf(d) {
  const h = d.getHours();
  for (const s of SHIFTS) {
    const spans = s.endHour <= s.startHour;
    const inside = spans ? (h >= s.startHour || h < s.endHour) : (h >= s.startHour && h < s.endHour);
    if (inside) {
      const day = spans && h < s.endHour ? new Date(d.getTime() - 86400000) : d;
      return { shift: s.name, day: dayOf(day) };
    }
  }
  return { shift: 'A', day: dayOf(d) };
}

// ---------- logs ----------
// The operator picks a shift; the shift DAY is worked out from when it
// happened (a night-shift entry made at 02:00 belongs to yesterday's B).
function shiftFor(at, chosen) {
  const auto = shiftOf(at);
  if (!chosen || chosen === auto.shift) return auto;
  // A different shift to the clock's: keep the day the clock implies for
  // that shift, which is today unless it is the small hours of a B.
  const h = at.getHours();
  const day = chosen === 'B' && h < 6 ? new Date(at.getTime() - 86400000) : at;
  return { shift: chosen, day: dayOf(day) };
}

export function addDowntimeLog(r) {
  const at = parse(r.startedAt);
  const { shift, day } = shiftFor(at, r.shift);
  try {
    const info = db.prepare(
      `INSERT INTO downtime_logs (client_id, machine_id, reason_code, reason_label, planned, started_at, ended_at,
         minutes, shift, shift_day, note, event_id, operator_id, operator, logged_at, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.clientId || null, r.machineId, r.reasonCode, r.reasonLabel, r.planned ? 1 : 0, r.startedAt, r.endedAt || null,
      r.minutes, shift, day, r.note || null, r.eventId || null, r.operatorId || null, r.operator || null,
      iso(r.now || new Date()), r.source || 'qr');
    return { id: Number(info.lastInsertRowid), duplicate: false };
  } catch (e) {
    if (/UNIQUE/.test(e.message) && r.clientId) {
      return { id: db.prepare('SELECT id FROM downtime_logs WHERE client_id = ?').get(r.clientId).id, duplicate: true };
    }
    throw e;
  }
}

export function addDefectLog(r) {
  const at = parse(r.occurredAt);
  const { shift, day } = shiftFor(at, r.shift);
  try {
    const info = db.prepare(
      `INSERT INTO defect_logs (client_id, machine_id, qty, type_code, type_label, shift, shift_day, note,
         operator_id, operator, occurred_at, logged_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(r.clientId || null, r.machineId, r.qty, r.typeCode, r.typeLabel, shift, day, r.note || null,
      r.operatorId || null, r.operator || null, r.occurredAt, iso(r.now || new Date()));
    return { id: Number(info.lastInsertRowid), shift, shiftDay: day, duplicate: false };
  } catch (e) {
    if (/UNIQUE/.test(e.message) && r.clientId) {
      const row = db.prepare('SELECT id, shift, shift_day FROM defect_logs WHERE client_id = ?').get(r.clientId);
      return { id: row.id, shift: row.shift, shiftDay: row.shift_day, duplicate: true };
    }
    throw e;
  }
}

export const setDefectPhoto = (id, file) => db.prepare('UPDATE defect_logs SET photo = ? WHERE id = ?').run(file, id);
export const defectLog = (id) => db.prepare('SELECT * FROM defect_logs WHERE id = ?').get(id) || null;
export const downtimeLogForEvent = (eventId) => db.prepare('SELECT * FROM downtime_logs WHERE event_id = ?').get(eventId) || null;
export const downtimeLog = (id) => db.prepare('SELECT * FROM downtime_logs WHERE id = ?').get(id) || null;

export function defectsInShift(machineId, shiftDay, shift) {
  return db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM defect_logs WHERE machine_id = ? AND shift_day = ? AND shift = ?')
    .get(machineId, shiftDay, shift).n;
}

const win = (col) => `${col} >= ? AND ${col} < ?`;

export function listDowntime({ machine, from, to, limit = 5000 }) {
  return db.prepare(
    `SELECT * FROM downtime_logs WHERE (? IS NULL OR machine_id = ?) AND ${win('started_at')}
      ORDER BY started_at DESC LIMIT ?`
  ).all(machine ?? null, machine ?? null, from, to, limit);
}

export function listDefects({ machine, from, to, limit = 5000 }) {
  return db.prepare(
    `SELECT * FROM defect_logs WHERE (? IS NULL OR machine_id = ?) AND ${win('occurred_at')}
      ORDER BY occurred_at DESC LIMIT ?`
  ).all(machine ?? null, machine ?? null, from, to, limit);
}

// Everything the quality cards and charts need, in one pass.
export function qualitySummary({ machine, from, to }) {
  const m = machine ?? null;
  const rows = (sql) => db.prepare(sql).all(m, m, from, to);
  const dtWhere = `(? IS NULL OR machine_id = ?) AND ${win('started_at')}`;
  const dfWhere = `(? IS NULL OR machine_id = ?) AND ${win('occurred_at')}`;

  const downtime = {
    byReason: rows(`SELECT reason_label AS label, planned, COUNT(*) AS n, ROUND(SUM(minutes),1) AS minutes
                      FROM downtime_logs WHERE ${dtWhere} GROUP BY reason_code ORDER BY minutes DESC`),
    byMachine: rows(`SELECT machine_id, COUNT(*) AS n, ROUND(SUM(minutes),1) AS minutes
                       FROM downtime_logs WHERE ${dtWhere} GROUP BY machine_id`),
    // Sensor-detected stops nobody has explained yet.
    unexplained: db.prepare(
      `SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(seconds),0)/60.0,1) AS minutes FROM downtime_events
        WHERE state = 'CLOSED' AND reason_code IS NULL AND (? IS NULL OR machine_id = ?) AND ${win('started_at')}`
    ).get(m, m, from, to),
  };
  downtime.totalMin = Math.round(downtime.byReason.reduce((a, r) => a + r.minutes, 0) * 10) / 10;
  downtime.plannedMin = Math.round(downtime.byReason.filter(r => r.planned).reduce((a, r) => a + r.minutes, 0) * 10) / 10;

  const defects = {
    byType: rows(`SELECT type_label AS label, SUM(qty) AS qty FROM defect_logs WHERE ${dfWhere} GROUP BY type_code ORDER BY qty DESC`),
    byShift: rows(`SELECT shift, SUM(qty) AS qty FROM defect_logs WHERE ${dfWhere} GROUP BY shift`),
    byMachine: rows(`SELECT machine_id, SUM(qty) AS qty, COUNT(*) AS entries FROM defect_logs WHERE ${dfWhere} GROUP BY machine_id`),
  };
  defects.total = defects.byType.reduce((a, r) => a + r.qty, 0);

  // Per shift-day, so a night shift is one bar and not two.
  const days = new Map();
  const put = (day, k, v) => { const d = days.get(day) || { day, defects: 0, downtimeMin: 0 }; d[k] += v; days.set(day, d); };
  for (const r of rows(`SELECT shift_day AS day, SUM(qty) AS v FROM defect_logs WHERE ${dfWhere} GROUP BY shift_day`)) put(r.day, 'defects', r.v);
  for (const r of rows(`SELECT shift_day AS day, ROUND(SUM(minutes),1) AS v FROM downtime_logs WHERE ${dtWhere} GROUP BY shift_day`)) put(r.day, 'downtimeMin', r.v);

  return { from, to, machine: m, downtime, defects, series: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

// ---------- issues ----------
export const issueById = (id) => db.prepare('SELECT * FROM issues WHERE id = ?').get(id) || null;
export const issueByToken = (t) => db.prepare('SELECT * FROM issues WHERE ack_token = ?').get(String(t || '')) || null;
export const issueByKey = (k) => db.prepare('SELECT * FROM issues WHERE source_key = ?').get(k) || null;
export const liveIssues = () => db.prepare(`SELECT * FROM issues WHERE state = 'OPEN' ORDER BY id`).all();
export const recentIssues = (limit = 50, machine = null) =>
  db.prepare('SELECT * FROM issues WHERE (? IS NULL OR machine_id = ?) ORDER BY id DESC LIMIT ?').all(machine, machine, limit);

export function insertIssue(r) {
  const info = db.prepare(
    `INSERT INTO issues (kind, machine_id, summary, detail, source_key, opened_at, ack_token, raised_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(r.kind, r.machineId, r.summary, r.detail || null, r.sourceKey || null, iso(r.now), r.token, r.raisedBy || null);
  return Number(info.lastInsertRowid);
}

export const ackIssue = (id, by, now) =>
  db.prepare(`UPDATE issues SET state = 'ACKED', acked_at = ?, acked_by = ? WHERE id = ? AND state = 'OPEN'`).run(iso(now), by || null, id).changes;
export const resolveIssue = (id, now) =>
  db.prepare(`UPDATE issues SET state = 'RESOLVED', resolved_at = ? WHERE id = ? AND state != 'RESOLVED'`).run(iso(now), id).changes;

// ---------- mail queue ----------
export function enqueueMail(m) {
  return Number(db.prepare(
    `INSERT INTO mail_queue (issue_id, level, kind, role, to_addr, subject, body_text, body_html, created_at, next_attempt_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(m.issueId ?? null, m.level ?? null, m.kind, m.role || null, m.to, m.subject, m.text, m.html || null,
    iso(m.now), iso(m.now)).lastInsertRowid);
}
export const mailForIssue = (issueId) => db.prepare('SELECT * FROM mail_queue WHERE issue_id = ? ORDER BY id').all(issueId);
export const dueMail = (now) =>
  db.prepare(`SELECT * FROM mail_queue WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY id`).all(iso(now));
export const recentMail = (limit = 60, issueId = null) =>
  db.prepare(`SELECT id, issue_id, level, kind, role, to_addr, subject, created_at, status, attempts, next_attempt_at,
                     last_error, sent_at, message_id FROM mail_queue
               WHERE (? IS NULL OR issue_id = ?) ORDER BY id DESC LIMIT ?`).all(issueId, issueId, limit);
export const mailCounts = () => {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM mail_queue GROUP BY status').all();
  const o = { queued: 0, sent: 0, failed: 0 };
  for (const r of rows) o[r.status] = r.n;
  return o;
};
export const markMailSent = (id, messageId, now) =>
  db.prepare(`UPDATE mail_queue SET status='sent', attempts = attempts + 1, sent_at = ?, message_id = ?, last_error = NULL WHERE id = ?`)
    .run(iso(now), messageId || null, id);
export const markMailRetry = (id, err, next) =>
  db.prepare(`UPDATE mail_queue SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?`).run(String(err).slice(0, 300), iso(next), id);
export const markMailFailed = (id, err) =>
  db.prepare(`UPDATE mail_queue SET status='failed', attempts = attempts + 1, last_error = ? WHERE id = ?`).run(String(err).slice(0, 300), id);
export const retryMail = (id, now) =>
  db.prepare(`UPDATE mail_queue SET status='queued', next_attempt_at = ? WHERE id = ? AND status = 'failed'`).run(iso(now), id).changes;
export const retryAllFailed = (now) =>
  db.prepare(`UPDATE mail_queue SET status='queued', next_attempt_at = ? WHERE status = 'failed'`).run(iso(now)).changes;
