// An install that uses the legacy shared password (data/secrets.json from `npm run setup`).
import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { jar, STRONG } from './_first-run.js';

writeFileSync(process.env.DK_SECRETS, JSON.stringify({ mqttUser: 's', mqttPass: 'p', dashPass: 'shared-pass-1', sessionKey: 'k'.repeat(64), machineKeys: {} }));
const users = await import('../src/users.js');
const setup = await import('../src/setup.js');
const dbm = await import('../src/db.js');
const { startServer } = await import('../src/server.js');

let server, base;
before(async () => { server = await startServer(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.closeAllConnections?.(); server.close(); });

test('legacy password install (even with an empty database): works as today, never redirected to /setup', async () => {
  assert.equal(dbm.migration.fresh, true, 'a fresh file, but the shared password decides');
  const c = jar(base);
  assert.equal((await c.get('/api/live')).status, 401);
  const st = await c.get('/api/auth/state');
  assert.equal(st.body.legacy, true); assert.equal(st.body.needsSetup, false);
  const page = await fetch(base + '/', { redirect: 'manual', headers: { accept: 'text/html' } });
  assert.equal(page.status, 302); assert.equal(page.headers.get('location'), '/login.html', 'the same shared-password sign-in as before');
  assert.equal(setup.startupLines().gated, false);
});

test('QR page and sensor ingest stay open under the shared password', async () => {
  const c = jar(base);
  assert.equal((await c.get(`/api/log/context?m=MA1&k=${users.machineToken('MA1', 0)}`)).status, 200);
  assert.equal((await c.post('/device-data', { device_id: 'aabbccddeeff', status: 'RUNNING' })).status, 200);
});

test('setup is offered only after the shared password is entered, and then needs no token', async () => {
  const c = jar(base);
  const before = await c.get('/api/setup/state');
  assert.equal(before.body.open, false); assert.equal(before.body.reason, 'sign-in-first');
  assert.equal((await c.post('/api/setup/create', { name: 'Eve', email: 'eve@evil.test', token: setup.currentToken() })).status, 403, 'the token alone is not enough on a password install');
  assert.equal((await c.post('/api/login', { password: 'wrong' })).status, 401);
  assert.equal((await c.post('/api/login', { password: 'shared-pass-1' })).status, 200);
  const after = await c.get('/api/setup/state');
  assert.equal(after.body.open, true); assert.equal(after.body.via, 'shared-password');
  const r = await c.post('/api/setup/create', { name: 'Pw Admin', email: 'pw@factory.test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = new URL(r.body.invite, base).searchParams.get('t');
  const s = await c.post('/api/invite/start', { t, password: STRONG });
  assert.equal(s.status, 200);
  assert.equal((await c.post('/api/invite/finish', { t, code: users.totpAt(s.body.secret, Math.floor(Date.now() / 30000)) })).status, 200);
  assert.equal((await c.post('/api/setup/create', { name: 'Again', email: 'again@factory.test' })).status, 403, 'closed once an account exists');
});
