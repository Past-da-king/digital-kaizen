import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const M = await import('../src/migrate.js');

// A database exactly as v1.2.0 left it: only the sensor tables, no version table, real-looking rows.
function makeV120(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE production (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, machine_id TEXT NOT NULL, cycletime REAL, downtime REAL);
    CREATE TABLE machine_events (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, machine_id TEXT NOT NULL, status TEXT NOT NULL, ended_at TEXT, seconds REAL);
    CREATE TABLE downtime_events (id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, seconds REAL,
      level TEXT NOT NULL DEFAULT 'downtime', state TEXT NOT NULL DEFAULT 'OPEN', reason_code TEXT, reason_label TEXT, note TEXT, attributed_at TEXT, lost_shots INTEGER, lost_value REAL);
    CREATE TABLE micro_stops (id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id TEXT NOT NULL, at TEXT NOT NULL, seconds REAL NOT NULL);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, machine_id TEXT NOT NULL, at TEXT NOT NULL, level TEXT NOT NULL,
      channel TEXT NOT NULL, recipient TEXT NOT NULL, message TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, detail TEXT);
    CREATE TABLE device_assignments (device_id TEXT PRIMARY KEY, machine_id TEXT, assigned_at TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, note TEXT);
    CREATE TABLE heartbeat (machine_id TEXT PRIMARY KEY, last_seen TEXT NOT NULL, source TEXT);
  `);
  const shot = db.prepare('INSERT INTO production (timestamp, machine_id, cycletime, downtime) VALUES (?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < 6000; i++) shot.run(`2026-10-${String(1 + (i % 28)).padStart(2, '0')} 0${i % 10}:${String(i % 60).padStart(2, '0')}:00`, i % 2 ? 'MA1' : 'MA2', i % 97 === 0 ? 240.5 : 27.1 + (i % 7) / 10, 0);
  db.exec('COMMIT');
  db.prepare(`INSERT INTO machine_events (timestamp, machine_id, status, ended_at, seconds) VALUES ('2026-10-04 06:00:00','MA1','RUNNING','2026-10-04 08:00:00',7200)`).run();
  db.prepare(`INSERT INTO machine_events (timestamp, machine_id, status) VALUES ('2026-10-04 08:00:00','MA1','DOWNTIME')`).run();
  db.prepare(`INSERT INTO downtime_events (machine_id, started_at, ended_at, seconds, state, reason_code, reason_label, note, attributed_at, lost_shots, lost_value)
              VALUES ('MA1','2026-10-04 08:00:00','2026-10-04 08:22:00',1320,'CLOSED','material','Material issue','resin dryer','2026-10-04 08:30:00',47,47)`).run();
  db.prepare(`INSERT INTO downtime_events (machine_id, started_at, state) VALUES ('MA2','2026-10-05 10:00:00','OPEN')`).run();
  db.prepare(`INSERT INTO micro_stops (machine_id, at, seconds) VALUES ('MA2','2026-10-05 09:00:00',74)`).run();
  db.prepare(`INSERT INTO alerts (event_id, machine_id, at, level, channel, recipient, message, delivered, detail) VALUES (1,'MA1','2026-10-04 08:05:00','operator','email','Line operator','DOWNTIME',0,'not delivered')`).run();
  db.prepare(`INSERT INTO device_assignments (device_id, machine_id, assigned_at, first_seen, last_seen, note) VALUES ('aabbccddeeff','MA1','2026-09-30 10:00:00','2026-09-30 09:50:00','2026-10-05 10:00:00','bolted on')`).run();
  db.prepare(`INSERT INTO heartbeat (machine_id, last_seen, source) VALUES ('MA1','2026-10-05 10:00:00','mqtt')`).run();
  return db;
}

const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'dk-mig-')); return { dir, file: join(dir, 'kaizen.db') }; };

test('upgrading a v1.2.0 database keeps every record, takes a backup first, and adds the new tables', () => {
  const { dir, file } = fresh();
  const old = makeV120(file);
  const legacyTables = ['production', 'machine_events', 'downtime_events', 'micro_stops', 'alerts', 'device_assignments', 'heartbeat'];
  const prints = M.fingerprint(old, legacyTables), counts = M.countTables(old);
  old.close();

  const db = new DatabaseSync(file);
  const r = M.migrate(db, { file });
  assert.deepEqual(r.applied, [1, 2, 3, 4]);
  assert.equal(M.currentVersion(db), 4);

  // every old row is byte for byte unchanged (the new columns are the only difference, and they are NULL)
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  assert.ok(cols('downtime_events').includes('attributed_by') && cols('downtime_events').includes('planned'));
  const after = M.countTables(db);
  for (const t of legacyTables) assert.equal(after[t], counts[t], `${t} row count`);
  for (const t of legacyTables.filter(t => t !== 'downtime_events')) assert.deepEqual(M.fingerprint(db, [t]), { [t]: prints[t] }, `${t} content`);
  const ev = db.prepare('SELECT * FROM downtime_events ORDER BY id').all();
  assert.equal(ev[0].reason_label, 'Material issue'); assert.equal(ev[0].note, 'resin dryer'); assert.equal(ev[0].seconds, 1320); assert.equal(ev[0].attributed_by, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM production').get().n, 6000);

  for (const t of ['downtime_logs', 'defect_logs', 'issues', 'mail_queue', 'settings', 'users', 'sessions', 'report_facts', 'schema_migrations']) assert.ok(after[t] !== undefined, `${t} exists`);

  // the backup exists, opens, and is the OLD database
  assert.ok(r.backup && existsSync(join(r.backup.dir, 'kaizen.db')) && existsSync(join(r.backup.dir, 'manifest.json')));
  const man = JSON.parse(readFileSync(join(r.backup.dir, 'manifest.json'), 'utf8'));
  assert.equal(man.counts.production, 6000);
  const bk = new DatabaseSync(join(r.backup.dir, 'kaizen.db'));
  assert.deepEqual(M.fingerprint(bk, legacyTables), prints, 'the backup is exactly the pre-upgrade database');
  assert.equal(M.currentVersion(bk), 0, 'and it is still unversioned, so the old app opens it as before');
  bk.close();

  // running it again is a no-op: no second backup, nothing changes
  const again = M.migrate(db, { file });
  assert.deepEqual(again.applied, []); assert.equal(again.backup, null);
  assert.equal(readdirSync(join(dir, 'backups')).length, 1);
  assert.deepEqual(M.countTables(db), after);
  db.close();
});

test('a fresh install needs no backup', () => {
  const { dir, file } = fresh();
  const db = new DatabaseSync(file);
  const r = M.migrate(db, { file });
  assert.deepEqual(r.applied, [1, 2, 3, 4]); assert.equal(r.backup, null);
  assert.equal(existsSync(join(dir, 'backups')), false);
  db.close();
});

test('rollback puts the old database back and keeps what was logged after the upgrade', () => {
  const { dir, file } = fresh();
  const old = makeV120(file); const legacy = ['production', 'downtime_events', 'alerts'];
  const prints = M.fingerprint(old, legacy); old.close();
  const db = new DatabaseSync(file);
  const r = M.migrate(db, { file });
  // life goes on after the upgrade: new sensor rows and a new operator log
  db.prepare(`INSERT INTO production (timestamp, machine_id, cycletime, downtime) VALUES ('2026-11-04 09:00:00','MA1',27.0,0)`).run();
  db.prepare(`INSERT INTO defect_logs (machine_id, qty, type_code, type_label, shift, shift_day, occurred_at, logged_at) VALUES ('MA1',4,'flash','Flash','A','2026-11-04','2026-11-04 09:01:00','2026-11-04 09:01:00')`).run();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();

  const out = M.restoreBackup(r.backup.dir, file);
  const back = new DatabaseSync(file);
  assert.deepEqual(M.fingerprint(back, legacy), prints, 'the restored database equals the pre-upgrade one');
  assert.equal(back.prepare('SELECT COUNT(*) n FROM production').get().n, 6000);
  assert.equal(M.currentVersion(back), 0);
  back.close();
  // the post-upgrade work is not thrown away
  const kept = new DatabaseSync(join(out.keptAt, 'kaizen.db'));
  assert.equal(kept.prepare('SELECT COUNT(*) n FROM production').get().n, 6001);
  assert.equal(kept.prepare('SELECT COUNT(*) n FROM defect_logs').get().n, 1);
  kept.close();

  // and the restored database upgrades again cleanly
  const db2 = new DatabaseSync(file);
  assert.deepEqual(M.migrate(db2, { file }).applied, [1, 2, 3, 4]);
  assert.equal(db2.prepare('SELECT COUNT(*) n FROM production').get().n, 6000);
  db2.close();
});

test('a failing migration rolls back completely and says where the backup is', () => {
  const { file } = fresh();
  makeV120(file).close();
  const db = new DatabaseSync(file);
  const before = M.countTables(db);
  const bad = [...M.MIGRATIONS.slice(0, 1), { version: 2, name: 'broken', up(d) { d.exec('CREATE TABLE half_done (x)'); throw new Error('boom'); } }];
  assert.throws(() => M.migrate(db, { file, migrations: bad }), (e) => /Migration 2 \(broken\) failed and was rolled back: boom/.test(e.message) && /backup is in/.test(e.message));
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'half_done'`).get().n, 0, 'the half-made table is gone');
  const after = M.countTables(db);
  for (const t of Object.keys(before)) assert.equal(after[t], before[t]);
  db.close();
});

test('if the backup cannot be made the app refuses to touch the data', () => {
  const { dir, file } = fresh();
  makeV120(file).close();
  // a FILE where the backups folder must go makes the backup impossible
  copyFileSync(file, join(dir, 'backups'));
  const db = new DatabaseSync(file);
  assert.throws(() => M.migrate(db, { file }), /Refusing to upgrade: the safety backup could not be made/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'schema_migrations'`).get().n, 0, 'nothing was changed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM production').get().n, 6000);
  db.close();
});

test('lost rows are detected after an upgrade', () => {
  const { file } = fresh();
  makeV120(file).close();
  const db = new DatabaseSync(file);
  const evil = [...M.MIGRATIONS.slice(0, 1), { version: 2, name: 'careless', up(d) { d.exec('DELETE FROM production WHERE id <= 10'); } }];
  assert.throws(() => M.migrate(db, { file, migrations: evil }), /Row counts dropped after the upgrade \(production: 6000 before, 5990 now\)/);
  db.close();
});

test('the app itself opens the database through the same runner', async () => {
  const db = (await import('../src/db.js')).db;
  assert.equal(M.currentVersion(db), 4);
  const m = (await import('../src/db.js')).migration;
  assert.deepEqual(m.applied, [1, 2, 3, 4]);
});
