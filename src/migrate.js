// ============================================================
// Database versioning for a LIVE factory install.
//
// The rules, because real production data lives in this file:
//   1. Migrations only ADD: new tables, new columns, new indexes. Nothing is
//      dropped, renamed or rewritten without first being copied. Every one is
//      idempotent (safe to run twice) and runs inside a transaction.
//   2. BEFORE any pending migration runs on a database that already holds
//      data, a complete backup is taken (SQLite VACUUM INTO, which is safe on a
//      live WAL database) together with the secrets and key files and a
//      manifest of row counts. If the backup cannot be made, the app refuses to
//      start rather than touch the data.
//   3. AFTER the migrations, the row counts are compared with the manifest. If
//      any table has fewer rows, the app stops and says so, loudly.
//   4. scripts/rollback.js puts the backup back (and keeps whatever was logged
//      after the upgrade in a side folder, so even that is not lost).
//
// Version numbers:
//   1  baseline: the sensor tables of v1.0 to v1.2
//   2  v1.3: operator logs, issues, the mail queue, settings, accounts
//   3  v1.3.1 to v1.4: extra columns on downtime_events
//   4  v1.4: report_facts, the table the report importer fills
// ============================================================

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';

export const APP_VERSION = '1.5.1';

const hasTable = (db, t) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(t));
const hasColumn = (db, t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c);
function addColumn(db, table, column, def) {
  if (hasTable(db, table) && !hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

export const MIGRATIONS = [
  {
    version: 1, name: 'baseline: the sensor tables (v1.0 to v1.2)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS production (
          id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, machine_id TEXT NOT NULL, cycletime REAL, downtime REAL);
        CREATE INDEX IF NOT EXISTS idx_prod_ts      ON production(timestamp);
        CREATE INDEX IF NOT EXISTS idx_prod_machine ON production(machine_id, timestamp);
        CREATE TABLE IF NOT EXISTS machine_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, machine_id TEXT NOT NULL, status TEXT NOT NULL, ended_at TEXT, seconds REAL);
        CREATE INDEX IF NOT EXISTS idx_ev_machine ON machine_events(machine_id, timestamp);
        CREATE TABLE IF NOT EXISTS downtime_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, seconds REAL,
          level TEXT NOT NULL DEFAULT 'downtime', state TEXT NOT NULL DEFAULT 'OPEN', reason_code TEXT, reason_label TEXT, note TEXT,
          attributed_at TEXT, planned INTEGER, lost_shots INTEGER, lost_value REAL);
        CREATE INDEX IF NOT EXISTS idx_dt_machine ON downtime_events(machine_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_dt_state   ON downtime_events(state);
        CREATE TABLE IF NOT EXISTS micro_stops (
          id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id TEXT NOT NULL, at TEXT NOT NULL, seconds REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_ms_machine ON micro_stops(machine_id, at);
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, machine_id TEXT NOT NULL, at TEXT NOT NULL, level TEXT NOT NULL,
          channel TEXT NOT NULL, recipient TEXT NOT NULL, message TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, detail TEXT);
        CREATE INDEX IF NOT EXISTS idx_al_event ON alerts(event_id);
        CREATE TABLE IF NOT EXISTS device_assignments (
          device_id TEXT PRIMARY KEY, machine_id TEXT, assigned_at TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, note TEXT);
        CREATE TABLE IF NOT EXISTS heartbeat (machine_id TEXT PRIMARY KEY, last_seen TEXT NOT NULL, source TEXT);
      `);
    },
  },
  {
    version: 2, name: 'v1.3: operator logs, issues, mail queue, settings, accounts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS downtime_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT UNIQUE, machine_id TEXT NOT NULL, reason_code TEXT NOT NULL, reason_label TEXT NOT NULL,
          planned INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, ended_at TEXT, minutes REAL NOT NULL, shift TEXT NOT NULL, shift_day TEXT NOT NULL,
          note TEXT, event_id INTEGER, operator_id INTEGER, operator TEXT, logged_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'qr');
        CREATE INDEX IF NOT EXISTS idx_dl_machine ON downtime_logs(machine_id, started_at);
        CREATE TABLE IF NOT EXISTS defect_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT UNIQUE, machine_id TEXT NOT NULL, qty INTEGER NOT NULL, type_code TEXT NOT NULL, type_label TEXT NOT NULL,
          shift TEXT NOT NULL, shift_day TEXT NOT NULL, note TEXT, photo TEXT, operator_id INTEGER, operator TEXT, occurred_at TEXT NOT NULL, logged_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_df_machine ON defect_logs(machine_id, occurred_at);
        CREATE TABLE IF NOT EXISTS issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, machine_id TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT, source_key TEXT,
          opened_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'OPEN', ack_token TEXT NOT NULL, acked_at TEXT, acked_by TEXT, resolved_at TEXT, raised_by TEXT);
        CREATE INDEX IF NOT EXISTS idx_issue_state ON issues(state);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_key ON issues(source_key) WHERE source_key IS NOT NULL;
        CREATE TABLE IF NOT EXISTS mail_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, level INTEGER, kind TEXT NOT NULL, role TEXT, to_addr TEXT NOT NULL, subject TEXT NOT NULL,
          body_text TEXT NOT NULL, body_html TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT NOT NULL, last_error TEXT, sent_at TEXT, message_id TEXT);
        CREATE INDEX IF NOT EXISTS idx_mail_status ON mail_queue(status, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_mail_issue ON mail_queue(issue_id);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'invited',
          pw_hash TEXT, totp_secret TEXT, totp_on INTEGER NOT NULL DEFAULT 0, totp_last INTEGER NOT NULL DEFAULT 0, recovery TEXT, pin_lookup TEXT,
          failed INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL, last_login TEXT);
        CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
        CREATE TABLE IF NOT EXISTS sessions (
          id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, ua TEXT);
        CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_attempts ON auth_attempts(key, at);
        CREATE TABLE IF NOT EXISTS auth_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id INTEGER, who TEXT, event TEXT NOT NULL, ip TEXT, detail TEXT);
      `);
    },
  },
  {
    version: 3, name: 'v1.3.1 to v1.4: who explained a stop, planned flag (older databases)',
    up(db) {
      addColumn(db, 'downtime_events', 'planned', 'INTEGER');
      addColumn(db, 'downtime_events', 'attributed_by', 'TEXT');
    },
  },
  {
    version: 4, name: 'v1.4: report_facts for the report importer',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS report_facts (
        machine TEXT NOT NULL, date TEXT NOT NULL, shift TEXT NOT NULL, planned_minutes REAL, downtime_minutes REAL, downtime_by_reason TEXT,
        shots INTEGER, output_units INTEGER, ideal_cycle_sec REAL, avg_cycle_sec REAL, defects INTEGER, defects_by_type TEXT, mould TEXT, notes TEXT,
        source_file TEXT NOT NULL, source_page TEXT, imported_at TEXT NOT NULL, PRIMARY KEY (machine, date, shift))`);
    },
  },
];

// ---------- counting ----------
const userTables = (db) => db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);
export function countTables(db) {
  const out = {};
  for (const t of userTables(db)) out[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
  return out;
}
// A full content fingerprint (every row of every table). Used by tests and the
// proof tooling, not at start-up, because a factory table can be millions of rows.
export function fingerprint(db, tables = userTables(db)) {
  const out = {};
  for (const t of tables) {
    const h = createHash('sha256');
    for (const r of db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).iterate()) h.update(JSON.stringify(r));
    out[t] = h.digest('hex').slice(0, 20);
  }
  return out;
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const sqlq = (p) => p.replace(/'/g, "''");

// ---------- the backup ----------
export function takeBackup(db, file, { appVersion = APP_VERSION, from, to, counts, label } = {}) {
  // label: what the backup is for, e.g. 'reset'. Default is the upgrade name 'v<version>'.
  const base = join(dirname(file), 'backups', `${stamp()}-before-${label || 'v' + appVersion}`);
  let dir = base, n = 1;
  while (existsSync(dir)) dir = `${base}-${++n}`;       // never overwrite an earlier backup
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, 'kaizen.db');
  db.exec(`VACUUM INTO '${sqlq(dest)}'`);
  // the two files that cannot be recreated: the dashboard secrets and the key that seals 2FA secrets
  for (const f of [process.env.DK_SECRETS || join(dirname(file), 'secrets.json'), process.env.DK_KEYFILE || join(dirname(file), 'keystore.key')]) {
    if (existsSync(f)) copyFileSync(f, join(dir, basename(f)));
  }
  const manifest = { appVersion, takenAt: new Date().toISOString(), fromVersion: from, toVersion: to, database: file, counts, bytes: statSync(dest).size,
    note: 'Photos in data/photos and the .env file are not changed by an upgrade and are not copied here.' };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}

export function listBackups(file) {
  const root = join(dirname(file), 'backups');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(n => existsSync(join(root, n, 'manifest.json'))).sort().map(n => ({ name: n, dir: join(root, n), manifest: JSON.parse(readFileSync(join(root, n, 'manifest.json'), 'utf8')) }));
}

// ---------- the runner ----------
export function currentVersion(db) {
  if (!hasTable(db, 'schema_migrations')) return 0;
  return db.prepare('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations').get().v;
}

export function migrate(db, { file, migrations = MIGRATIONS, appVersion = APP_VERSION, log = () => {} } = {}) {
  const hadData = hasTable(db, 'production') || hasTable(db, 'schema_migrations');
  const had = hasTable(db, 'schema_migrations')
    ? new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)) : new Set();
  const pending = migrations.filter(m => !had.has(m.version));
  if (!pending.length) return { from: currentVersion(db), to: currentVersion(db), applied: [], backup: null, fresh: false };

  const from = currentVersion(db);
  const to = Math.max(...migrations.map(m => m.version));
  const before = hadData ? countTables(db) : {};
  let backup = null;
  if (hadData && Object.values(before).some(n => n > 0) && file) {
    try { backup = takeBackup(db, file, { appVersion, from: from || 'unversioned (v1.2.0 or older)', to, counts: before }); }
    catch (e) {
      throw new Error(`Refusing to upgrade: the safety backup could not be made (${e.message}). Nothing has been changed. Free some disk space or fix the folder permissions and start again.`);
    }
    log(`backup written to ${backup.dir}`);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, app_version TEXT, applied_at TEXT NOT NULL, backup TEXT)`);
  const applied = [];
  for (const m of pending) {
    try {
      db.exec('BEGIN IMMEDIATE');
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, app_version, applied_at, backup) VALUES (?,?,?,?,?)')
        .run(m.version, m.name, appVersion, new Date().toISOString(), backup?.dir || null);
      db.exec('COMMIT');
      applied.push(m.version);
      log(`migration ${m.version} applied: ${m.name}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
      throw new Error(`Migration ${m.version} (${m.name}) failed and was rolled back: ${e.message}.${backup ? ` A full backup is in ${backup.dir}.` : ''} The database is unchanged.`);
    }
  }

  // nothing may have been lost
  if (hadData) {
    const after = countTables(db);
    const lost = Object.entries(before).filter(([t, n]) => (after[t] ?? 0) < n).map(([t, n]) => `${t}: ${n} before, ${after[t] ?? 0} now`);
    if (lost.length) throw new Error(`Row counts dropped after the upgrade (${lost.join('; ')}). Stop, then run: node scripts/rollback.js latest.${backup ? ` Backup: ${backup.dir}` : ''}`);
  }
  return { from, to, applied, backup, fresh: !hadData };
}

// ---------- put a backup back (used by scripts/rollback.js) ----------
export function restoreBackup(backupDir, file) {
  const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'));
  const src = join(backupDir, 'kaizen.db');
  if (!existsSync(src)) throw new Error(`No kaizen.db in ${backupDir}`);
  // keep what is there now, so work logged since the upgrade is not lost either
  const sideBase = join(dirname(file), 'rolled-back', stamp());
  let side = sideBase, k = 1;
  while (existsSync(side)) side = `${sideBase}-${++k}`;
  mkdirSync(side, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) renameSync(file + suffix, join(side, basename(file) + suffix));
  copyFileSync(src, file);
  for (const f of ['secrets.json', 'keystore.key']) {
    const b = join(backupDir, f), live = join(dirname(file), f);
    if (existsSync(b) && !existsSync(live)) copyFileSync(b, live);
  }
  return { manifest, keptAt: side };
}
export { rmSync };
