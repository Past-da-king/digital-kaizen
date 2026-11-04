// Checks and stores what the AI extracted from the factory's reports.
// See docs/report-extraction.md.
//
//   node scripts/import-reports.js <folder of .json files>            check only
//   node scripts/import-reports.js <folder of .json files> --write    store the good rows
//
// Safe to repeat: a row for the same machine, day and shift replaces the old one.
// Nothing here touches sensor data or operator logs.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/db.js';

db.exec(`CREATE TABLE IF NOT EXISTS report_facts (
  machine TEXT NOT NULL, date TEXT NOT NULL, shift TEXT NOT NULL,
  planned_minutes REAL, downtime_minutes REAL, downtime_by_reason TEXT,
  shots INTEGER, output_units INTEGER, ideal_cycle_sec REAL, avg_cycle_sec REAL,
  defects INTEGER, defects_by_type TEXT, mould TEXT, notes TEXT,
  source_file TEXT NOT NULL, source_page TEXT, imported_at TEXT NOT NULL,
  PRIMARY KEY (machine, date, shift)
)`);

export function check(row) {
  const p = [];
  if (!['MA1', 'MA2'].includes(row.machine)) p.push(`machine "${row.machine}" is not MA1 or MA2`);
  if (!/^\d{4}-\d\d-\d\d$/.test(row.date || '') || Number.isNaN(Date.parse(row.date))) p.push(`date "${row.date}" is not YYYY-MM-DD`);
  if (!['A', 'B', 'DAY'].includes(row.shift)) p.push(`shift "${row.shift}" must be A, B or DAY`);
  if (!row.source_file) p.push('no source_file');
  for (const k of ['planned_minutes', 'downtime_minutes', 'shots', 'output_units', 'defects']) if (row[k] != null && !(Number(row[k]) >= 0)) p.push(`${k} is not a number of 0 or more`);
  for (const k of ['ideal_cycle_sec', 'avg_cycle_sec']) if (row[k] != null && !(Number(row[k]) > 0)) p.push(`${k} must be above 0`);
  if (row.planned_minutes != null && row.downtime_minutes != null && row.downtime_minutes > row.planned_minutes + 0.5) p.push('downtime is more than planned time');
  if (row.shots != null && row.output_units != null && row.output_units < row.shots) p.push('output is below the shot count');
  if (row.output_units != null && row.defects != null && row.defects > row.output_units) p.push('defects are more than parts made');
  if (Array.isArray(row.downtime_by_reason) && row.downtime_minutes != null) {
    const s = row.downtime_by_reason.reduce((a, r) => a + (Number(r.minutes) || 0), 0);
    if (Math.abs(s - row.downtime_minutes) > 1) p.push(`reasons add up to ${s} min but downtime is ${row.downtime_minutes}`);
  }
  if (Array.isArray(row.defects_by_type) && row.defects != null) {
    const s = row.defects_by_type.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    if (s !== row.defects) p.push(`defect types add up to ${s} but defects is ${row.defects}`);
  }
  return p;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/import-reports.js')) {
  const dir = process.argv[2]; const write = process.argv.includes('--write');
  if (!dir) { console.log('\n  Usage: node scripts/import-reports.js <folder> [--write]\n'); process.exit(1); }
  const put = db.prepare(`INSERT OR REPLACE INTO report_facts (machine,date,shift,planned_minutes,downtime_minutes,downtime_by_reason,shots,output_units,ideal_cycle_sec,avg_cycle_sec,defects,defects_by_type,mould,notes,source_file,source_page,imported_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`);
  let good = 0, bad = 0;
  for (const f of readdirSync(dir).filter(n => n.toLowerCase().endsWith('.json'))) {
    let rows; try { rows = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { console.log(`${f}: not valid JSON (${e.message})`); bad++; continue; }
    for (const r of Array.isArray(rows) ? rows : [rows]) {
      const p = check(r);
      if (p.length) { bad++; console.log(`CHECK  ${f}  ${r.machine} ${r.date} ${r.shift}: ${p.join('; ')}`); continue; }
      good++;
      if (write) put.run(r.machine, r.date, r.shift, r.planned_minutes ?? null, r.downtime_minutes ?? null, r.downtime_by_reason ? JSON.stringify(r.downtime_by_reason) : null,
        r.shots ?? null, r.output_units ?? null, r.ideal_cycle_sec ?? null, r.avg_cycle_sec ?? null, r.defects ?? null, r.defects_by_type ? JSON.stringify(r.defects_by_type) : null,
        r.mould ?? null, r.notes ?? null, r.source_file, r.source_page == null ? null : String(r.source_page));
    }
  }
  console.log(`\n  ${good} good row(s)${write ? ' stored' : ' (nothing written, add --write)'}, ${bad} to check.\n`);
}
