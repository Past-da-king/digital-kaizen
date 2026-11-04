// Put a pre-upgrade backup back.
//
//   node scripts/rollback.js latest            the newest backup
//   node scripts/rollback.js <backup folder>   a named one (see: node scripts/upgrade.js --backups)
//
// STOP THE APP FIRST (End the Digital Kaizen scheduled task, or: sudo systemctl stop digital-kaizen).
//
// What it does: moves the current database into data/rolled-back/<time>/ (so whatever was logged since the
// upgrade is kept, not deleted), copies the backup into place, and prints the row counts. Then start the
// PREVIOUS version of the app (git checkout v1.2.0, or unzip the old release) against it.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const file = process.env.DK_DB || fileURLToPath(new URL('../data/kaizen.db', import.meta.url));
process.env.DK_QUIET = '1';
const { listBackups, restoreBackup, countTables } = await import('../src/migrate.js');
const { DatabaseSync } = await import('node:sqlite');

const arg = process.argv[2];
if (!arg) { console.log('\n  Usage: node scripts/rollback.js latest | <backup folder>\n  Backups:'); for (const b of listBackups(file)) console.log('   ', b.dir); process.exit(1); }
const all = listBackups(file);
const dir = arg === 'latest' ? all.at(-1)?.dir : (existsSync(arg) ? arg : join(file, '..', 'backups', arg));
if (!dir || !existsSync(join(dir, 'manifest.json'))) { console.log(`\n  No such backup: ${arg}\n`); process.exit(1); }

const r = restoreBackup(dir, file);
const db = new DatabaseSync(file);
const now = countTables(db); db.close();
console.log(`\n  Restored ${dir}`);
console.log(`  (the database you had until now is kept in ${r.keptAt})`);
let bad = 0;
for (const [t, n] of Object.entries(r.manifest.counts)) { const ok = now[t] === n; if (!ok) bad++; console.log(`    ${t.padEnd(22)} backup ${String(n).padStart(8)}   restored ${String(now[t] ?? 0).padStart(8)}${ok ? '' : '   <-- DIFFERENT'}`); }
console.log(bad ? '\n  PROBLEM: counts differ. Keep both folders and ask for help.\n' : '\n  OK. Now start the previous version of the app.\n');
process.exit(bad ? 1 : 0);
