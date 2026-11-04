// Made-up numbers for the design review. Same shape as the live API model, so the
// real renderer draws it. Wed 4 Nov 2026, 10:24. MA1 is running well; MA2 has been
// down 14 minutes and the supervisor has been emailed.

const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const day = (back) => { const d = new Date(2026, 10, 4 - back); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const cycles = (ideal, n = 60, stop = null) => Array.from({ length: n }, (_, i) => {
  if (stop && i === stop) return { timestamp: '2026-11-04 09:40', cycletime: 142, class: 'small_stop' };
  const c = Math.round((ideal * (1 + (rnd() - .35) * .12)) * 10) / 10;
  return { timestamp: `2026-11-04 10:${String(i % 60).padStart(2, '0')}`, cycletime: c, class: c > ideal * 1.12 ? 'cycle' : 'cycle' };
});
const hourly = (per, from = 6, to = 10) => Array.from({ length: to - from + 1 }, (_, i) => ({ bucket: `2026-11-04 ${String(from + i).padStart(2, '0')}:00`, value: Math.round(per * (i === to - from ? .4 : .93 + rnd() * .1)) }));

export const model = {
  now: new Date(2026, 10, 4, 10, 24),
  limits: { downtimeMin: 10, defectsPerShift: 25 },
  ladder: [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }, { level: 5 }],
  oee: {
    day: '2026-11-04', currentShift: 'A',
    plant: {
      day: { oee: 61.4, availability: 82.7, performance: 91.3, quality: 97.6 },
      current: { oee: 61.4, availability: 82.7, performance: 91.3, quality: 97.6 },
      shifts: { A: { oee: 61.4 }, B: { oee: 72.8 } },
    },
    machines: [
      { machine_id: 'MA1', current: { availability: 94.8, performance: 93.2, quality: 98.1, oee: 86.7 }, day: { oee: 86.7 }, shifts: { A: { oee: 86.7 }, B: { oee: 78.2 } } },
      { machine_id: 'MA2', current: { availability: 66.1, performance: 89.4, quality: 96.5, oee: 57.0 }, day: { oee: 57.0 }, shifts: { A: { oee: 57.0 }, B: { oee: 67.9 } } },
    ],
  },
  trend: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), oee: [64, 68, 71, 66, 59, null, null, 70, 73, 75, 72, 74, 78, 61.4][i] })).filter(t => t.oee != null || true),
  machines: [
    {
      id: 'MA1', name: 'Haitian MA1', part: '', mould: { name: 'Lid 2-cavity', idealCycleSec: 26, cavities: 2 },
      live: { status: 'RUNNING', offline: false, last_cycle_sec: 27.1 }, engine: { level: 'ok', gap_human: '12s', gap_seconds: 12 }, rules: { downtimeSec: 120 },
      summary: { shots: 812, avgCycleSec: 27.4, bestCycleSec: 25.6, smallStops: 6, smallStopMin: 9.4, downtimeEvents: 1, downtimeMin: 7.2 },
      shifts: { A: { shots: 812, downtimeMin: 16.6 }, B: { shots: 1204, downtimeMin: 38.0 } },
      defectsToday: 14, recent: cycles(26, 60, 31), hourly: hourly(150),
    },
    {
      id: 'MA2', name: 'Haitian MA2', part: '', mould: { name: 'Crate base 1-cavity', idealCycleSec: 19, cavities: 1 },
      live: { status: 'DOWNTIME', offline: false, last_cycle_sec: 19.4 }, engine: { level: 'downtime', gap_human: '14m 20s', gap_seconds: 860, event_id: 31 }, rules: { downtimeSec: 90 },
      eventReason: 'Reason not logged yet',
      summary: { shots: 691, avgCycleSec: 19.6, bestCycleSec: 18.2, smallStops: 9, smallStopMin: 14.8, downtimeEvents: 2, downtimeMin: 31.5 },
      shifts: { A: { shots: 691, downtimeMin: 46.3 }, B: { shots: 1680, downtimeMin: 21.0 } },
      defectsToday: 9, recent: cycles(19, 60, 44), hourly: hourly(188),
    },
  ],
  quality: {
    downtime: {
      totalMin: 241, plannedMin: 95, unexplained: { n: 1, minutes: 7.2 },
      byReason: [
        { label: 'Scheduled mould change', planned: 1, minutes: 62 }, { label: 'Unscheduled maintenance', planned: 0, minutes: 58 },
        { label: 'Material issue', planned: 0, minutes: 44 }, { label: 'Waiting for operator', planned: 0, minutes: 31 },
        { label: 'Scheduled maintenance', planned: 1, minutes: 33 }, { label: 'Unscheduled mould change', planned: 0, minutes: 13 },
      ],
    },
    defects: {
      total: 183, byShift: [{ shift: 'A', qty: 23 }, { shift: 'B', qty: 160 }],
      byType: [{ label: 'Short shot', qty: 61 }, { label: 'Flash', qty: 44 }, { label: 'Sink marks', qty: 31 }, { label: 'Black specks / contamination', qty: 27 }, { label: 'Warping', qty: 20 }],
    },
    series: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), defects: [22, 31, 18, 27, 40, 0, 0, 25, 19, 33, 21, 17, 29, 23][i], downtimeMin: 0 })),
  },
  escalation: {
    open: [{ id: 9, machine_id: 'MA2', machine_name: 'Haitian MA2', summary: 'Machine down, no shots past the 10 min limit', opened_at: '2026-11-04 10:10:00', age_min: 14, state: 'OPEN', level_reached: 1 }],
    mail: { configured: true, host: 'smtp.evernu.co.za:587', counts: { sent: 3, queued: 0, failed: 0 }, lastOkAt: '2026-11-04 10:10:04' },
  },
  feed: [
    { kind: 'defects', machine: 'MA1', text: '4 x Short shot', by: 'Thandi Mokoena', at: '2026-11-04 10:12:00', note: 'cavity 3' },
    { kind: 'downtime', machine: 'MA2', text: 'Material issue, 18 min', by: 'Sipho Dlamini', at: '2026-11-04 09:48:00' },
    { kind: 'defects', machine: 'MA2', text: '9 x Flash', by: 'Sipho Dlamini', at: '2026-11-04 09:21:00', note: 'tool worn?' },
    { kind: 'downtime', machine: 'MA1', text: 'Scheduled mould change, 42 min', by: 'Nomsa Khumalo', at: '2026-11-04 07:05:00' },
    { kind: 'defects', machine: 'MA1', text: '10 x Sink marks', by: 'Nomsa Khumalo', at: '2026-11-04 06:40:00' },
  ],
};
model.oee.machines[0].name = 'Haitian MA1'; model.oee.machines[1].name = 'Haitian MA2';
