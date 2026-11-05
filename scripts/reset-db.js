// Wipes production data (shots, events, downtime, logs, issues, mail queue).
// It never runs by accident: it refuses unless the person types the phrase in a
// terminal, or passes --yes-delete-everything. A backup is taken first.
//
//   npm run reset
//   npm run reset -- --yes-delete-everything
import { db, wipe, dataRange } from '../src/db.js';
import { DB } from '../src/config.js';
import { confirmDestructive, backupFirst } from './_confirm.js';

const c = await confirmDestructive({
  what: `This DELETES ALL production data in ${DB.file}\n  (shots, events, downtime, defect and downtime logs, issues, the mail queue). ${dataRange().n} shot rows today.\n  Accounts, settings and sensor pairings are kept. Never do this at the factory.`,
  flag: '--yes-delete-everything',
});
if (!c.ok) { console.log(`\n  ${c.why}\n`); process.exit(1); }
backupFirst(db, DB.file, 'reset');
wipe();
console.log('  wiped.', dataRange());
