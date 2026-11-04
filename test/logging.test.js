import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const settings = await import('../src/settings.js');
const store = await import('../src/store.js');
const users = await import('../src/users.js');
const oee = await import('../src/oee.js');
const dbm = await import('../src/db.js');
const events = await import('../src/events.js');
const ingest = await import('../src/ingest.js');
const { startServer } = await import('../src/server.js');

let server, base;
before(async () => {
  server = await startServer();
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const tok = (m) => users.machineToken(m, settings.machineEpoch(m));
const get = (path) => fetch(base + path).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const ctx = (m = 'MA1') => get(`/api/log/context?m=${m}&k=${tok(m)}`);
const payload = (status, shots = 1) => ({ machine_id: 'MA1', machine_name: 'Haitian MA1', status, position: 'CLOSED', distance_mm: 118, shots, total_shots: shots, last_cycle_sec: 28, downtime_minutes: 0 });

test('the QR link needs the machine token; random links cannot read or post', async () => {
  assert.equal((await get('/api/log/context?m=MA1')).status, 403);
  assert.equal((await get('/api/log/context?m=MA1&k=wrong')).status, 403);
  assert.equal((await get(`/api/log/context?m=MA1&k=${tok('MA2')}`)).status, 403, "another machine's token does not open this one");
  assert.equal((await get(`/api/log/context?m=NOPE&k=x`)).status, 404);
  assert.equal((await post('/api/log/defects', { machine: 'MA1', count: 1, typeCode: 'flash' })).status, 403);
  assert.equal((await ctx()).status, 200);
});

test('retiring a machine token kills its old QR stickers', async () => {
  const old = tok('MA2');
  settings.rotateMachineToken('MA2');
  assert.equal((await get(`/api/log/context?m=MA2&k=${old}`)).status, 403);
  assert.equal((await ctx('MA2')).status, 200);
});

test('the page follows the machine state from the sensors: running, down, unknown', async () => {
  assert.equal((await ctx()).body.state, 'unknown', 'no sensor yet is not "running"');
  ingest.handlePayload(payload('RUNNING', 10), 'mqtt', new Date());
  assert.equal((await ctx()).body.state, 'running');
  ingest.handlePayload(payload('DOWNTIME', 10), 'mqtt', new Date());
  assert.equal((await ctx()).body.state, 'down');
  ingest.handlePayload(payload('RUNNING', 11), 'mqtt', new Date());
  assert.equal((await ctx()).body.state, 'running');
  const c = (await ctx()).body;
  assert.ok(c.reasons.length >= 6 && c.defectTypes.length >= 8, 'lists come from settings');
  assert.equal(c.pinRequired, false);
});

test('log defects: stored with the shift and the name, shown per machine, repeat taps are not double counted', async () => {
  const op = (await users.createUser({ name: 'Thandi Mokoena', role: 'operator' })).user;
  assert.ok((await ctx()).body.operators.some(o => o.name === 'Thandi Mokoena'));
  const body = { machine: 'MA1', key: tok('MA1'), count: 4, typeCode: 'short_shot', note: 'cavity 3', operatorId: op.id, clientId: 'abc-1' };
  const a = await post('/api/log/defects', body);
  assert.equal(a.status, 200); assert.equal(a.body.ok, true); assert.equal(a.body.duplicate, false);
  const again = await post('/api/log/defects', body);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.shiftTotal, 4, 'the retry did not add 4 more');

  const rows = (await get('/api/logs/defects')).body.rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operator, 'Thandi Mokoena');
  assert.equal(rows[0].type_label, 'Short shot');
  assert.ok(['A', 'B'].includes(rows[0].shift));

  assert.equal((await post('/api/log/defects', { ...body, clientId: 'x', count: 0 })).status, 400);
  assert.equal((await post('/api/log/defects', { ...body, clientId: 'y', typeCode: 'nope' })).status, 400);
  assert.equal((await post('/api/log/defects', { ...body, clientId: 'z', operatorId: 9999 })).status, 400, 'a name that is not on the list is refused');
});

test('log downtime by hand: the server clock decides the times; start/end or duration', async () => {
  const k = tok('MA1');
  const a = await post('/api/log/downtime', { machine: 'MA1', key: k, reasonCode: 'unscheduled_maintenance', minutes: 25, endedAgoMin: 0, note: '=HYPERLINK("x")', clientId: 'dt-1' });
  assert.equal(a.status, 200); assert.equal(a.body.minutes, 25);
  const b = await post('/api/log/downtime', { machine: 'MA1', key: k, reasonCode: 'scheduled_mould_change', startClock: '06:10', endClock: '07:00', clientId: 'dt-2' });
  assert.equal(b.status, 200); assert.equal(b.body.minutes, 50);
  assert.equal((await post('/api/log/downtime', { machine: 'MA1', key: k, reasonCode: 'nope', minutes: 5 })).status, 400);
  assert.equal((await post('/api/log/downtime', { machine: 'MA1', key: k, reasonCode: 'material_issue', minutes: 0 })).status, 400);
  assert.equal((await post('/api/log/downtime', { machine: 'MA1', key: k, reasonCode: 'material_issue', minutes: 5000 })).status, 400);

  const rows = (await get('/api/logs/downtime?from=2020-01-01&to=2099-01-01')).body.rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.client_id === 'dt-2').planned, 1, 'a scheduled mould change is planned downtime');
  const q = (await get('/api/quality?from=2020-01-01&to=2099-01-01')).body;
  assert.equal(q.downtime.totalMin, 75);
  assert.equal(q.downtime.plannedMin, 50);
  assert.equal(q.defects.total, 4);
  assert.ok(q.downtime.byReason.length === 2 && q.series.length >= 1);

  const csv = await fetch(base + '/api/logs/downtime.csv?from=2020-01-01&to=2099-01-01').then(r => r.text());
  assert.match(csv, /minutes,reason,planned/);
  assert.ok(csv.includes(`"'=HYPERLINK`), 'a typed note cannot become a spreadsheet formula');
  const dcsv = await fetch(base + '/api/logs/defects.csv?from=2020-01-01&to=2099-01-01').then(r => r.text());
  assert.match(dcsv, /Thandi Mokoena/);
});

test('explaining a stop the sensor saw: attributes the event and writes the downtime log when it ends', async () => {
  const started = new Date(Date.now() - 20 * 60000);
  const evId = dbm.openDowntime('MA1', started);
  ingest.handlePayload(payload('DOWNTIME', 11), 'mqtt', new Date());
  const c = (await ctx()).body;
  assert.equal(c.state, 'down');
  assert.equal(c.event.id, evId);

  const r = await post('/api/log/downtime', { machine: 'MA1', key: tok('MA1'), eventId: evId, reasonCode: 'material_issue', note: 'resin dry' });
  assert.equal(r.status, 200);
  assert.equal(dbm.downtimeById(evId).reason_code, 'material_issue');
  assert.equal(store.downtimeLogForEvent(evId), null, 'still going: the log is written when the stop ends');

  dbm.closeDowntime(evId, new Date(), 20 * 60, 40, 40);
  const log = events.syncLogForEvent(evId);
  assert.ok(log);
  const row = store.downtimeLogForEvent(evId);
  assert.equal(row.source, 'sensor'); assert.equal(row.minutes, 20); assert.equal(row.reason_label, 'Material issue');
  assert.equal(events.syncLogForEvent(evId), null, 'never logged twice');
  assert.equal((await post('/api/log/downtime', { machine: 'MA2', key: tok('MA2'), eventId: evId, reasonCode: 'material_issue' })).status, 400, 'an event of another machine');
});

test('photos: a real image is stored against the entry; anything else is refused', async () => {
  const k = tok('MA1');
  const d = await post('/api/log/defects', { machine: 'MA1', key: k, count: 1, typeCode: 'flash', clientId: 'ph-1' });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
  const up = (id, buf, type = 'image/jpeg') => fetch(`${base}/api/log/photo?m=MA1&k=${k}&id=${id}`, { method: 'POST', headers: { 'content-type': type }, body: buf }).then(async r => ({ status: r.status, body: await r.json() }));
  assert.equal((await up(d.body.id, Buffer.from('<?php evil ?>'), 'text/plain')).status, 400);
  assert.equal((await up(d.body.id, jpeg)).status, 200);
  const row = store.defectLog(d.body.id);
  assert.match(row.photo, /^\d+-[0-9a-f]+\.jpg$/);
  const img = await fetch(`${base}/photos/${row.photo}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/photos/..%2F..%2Fkaizen.db`)).status, 404);
  assert.equal((await fetch(`${base}/api/log/photo?m=MA1&k=bad&id=${d.body.id}`, { method: 'POST', body: jpeg })).status, 403);
});

test('escalate from the floor, and defects over the shift limit escalate by themselves', async () => {
  const k = tok('MA1');
  const e = await post('/api/log/escalate', { machine: 'MA1', key: k, reason: 'Hydraulic leak', operatorId: store && undefined });
  assert.equal(e.status, 200);
  const again = await post('/api/log/escalate', { machine: 'MA1', key: k, reason: 'Hydraulic leak' });
  assert.equal(again.body.existing, true, 'a second tap does not email everyone again');
  const issue = store.issueById(e.body.id);
  assert.equal(issue.kind, 'manual'); assert.equal(issue.summary, 'Hydraulic leak');
  assert.equal(store.mailForIssue(issue.id).filter(m => m.kind === 'escalation').length, 1, 'level 1 is queued straight away');

  settings.update({ thresholds: { defectsPerShift: 10 } });
  const before = store.liveIssues().length;
  const big = await post('/api/log/defects', { machine: 'MA2', key: tok('MA2'), count: 12, typeCode: 'warping', clientId: 'big-1' });
  assert.equal(big.body.escalated, true);
  assert.equal(store.liveIssues().length, before + 1);
  const dash = (await get('/api/escalation')).body;
  assert.ok(dash.open.some(i => i.kind === 'defects' && i.machine_id === 'MA2'));
  assert.equal(dash.mail.configured, false, 'the dashboard says mail is not set up');
});

test('names can need a PIN when Settings say so; wrong PINs are rate limited', async () => {
  const k = tok('MA1');
  const op = (await users.createUser({ name: 'Pieter', role: 'operator', pin: '2468' })).user;
  const base1 = { machine: 'MA1', key: k, count: 1, typeCode: 'flash', operatorId: op.id };
  assert.equal((await post('/api/log/defects', { ...base1, clientId: 'pin-0' })).status, 200, 'PIN is off by default');

  settings.update({ operatorPinRequired: true });
  assert.equal((await post('/api/log/defects', { ...base1, clientId: 'pin-1' })).status, 401);
  assert.equal((await post('/api/log/defects', { ...base1, clientId: 'pin-2', pin: '2468' })).status, 200);
  assert.equal((await post('/api/log/defects', { machine: 'MA1', key: k, count: 1, typeCode: 'flash', clientId: 'pin-3' })).status, 400, 'a name is required');
  for (let i = 0; i < 6; i++) await post('/api/log/defects', { ...base1, clientId: 'bad' + i, pin: '0000' });
  assert.equal((await post('/api/log/defects', { ...base1, clientId: 'pin-4', pin: '2468' })).status, 429, 'locked out after repeated wrong PINs');
  settings.update({ operatorPinRequired: false });
});

test('OEE: availability x performance x quality, from sensor gaps, planned stops and defects', () => {
  // A quiet hour on a made-up day: 100 shots at the ideal 20 s, one 10 minute stop, 10 defects, 2 cavities.
  settings.update({ machines: { MA2: { activeMould: 0, moulds: [{ name: 'Lid 2-cav', idealCycleSec: 20, cavities: 2 }] } } });
  const from = new Date(2026, 0, 12, 6, 0, 0), now = new Date(2026, 0, 12, 7, 0, 0);
  for (let i = 0; i < 100; i++) dbm.recordShot({ machineId: 'MA2', cycletime: 20, downtime: 0, at: new Date(from.getTime() + (i + 1) * 20000) });
  dbm.recordShot({ machineId: 'MA2', cycletime: 600, downtime: 10, at: new Date(from.getTime() + 2900 * 1000) });
  store.addDefectLog({ machineId: 'MA2', qty: 10, typeCode: 'flash', typeLabel: 'Flash', occurredAt: '2026-01-12 06:30:00', now });

  let o = oee.oeeFor('MA2', from, new Date(2026, 0, 12, 18, 0, 0), now);
  assert.equal(o.shots, 100);
  assert.equal(o.availability, 83.3);   // 3000 of 3600 s
  assert.equal(o.performance, 66.7);    // 100 x 20 s over 3000 s
  assert.equal(o.quality, 95);          // 190 good of 200
  assert.equal(o.oee, 52.8);

  // a PLANNED 5 minute stop (scheduled maintenance) inside that gap leaves planned time, not availability
  store.addDowntimeLog({ machineId: 'MA2', reasonCode: 'scheduled_maintenance', reasonLabel: 'Scheduled maintenance', planned: true, startedAt: '2026-01-12 06:45:00', minutes: 5, now });
  o = oee.oeeFor('MA2', from, new Date(2026, 0, 12, 18, 0, 0), now);
  assert.equal(o.plannedMin, 55);
  assert.equal(o.availability, 90.9);   // 3000 of 3300 s
  assert.equal(o.performance, 66.7);

  // nothing to divide -> a dash, never 100%
  const empty = oee.oeeFor('MA1', new Date(2026, 0, 13, 6, 0, 0), new Date(2026, 0, 13, 18, 0, 0), new Date(2026, 0, 13, 8, 0, 0));
  assert.equal(empty.quality, null); assert.equal(empty.oee, null);
});

test('the OEE and quality endpoints answer for the dashboard', async () => {
  const d = (await get('/api/oee')).body;
  assert.equal(d.machines.length, 2);
  assert.ok('plant' in d && 'current' in d.plant && 'shifts' in d.plant);
  const t = (await get('/api/oee/trend?days=7')).body;
  assert.ok(Array.isArray(t.points));
  assert.equal((await get('/api/config')).body.ladder.length, 5);
  assert.ok(!JSON.stringify((await get('/api/config')).body).includes('evernu.co.za'), 'addresses never go to the public config');
});

test('settings: downtime reasons and defect types are editable and reach the QR page', async () => {
  const r = settings.update({ downtimeReasons: [{ label: 'Colour change', planned: true }, { label: 'Hose burst', planned: false }], defectTypes: ['Dented', 'Dirty'] });
  assert.equal(r.ok, true);
  const c = (await ctx()).body;
  assert.deepEqual(c.reasons.map(x => x.code), ['colour_change', 'hose_burst']);
  assert.deepEqual(c.defectTypes.map(x => x.label), ['Dented', 'Dirty']);
  assert.equal(settings.update({ defectTypes: [] }).ok, false);
});

test('light brake: a script hammering the page is slowed, a person is not', async () => {
  let last = 0;
  for (let i = 0; i < 130; i++) last = (await ctx('MA2')).status;
  assert.equal(last, 429);
});
