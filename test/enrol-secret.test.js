// Two-step setup: the key shown on the page must stay the same until the
// first code is accepted, so a scan made earlier keeps working after a
// refresh, a second tab or a double click. A code from an older key must be
// told apart and answered with "scan again". (Evernu, 10 Nov 2026)
import { asExistingInstall } from './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const users = await import('../src/users.js');
const dbm = await import('../src/db.js');
asExistingInstall(dbm.db);
const { startServer } = await import('../src/server.js');

let server, base;
before(async () => { server = await startServer(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.closeAllConnections?.(); server.close(); });

const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const nowCode = (secret, offset = 0) => users.totpAt(secret, Math.floor(Date.now() / 30000) + offset);
const STRONG = 'Correct-Horse-Battery-9';

test('the otpauth link holds the same key as the typed key, with the defaults apps expect', async () => {
  const c = await users.createUser({ name: 'Uri', email: 'uri@factory.test', role: 'viewer' });
  const s = await users.inviteStart(c.inviteToken, STRONG);
  assert.ok(s.uri.startsWith('otpauth://totp/Digital%20Kaizen:uri%40factory.test?'));
  const q = new URLSearchParams(s.uri.split('?')[1]);
  assert.equal(q.get('secret'), s.secret);
  assert.equal(q.get('issuer'), 'Digital Kaizen');
  assert.equal(q.get('algorithm'), 'SHA1');
  assert.equal(q.get('digits'), '6');
  assert.equal(q.get('period'), '30');
});

test('going back and pressing Next again keeps the same key, so the first scan still works', async () => {
  const c = await users.createUser({ name: 'Pat', email: 'pat@factory.test', role: 'manager' });
  const first = await post('/api/invite/start', { t: c.inviteToken, password: STRONG });
  const again = await post('/api/invite/start', { t: c.inviteToken, password: STRONG });
  assert.equal(again.body.secret, first.body.secret, 'a refresh must not make a new key');
  const f = await post('/api/invite/finish', { t: c.inviteToken, code: nowCode(first.body.secret) });
  assert.equal(f.status, 200, JSON.stringify(f.body));
});

test('two Next presses at once still show the key the server checks against', async () => {
  const c = await users.createUser({ name: 'Dee', email: 'dee@factory.test', role: 'viewer' });
  const [a, b] = await Promise.all([
    post('/api/invite/start', { t: c.inviteToken, password: STRONG }),
    post('/api/invite/start', { t: c.inviteToken, password: STRONG }),
  ]);
  assert.equal(a.body.secret, b.body.secret);
  const f = await post('/api/invite/finish', { t: c.inviteToken, code: nowCode(a.body.secret) });
  assert.equal(f.status, 200, JSON.stringify(f.body));
});

test('a code from a replaced key says scan again; Scan a new code makes a fresh key that then works', async () => {
  const c = await users.createUser({ name: 'Sam', email: 'sam@factory.test', role: 'admin' });
  const first = await post('/api/invite/start', { t: c.inviteToken, password: STRONG });
  const fresh = await post('/api/invite/rescan', { t: c.inviteToken });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.notEqual(fresh.body.secret, first.body.secret);
  assert.ok(fresh.body.qr.startsWith('data:image/png'));

  const old = await post('/api/invite/finish', { t: c.inviteToken, code: nowCode(first.body.secret) });
  assert.equal(old.status, 400);
  assert.match(old.body.error, /older/i);
  assert.equal(old.body.rescan, true);

  const near = new Set([-1, 0, 1].map(o => nowCode(fresh.body.secret, o)));
  const miss = ['000000', '111111', '222222'].find(x => !near.has(x));
  const wrong = await post('/api/invite/finish', { t: c.inviteToken, code: miss });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /scan a new code/i, 'a plain miss also tells the person how to start over');
  assert.equal(wrong.body.rescan, true);

  const ok = await post('/api/invite/finish', { t: c.inviteToken, code: nowCode(fresh.body.secret) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('the time window is one step either side, no wider', () => {
  const s = users.newSecret();
  const at = Date.now(), cur = Math.floor(at / 30000);
  assert.ok(users.totpCheck(s, users.totpAt(s, cur - 1), 0, at));
  assert.ok(users.totpCheck(s, users.totpAt(s, cur + 1), 0, at));
  const far = users.totpAt(s, cur - 3);
  if (![cur - 1, cur, cur + 1].some(x => users.totpAt(s, x) === far)) assert.equal(users.totpCheck(s, far, 0, at), 0);
});
