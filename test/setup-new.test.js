// A BRAND-NEW install (empty database, no shared password): closed until /setup is used with the token.
import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { jar, STRONG } from './_first-run.js';

const users = await import('../src/users.js');
const setup = await import('../src/setup.js');
const dbm = await import('../src/db.js');
const { startServer } = await import('../src/server.js');

let server, base, b;
before(async () => { server = await startServer(); base = `http://127.0.0.1:${server.address().port}`; b = jar(base); });
after(() => { server.closeAllConnections?.(); server.close(); });

const qr = () => `/api/log/context?m=MA1&k=${users.machineToken('MA1', 0)}`;

test('empty database: the dashboard is closed and every page goes to /setup', async () => {
  assert.equal(dbm.migration.fresh, true);
  const root = await b.get('/');
  assert.equal(root.status, 302); assert.equal(root.location, '/setup');
  assert.equal((await b.get('/settings.html')).location, '/setup');
  const api = await b.get('/api/live');
  assert.equal(api.status, 401);
  assert.match(api.body.error, /setup/);
  assert.equal((await b.get('/api/auth/state')).body.needsSetup, true);
  assert.equal((await b.get('/api/export.csv')).status, 401, 'data is closed too');
});

test('the QR page, sensor ingest and the setup page itself stay open', async () => {
  assert.equal((await b.get(qr())).status, 200, 'operators can still log');
  assert.equal((await b.post('/device-data', { device_id: 'aabbccddeeff', status: 'RUNNING' })).status, 200, 'sensor HTTP fallback is open');
  assert.equal((await b.get('/setup')).status, 200);
  assert.equal((await b.get('/api/setup/state')).body.open, true);
  assert.equal((await b.get('/login.html')).status, 200);
  assert.equal((await b.get('/ack')).status, 200);
});

test('real sensor data arriving does not open the dashboard', async () => {
  dbm.recordShot({ machineId: 'MA1', cycletime: 28, downtime: 0, at: new Date() });
  assert.ok(dbm.dataRange().n > 0, 'the database now holds production data');
  assert.equal((await b.get('/api/live')).status, 401);
});

test('setup needs the printed token: none, a wrong one, and a stolen guess all fail', async () => {
  const lines = setup.startupLines();
  assert.equal(lines.gated, true);
  const token = setup.currentToken();
  assert.ok(lines.lines.some(l => l.includes(`/setup?t=${token}`)), 'the link with the token is printed');
  const a = await b.post('/api/setup/create', { name: 'Mallory', email: 'm@evil.test' });
  assert.equal(a.status, 403);
  const w = await b.post('/api/setup/create', { name: 'Mallory', email: 'm@evil.test', token: 'not-it' });
  assert.equal(w.status, 403);
  assert.equal(users.accountsEnabled(), false, 'nobody became admin');
});

test('a typo in the name or email does not burn the token', async () => {
  const token = setup.currentToken();
  const bad = await b.post('/api/setup/create', { name: 'Thandi', email: 'not-an-email', token });
  assert.equal(bad.status, 400);
  assert.equal(setup.currentToken(), token);
});

test('the right token makes the first admin and hands over to the invite flow; then everything is signed-in only', async () => {
  const token = setup.currentToken();
  const r = await b.post('/api/setup/create', { name: 'Thandi Admin', email: 'Thandi@factory.test', token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.invite, /^\/invite\.html\?t=/);
  const t = new URL(r.body.invite, base).searchParams.get('t');
  // the existing invite flow: password, QR secret, 6 digits, recovery codes
  const s = await b.post('/api/invite/start', { t, password: STRONG });
  assert.equal(s.status, 200);
  const f = await b.post('/api/invite/finish', { t, code: users.totpAt(s.body.secret, Math.floor(Date.now() / 30000)) });
  assert.equal(f.status, 200);
  assert.equal(f.body.recoveryCodes.length, 10);
  assert.equal(users.listUsers().find(u => u.email === 'thandi@factory.test').role, 'admin');
  assert.equal((await b.get('/api/live')).status, 200, 'the new admin is signed in');
  assert.equal((await jar(base).get('/api/live')).status, 401, 'a stranger is still turned away');
});

test('setup is refused once an account exists, even with the token', async () => {
  const st = await jar(base).get('/api/setup/state');
  assert.equal(st.body.open, false); assert.equal(st.body.reason, 'accounts-exist');
  const r = await jar(base).post('/api/setup/create', { name: 'Eve', email: 'eve@evil.test', token: 'anything' });
  assert.equal(r.status, 403);
  assert.equal(users.listUsers().filter(u => u.role === 'admin').length, 1);
});

test('the token works once: after it is used it cannot be used again, even if the account is gone', async () => {
  setup.configure({});
  const token = setup.currentToken();
  dbm.db.prepare('DELETE FROM sessions').run(); dbm.db.prepare('DELETE FROM invites').run(); dbm.db.prepare('DELETE FROM users').run();
  const ok = await jar(base).post('/api/setup/create', { name: 'Second', email: 'second@factory.test', token });
  assert.equal(ok.status, 200);
  dbm.db.prepare('DELETE FROM invites').run(); dbm.db.prepare('DELETE FROM users').run();
  const again = await jar(base).post('/api/setup/create', { name: 'Third', email: 'third@factory.test', token });
  assert.equal(again.status, 403);
  assert.match(again.body.error, /already used/);
  assert.equal(users.accountsEnabled(), false);
});

test('ten wrong codes lock the setup page for a while', async () => {
  setup.configure({});
  const c = jar(base);
  for (let i = 0; i < 10; i++) await c.post('/api/setup/create', { name: 'x', email: 'x@y.test', token: 'nope' + i });
  const r = await c.post('/api/setup/create', { name: 'x', email: 'x@y.test', token: setup.currentToken() });
  assert.equal(r.status, 429);
});

test('demo mode: the dashboard stays open and /setup is off', async () => {
  setup.configure({ demo: true });
  const c = jar(base);
  assert.equal((await c.get('/api/live')).status, 200);
  const st = await c.get('/api/setup/state');
  assert.equal(st.body.open, false); assert.equal(st.body.reason, 'demo');
  assert.equal((await c.post('/api/setup/create', { name: 'x', email: 'x@y.test', token: setup.currentToken() })).status, 403);
  setup.configure({ demo: false });
});
