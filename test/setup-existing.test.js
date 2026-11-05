// An EXISTING install must behave exactly as before: with data and no secrets (open), or with the shared password.
import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { jar } from './_first-run.js';

// ---- state 1: has data, no accounts, no shared password -> open as before
const dbm = await import('../src/db.js');
dbm.recordShot({ machineId: 'MA1', cycletime: 28, downtime: 0, at: new Date() });
dbm.db.prepare(`DELETE FROM settings WHERE key='setupGate'`).run();   // what an upgraded v1.4.0 database looks like
const users = await import('../src/users.js');
const setup = await import('../src/setup.js');
const { startServer } = await import('../src/server.js');

let server, base;
before(async () => { server = await startServer(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.closeAllConnections?.(); server.close(); });

test('an existing open install: dashboard open as before, no redirect to /setup, no token printed', async () => {
  const c = jar(base);
  assert.equal((await c.get('/api/live')).status, 200);
  const root = await c.get('/'); assert.equal(root.status, 200);
  assert.equal((await c.get('/api/auth/state')).body.needsSetup, false);
  assert.equal(setup.startupLines().gated, false);
});

test('an existing open install: /setup is closed and says to use the command; the token cannot be used', async () => {
  const c = jar(base);
  const st = await c.get('/api/setup/state');
  assert.equal(st.body.open, false); assert.equal(st.body.reason, 'existing-install');
  assert.match(st.body.message, /npm run admin/);
  const r = await c.post('/api/setup/create', { name: 'Eve', email: 'eve@evil.test', token: setup.currentToken() });
  assert.equal(r.status, 403);
  assert.equal(users.accountsEnabled(), false);
});

test('an existing open install: the command still makes the first admin, and accounts then switch on', async () => {
  const r = await users.createUser({ name: 'Cmd Admin', email: 'cmd@factory.test', role: 'admin' }, 'command line');
  assert.ok(r.inviteToken);
  assert.equal((await jar(base).get('/api/live')).status, 401);
  assert.equal((await jar(base).get(`/api/log/context?m=MA1&k=${users.machineToken('MA1', 0)}`)).status, 200, 'QR still open');
  dbm.db.prepare('DELETE FROM invites').run(); dbm.db.prepare('DELETE FROM users').run();
});
