// ============================================================
// Fills the database with real production history so the
// dashboard opens with something in it. Runs the SAME simulator
// and the SAME firmware, just fast-forwarded — so the history is
// consistent with what the live view will go on to produce.
//
//   node scripts/seed-history.js [days]      default 7
// ============================================================

import { VirtualDevice } from '../src/sim/device.js';
import { MACHINES } from '../src/config.js';
import { recordShot, recordStatus, dataRange, iso, db } from '../src/db.js';
import { DB } from '../src/config.js';
import { confirmDestructive, backupFirst } from './_confirm.js';

// Seeding ADDS about a week of invented shots. On a database that already holds production
// data that would mix made-up numbers into real ones, so it is guarded like a reset.
const DAYS = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 7);
if (dataRange().n > 0) {
  const c = await confirmDestructive({
    what: `${DB.file} already holds ${dataRange().n} shot rows. Seeding would mix INVENTED production data into them.\n  Never do this at the factory.`,
    flag: '--yes-add-demo-data', phrase: 'ADD DEMO DATA',
  });
  if (!c.ok) { console.log(`\n  ${c.why}\n`); process.exit(1); }
  backupFirst(db, DB.file, 'seed');
}
const now = new Date();
const start = new Date(now.getTime() - DAYS * 86400000);

console.log(`Seeding ${DAYS} days of production for ${MACHINES.length} machines...`);

for (const spec of MACHINES) {
  const dev = new VirtualDevice(spec, { startMs: 0 });
  const totalMs = DAYS * 86400000;
  const steps = totalMs / dev.sampleMs;
  let lastShots = 0, written = 0, lastStatus = null;
  const t0 = Date.now();

  for (let i = 0; i < steps; i++) {
    const p = dev.sample();
    if (!p) continue;
    const at = new Date(start.getTime() + dev.t);

    // Night shift runs lighter: skip 22:00–05:00 on MA2 so the
    // history has a shape rather than a flat line.
    if (spec.id === 'MA2') {
      const h = at.getHours();
      if (h >= 22 || h < 5) { lastShots = p.shots; continue; }
    }

    if (p.shots !== lastShots) {
      recordShot({ machineId: spec.id, cycletime: p.last_cycle_sec, downtime: p.downtime_minutes, at });
      lastShots = p.shots;
      written++;
    }
    if (p.status !== lastStatus) {
      recordStatus({ machineId: spec.id, status: p.status, at });
      lastStatus = p.status;
    }
  }
  console.log(`  ${spec.id}  ${written} shot rows  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

console.log('\nDatabase now holds:', dataRange());
