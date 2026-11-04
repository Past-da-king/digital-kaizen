// The safe way to look at, or perform, an upgrade of a live install.
//
//   node scripts/upgrade.js --check   Dry run. Copies the database to a temporary file, upgrades THE COPY, and
//                                     reports what would change and that no row would be lost. Touches nothing real.
//   node scripts/upgrade.js           Upgrades the real database now (this also happens by itself when the app
//                                     starts): backup first, migrate, verify. Prints the result.
//   node scripts/upgrade.js --backups Lists the backups taken so far.
//
// The database is the one named by DK_DB (default data/kaizen.db).

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const real = process.env.DK_DB || fileURLToPath(new URL('../data/kaizen.db', import.meta.url));
const check = process.argv.includes('--check');
const list = process.argv.includes('--backups');

if (list) {
  const { listBackups } = await import('../src/migrate.js');
  const all = listBackups(real);
  console.log(all.length ? all.map(b => `  ${b.name}   from v${b.manifest.fromVersion} to ${b.manifest.toVersion}, ${Object.values(b.manifest.counts).reduce((a, n) => a + n, 0).toLocaleString()} rows`).join('\n') : '  No backups yet.');
  process.exit(0);
}
if (!existsSync(real)) { console.log(`\n  No database at ${real}. Nothing to upgrade; a fresh one is created when the app first starts.\n`); process.exit(0); }

let work = real, tmp = null;
if (check) {
  tmp = mkdtempSync(join(tmpdir(), 'dk-upgrade-check-'));
  work = join(tmp, 'kaizen.db');
  copyFileSync(real, work);
  for (const s of ['-wal', '-shm']) if (existsSync(real + s)) copyFileSync(real + s, work + s);
  for (const f of ['secrets.json', 'keystore.key']) { const src = join(real, '..', f); if (existsSync(src)) copyFileSync(src, join(tmp, f)); }
  process.env.DK_SECRETS = join(tmp, 'secrets.json'); process.env.DK_KEYFILE = join(tmp, 'keystore.key');
}
process.env.DK_DB = work; process.env.DK_QUIET = '1';

const { DatabaseSync } = await import('node:sqlite');
const { countTables, currentVersion, APP_VERSION } = await import('../src/migrate.js');
const peek = new DatabaseSync(work);
const beforeV = currentVersion(peek);
const before = countTables(peek);
peek.close();

const { db, migration } = await import('../src/db.js');
const after = countTables(db);
console.log(`\n  ${check ? 'DRY RUN on a copy of' : 'Upgrade of'} ${real}`);
console.log(`  database version: ${beforeV || 'unversioned (v1.2.0 or older)'} -> ${currentVersion(db)}   (app ${APP_VERSION})`);
console.log(`  migrations applied: ${migration.applied.length ? migration.applied.join(', ') : 'none, already up to date'}`);
if (migration.backup) console.log(`  safety backup: ${check ? '(of the copy) ' : ''}${migration.backup.dir}`);
console.log('\n  rows per table, before -> after');
for (const t of Object.keys({ ...before, ...after }).sort()) {
  const b = before[t], a = after[t];
  console.log(`    ${t.padEnd(22)} ${String(b ?? '(new)').padStart(8)} -> ${String(a ?? 0).padStart(8)}${b != null && a < b ? '   <-- LOST ROWS' : ''}`);
}
const lost = Object.keys(before).filter(t => (after[t] ?? 0) < before[t]);
console.log(lost.length ? '\n  PROBLEM: rows are missing. Do not use this database. Run: node scripts/rollback.js latest\n' : `\n  OK: every existing row is still there.${check ? ' Nothing real was changed.' : ''}\n`);
db.close();
if (tmp) rmSync(tmp, { recursive: true, force: true });
process.exit(lost.length ? 1 : 0);
