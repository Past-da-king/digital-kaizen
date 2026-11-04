import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

const settings = await import('../src/settings.js');
const store = await import('../src/store.js');
const esc = await import('../src/escalation.js');
const mail = await import('../src/mail.js');
const dbm = await import('../src/db.js');
const { startSink } = await import('../scripts/smtp-sink.js');

const T0 = new Date(2026, 10, 4, 10, 0, 0);
const at = (min) => new Date(T0.getTime() + min * 60000);
const queued = (issueId) => store.mailForIssue(issueId).filter(m => m.kind === 'escalation');
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// The mail server for these tests is a local sink. No real address is ever contacted.
let sink;
before(async () => {
  sink = await startSink({ port: 0, web: null });
  settings.update({ baseUrl: 'http://192.120.0.7:4310', smtp: { host: '127.0.0.1', port: sink.port, security: 'none', from: 'kaizen@factory.test' } });
});
after(async () => { await sink.close(); });

test('the starting ladder is in the database, not read from code', () => {
  const l = settings.all().ladder;
  assert.equal(l.length, 5);
  assert.deepEqual(l.map(s => s.afterMin), [0, 30, 60, 90, 120]);
  assert.equal(l[0].people[0].email, 'evproductionfloor@gmail.com');
  assert.equal(dbm.db.prepare(`SELECT COUNT(*) n FROM settings WHERE key='ladder'`).get().n, 1);
});

test('level 1 at once, then one level every 30 minutes until the last', () => {
  const { id } = esc.raise({ kind: 'manual', machineId: 'MA1', summary: 'Mould leaking', detail: 'water on the floor', raisedBy: 'Thandi', now: T0 });
  assert.deepEqual(queued(id).map(m => m.to_addr), ['evproductionfloor@gmail.com']);
  esc.tick(at(29));  assert.equal(queued(id).length, 1, 'nothing before 30 min');
  esc.tick(at(30));  assert.equal(queued(id).length, 2);
  esc.tick(at(30));  assert.equal(queued(id).length, 2, 'a level is never sent twice');
  esc.tick(at(61));  assert.equal(queued(id).length, 3);
  esc.tick(at(95));  assert.equal(queued(id).length, 4);
  esc.tick(at(125)); assert.equal(queued(id).length, 5);
  esc.tick(at(900)); assert.equal(queued(id).length, 5, 'the ladder ends');
  assert.deepEqual(queued(id).map(m => m.to_addr), [
    'evproductionfloor@gmail.com', 'mechanical@evernu.co.za', 'production@evernu.co.za', 'ops@evernu.co.za', 'gm@evernu.co.za']);

  const l3 = queued(id)[2];
  assert.match(l3.subject, /Level 3/);
  assert.match(l3.subject, /Haitian MA1/);
  for (const want of ['Machine:', 'Haitian MA1', 'Mould leaking', 'Since:', 'Raised by:', 'Thandi', 'Already told', 'Level 1', 'Level 2', 'Next:', 'Level 4',
    'http://192.120.0.7:4310/ack?t=']) assert.ok(l3.body_text.includes(want), `email text should include "${want}"`);
  assert.match(l3.body_html, /Acknowledge/);
  assert.match(queued(id)[4].body_text, /last level/i);
});

test('acknowledging stops the ladder and tells the people already told', () => {
  const { id } = esc.raise({ kind: 'manual', machineId: 'MA2', summary: 'Operator needs help', raisedBy: 'Sipho', now: T0 });
  esc.tick(at(31)); assert.equal(queued(id).length, 2);
  const token = dbm.db.prepare('SELECT ack_token FROM issues WHERE id = ?').get(id).ack_token;

  assert.equal(esc.acknowledge('not-a-token', 'x', at(32)).ok, false);
  const r = esc.acknowledge(token, 'Nomsa', at(32));
  assert.equal(r.ok, true);
  assert.equal(store.issueById(id).state, 'ACKED');
  assert.equal(store.issueById(id).acked_by, 'Nomsa');

  esc.tick(at(500)); assert.equal(queued(id).length, 2, 'no more levels after the acknowledgement');
  const told = store.mailForIssue(id).filter(m => m.kind === 'recovered').map(m => m.to_addr).sort();
  assert.deepEqual(told, ['evproductionfloor@gmail.com', 'mechanical@evernu.co.za']);
  assert.equal(esc.acknowledge(token, 'again', at(40)).already, true, 'a second click is harmless');
});

test('a sensor stop becomes an issue only past the limit, and resolves when the machine runs again', () => {
  const m = 'MA1';
  const young = dbm.openDowntime(m, at(1000 - 6));
  esc.tick(at(1000));
  assert.equal(store.issueByKey(`downtime:${young}`), null, '6 min is under the 10 min limit');
  esc.tick(at(1005));
  const issue = store.issueByKey(`downtime:${young}`);
  assert.ok(issue, 'raised once it passes 10 min');
  assert.equal(issue.kind, 'downtime');
  esc.tick(at(1006));
  assert.equal(dbm.db.prepare(`SELECT COUNT(*) n FROM issues WHERE source_key = ?`).get(`downtime:${young}`).n, 1, 'one issue per stop');
  assert.equal(queued(issue.id).length, 1);

  dbm.closeDowntime(young, at(1010), 16 * 60, 30, 30);
  esc.tick(at(1010));
  assert.equal(store.issueById(issue.id).state, 'RESOLVED');
  const r = store.mailForIssue(issue.id).filter(x => x.kind === 'recovered');
  assert.equal(r.length, 1);
  assert.match(r[0].subject, /Resolved/);
});

test('defects past the shift limit raise one issue per machine per shift', () => {
  settings.update({ thresholds: { defectsPerShift: 20 } });
  const when = new Date(2026, 10, 5, 9, 0, 0);
  const log = (qty, n) => store.addDefectLog({ machineId: 'MA2', qty, typeCode: 'flash', typeLabel: 'Flash', occurredAt: `2026-11-05 09:${n}0:00`, now: when });
  let r = log(8, '1'); assert.equal(esc.checkDefects('MA2', r.shiftDay, r.shift, when), null);
  r = log(8, '2');     assert.equal(esc.checkDefects('MA2', r.shiftDay, r.shift, when), null, '16 is under 20');
  r = log(6, '3');     const first = esc.checkDefects('MA2', r.shiftDay, r.shift, when);
  assert.ok(first && !first.existing, '22 is over 20');
  r = log(5, '4');     assert.equal(esc.checkDefects('MA2', r.shiftDay, r.shift, when).existing, true, 'same shift, same issue');
  assert.equal(queued(first.id).length, 1);
  assert.match(store.issueById(first.id).summary, /defects logged in shift A/);
});

test('the ladder is edited from settings: add a person, change timings, reject bad input', () => {
  const l = settings.all().ladder;
  l[1].people.push({ name: 'Zodwa', role: 'Maintenance planner', email: 'ZODWA@evernu.example', enabled: true });
  l[1].afterMin = 10; l[2].afterMin = 20; l[3].afterMin = 40; l[4].afterMin = 80;
  assert.deepEqual(settings.update({ ladder: l }).errors, []);
  const saved = settings.all().ladder;
  assert.equal(saved[1].people[1].email, 'zodwa@evernu.example');

  const { id } = esc.raise({ kind: 'manual', machineId: 'MA1', summary: 'Edited ladder', now: at(2000) });
  esc.tick(at(2010));
  assert.deepEqual(queued(id).filter(m => m.level === 2).map(m => m.to_addr).sort(), ['mechanical@evernu.co.za', 'zodwa@evernu.example']);

  let bad = settings.update({ ladder: [{ afterMin: 0, people: [{ email: 'not-an-email', enabled: true }] }] });
  assert.equal(bad.ok, false); assert.match(bad.errors.join(), /not an email/);
  bad = settings.update({ ladder: [{ afterMin: 30, people: [{ email: 'a@b.co' }] }, { afterMin: 10, people: [{ email: 'c@d.co' }] }] });
  assert.match(bad.errors.join(), /same time or later/);
  bad = settings.update({ ladder: [{ afterMin: 0, people: [{ email: 'a@b.co', enabled: false }] }] });
  assert.equal(bad.ok, false);
  assert.equal(settings.all().ladder.length, 5, 'rejected edits change nothing');

  // remove a level: levels renumber
  const ladder = settings.all().ladder; ladder.splice(2, 1);
  assert.equal(settings.update({ ladder }).ok, true);
  assert.deepEqual(settings.all().ladder.map(s => s.level), [1, 2, 3, 4]);
});

test('emails are written to the queue first and delivered to the (local test) mail server', async () => {
  const before = sink.messages.length;
  const pending = store.dueMail(at(100000)).length;
  assert.ok(pending > 5, 'there is a backlog from the tests above');
  const r = await mail.processQueue(at(100000));
  assert.equal(r.sent, pending);
  assert.equal(sink.messages.length - before, pending);
  const m = sink.messages.find(x => /Level 2/.test(x.subject));
  assert.ok(m.html.includes('ack?t='));
  assert.equal(store.mailCounts().queued, 0);
  assert.ok(mail.status().lastOkAt);
});

test('a dead network never loses a message: it waits, backs off, and sends when the server returns', async () => {
  const port = await freePort();   // nothing is listening on it
  settings.update({ smtp: { host: '127.0.0.1', port, security: 'none' } });

  const { id } = esc.raise({ kind: 'manual', machineId: 'MA1', summary: 'Offline test', now: at(5000) });
  esc.tick(at(5031));
  const n = queued(id).length; assert.ok(n >= 2);

  let r = await mail.processQueue(at(5031));
  assert.equal(r.sent, 0);
  assert.ok(r.retried >= 1);
  assert.equal(store.recentMail(50, id).filter(m => m.status === 'queued').length, n, 'all of the mail for this issue is still queued');
  const row = store.recentMail(200).find(m => m.attempts === 1);
  assert.equal(row.status, 'queued');
  assert.match(row.last_error, /ECONNREFUSED|connect/i);

  // too early to try again: nothing is attempted
  r = await mail.processQueue(at(5031));
  assert.equal(r.sent + r.retried, 0);
  const waiting = store.recentMail(200).find(m => m.attempts === 1);
  assert.ok(waiting.next_attempt_at > dbm.iso(at(5031)), 'back-off pushes the next try into the future');

  // the mail server comes back on the same port, later that evening
  const back = await startSink({ port, web: null });
  r = await mail.processQueue(at(5100));
  assert.ok(r.sent >= n);
  assert.ok(back.messages.length >= n);
  assert.equal(store.mailCounts().queued, 0);
  await back.close();
});

test('with no mail account set up mail waits; past the give-up time it fails and can be retried', async () => {
  settings.update({ smtp: { host: '' } });
  const { id } = esc.raise({ kind: 'manual', machineId: 'MA2', summary: 'No smtp', now: at(7000) });
  const r = await mail.processQueue(at(7000));
  assert.equal(r.notConfigured, true);
  assert.equal(mail.status().configured, false);
  assert.equal(store.recentMail(5, id)[0].status, 'queued');

  const port = await freePort();
  settings.update({ smtp: { host: '127.0.0.1', port, security: 'none' } });
  await mail.processQueue(at(7001));                        // first failure
  const r2 = await mail.processQueue(at(7000 + 49 * 60));   // 49 hours later: past the 48 h give-up
  assert.ok(r2.failed >= 1);
  const failed = store.recentMail(5, id).find(m => m.status === 'failed');
  assert.ok(failed);
  const back = await startSink({ port, web: null });
  assert.equal(store.retryMail(failed.id, at(7000 + 50 * 60)), 1);
  const r3 = await mail.processQueue(at(7000 + 50 * 60));
  assert.ok(r3.sent >= 1);
  await back.close();
});

test('a test email goes through the same queue', async () => {
  settings.update({ smtp: { host: '127.0.0.1', port: sink.port, security: 'none' } });
  const r = await mail.sendTest('someone@test.invalid');
  assert.equal(r.ok, true);
  assert.ok(sink.messages.some(m => m.subject === '[Digital Kaizen] Test message' && m.envelopeTo.includes('someone@test.invalid')));
});
