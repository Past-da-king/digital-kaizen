// ============================================================
// Proves the two ingest guards, deterministically — no waiting for a
// random outage. Drives handlePayload() with crafted payloads and
// checks what actually landed in the database.
//
//   node scripts/verify-guards.js
// ============================================================

import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const TEST_DB = join(tmpdir(), 'dk-guard-test.db');
process.env.DK_DB = TEST_DB;
for (const tail of ['', '-wal', '-shm']) { try { unlinkSync(TEST_DB + tail); } catch {} }

const { handlePayload } = await import('../src/ingest.js');
const { db } = await import('../src/db.js');

const rows = () => db.prepare('SELECT COUNT(*) n FROM production WHERE machine_id = ?').get('MA1').n;
const events = (like) => db.prepare("SELECT COUNT(*) n FROM machine_events WHERE status LIKE ?").get(like).n;
const openDt = () => db.prepare("SELECT COUNT(*) n FROM downtime_events WHERE state='OPEN'").get().n;

// A clock we control, so an "outage" is a real elapsed gap rather than
// two payloads a microsecond apart.
let clock = Date.now();
const tick = (sec) => { clock += sec * 1000; return new Date(clock); };

const p = (shots, status = 'RUNNING', extra = {}) => ({
  machine_id: 'MA1', machine_name: 'Haitian MA1', status,
  position: 'CLOSED', distance_mm: 118, shots, total_shots: shots,
  last_cycle_sec: 28.4, downtime_minutes: 0, no_cycle_minutes: 0,
  ...extra,
});

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, want ${want})`);
  ok ? pass++ : fail++;
};

console.log('\nGUARD TESTS\n');

// --- baseline: three normal shots in a row
handlePayload(p(10), 'mqtt', tick(0));    // first payload only sets the baseline
handlePayload(p(11), 'mqtt', tick(28));
handlePayload(p(12), 'mqtt', tick(28));
handlePayload(p(13), 'mqtt', tick(28));
console.log('normal running');
check('one row per shot', rows(), 3);

// --- GUARD 2: the network was down and the count jumped by 5
const before = rows();
handlePayload(p(18), 'mqtt', tick(140));   // five cycles' worth of outage
console.log('\nafter a jump of +5 (network was down 140s)');
check('all 5 shots recovered, none lost', rows() - before, 5);
check('the reconnect is recorded', events('RECONNECT%'), 1);

// --- GUARD 1: the device rebooted, counter restarted at 0
const beforeReboot = rows();
handlePayload(p(0), 'mqtt', tick(30));
console.log('\nafter a reboot (counter back to 0)');
check('no phantom shot written', rows() - beforeReboot, 0);
check('the restart is recorded', events('DEVICE RESTART'), 1);

// counting must resume cleanly from the new baseline
handlePayload(p(1), 'mqtt', tick(28));
handlePayload(p(2), 'mqtt', tick(28));
check('counting resumes after reboot', rows() - beforeReboot, 2);

// --- SANITY CAP: a jump that implies a superhuman rate is junk, not a run
const beforeJunk = rows();
handlePayload(p(4242), 'mqtt', tick(0.5));
console.log('\nafter a bogus +4240 in half a second');
check('no rows manufactured', rows() - beforeJunk, 0);
check('the anomaly is recorded', events('COUNTER ANOMALY%'), 1);
handlePayload(p(4243), 'mqtt', tick(28));
check('counting resumes from the new baseline', rows() - beforeJunk, 1);

console.log(`\n${fail === 0 ? 'ALL GUARDS HOLD' : fail + ' FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
