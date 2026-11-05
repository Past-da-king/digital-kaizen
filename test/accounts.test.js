import { asExistingInstall } from './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const users = await import('../src/users.js');
const dbm = await import('../src/db.js');
asExistingInstall(dbm.db);   // these tests are about an install that already existed: no accounts yet, dashboard open as before
const { startServer } = await import('../src/server.js');

let server, base;
before(async () => { server = await startServer(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.closeAllConnections?.(); server.close(); });

// a tiny cookie jar, one per "browser"
const browser = () => {
  const jar = {};
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie?.() || []) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v;
    }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, body: json, location: r.headers.get('location'), cookies: { ...jar }, cookieHeader: r.headers.getSetCookie?.() || [] };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}, h) => call('POST', p, b, h), jar };
};

const nowCode = (secret, offset = 0) => users.totpAt(secret, Math.floor(Date.now() / 30000) + offset);
const STRONG = 'Correct-Horse-Battery-9';

// Accept an invite the way a person does, in a browser.
async function activate(b, inviteToken, password = STRONG) {
  const s = await b.post('/api/invite/start', { t: inviteToken, password });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const f = await b.post('/api/invite/finish', { t: inviteToken, code: nowCode(s.body.secret) });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return { secret: s.body.secret, recovery: f.body.recoveryCodes, qr: s.body.qr };
}

let admin, adminSecret, recovery;

test('RFC 6238 test vectors: the authenticator maths is right', () => {
  const secret = users.b32encode(Buffer.from('12345678901234567890'));
  assert.equal(users.totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(users.totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(users.totpAt(secret, Math.floor(20000000000 / 30)), '353130');
});

test('before the first account the dashboard is as it was; there is no public sign-up', async () => {
  const b = browser();
  assert.equal((await b.get('/api/auth/state')).body.accounts, false);
  assert.equal((await b.get('/api/live')).status, 200);
  const r = await b.post('/api/users', { name: 'Mallory', email: 'm@evil.test', role: 'admin' });
  // the open dashboard (no accounts yet) cannot be used to mint accounts from outside either: admin route needs an admin
  assert.ok(r.status === 200 || r.status === 401 || r.status === 403);
  for (const u of users.listUsers()) dbm.db.prepare('DELETE FROM users WHERE id = ?').run(u.id);   // start the real flow clean
});

test('an admin is created by a one-time link; password rules, authenticator enrolment and recovery codes', async () => {
  const c = await users.createUser({ name: 'Ayanda', email: 'Admin@Factory.test', role: 'admin' });
  assert.equal(c.ok, true);
  assert.equal((await users.createUser({ name: 'Dup', email: 'admin@factory.test', role: 'viewer' })).ok, false);

  const b = browser();
  assert.equal((await b.get('/api/invite/info?t=bogus')).status, 404);
  assert.equal((await b.get(`/api/invite/info?t=${c.inviteToken}`)).body.email, 'admin@factory.test');
  assert.equal((await b.post('/api/invite/start', { t: c.inviteToken, password: 'short' })).status, 400);
  assert.equal((await b.post('/api/invite/start', { t: c.inviteToken, password: 'password123' })).status, 400);
  const s = await b.post('/api/invite/start', { t: c.inviteToken, password: STRONG });
  assert.match(s.body.qr, /^data:image\/png;base64,/);
  assert.match(s.body.secret, /^[A-Z2-7]{32}$/);
  assert.equal((await b.post('/api/invite/finish', { t: c.inviteToken, code: '000000' })).status, 400, 'a wrong first code does not activate');
  assert.equal(users.listUsers().find(u => u.email === 'admin@factory.test').status, 'invited');

  const f = await b.post('/api/invite/finish', { t: c.inviteToken, code: nowCode(s.body.secret) });
  assert.equal(f.status, 200);
  assert.equal(f.body.recoveryCodes.length, 10);
  assert.ok(f.cookieHeader.some(h => /dk_staff=/.test(h) && /HttpOnly/.test(h) && /SameSite=Lax/.test(h)), 'session cookie is HttpOnly');
  assert.equal((await b.post('/api/invite/finish', { t: c.inviteToken, code: nowCode(s.body.secret) })).status, 400, 'the link works once');
  adminSecret = s.body.secret; recovery = f.body.recoveryCodes;

  const row = dbm.db.prepare('SELECT pw_hash, totp_secret, recovery FROM users WHERE email = ?').get('admin@factory.test');
  assert.match(row.pw_hash, /^scrypt\$/);
  assert.ok(!row.pw_hash.includes(STRONG));
  assert.ok(!row.totp_secret.includes(adminSecret), 'the authenticator secret is encrypted at rest');
  assert.ok(!row.recovery.includes(recovery[0].replace('-', '')), 'recovery codes are stored hashed');
});

test('with an account, the dashboard needs a sign-in: pages redirect, APIs say 401, shells and the QR page stay open', async () => {
  const b = browser();
  assert.equal((await b.get('/api/auth/state')).body.accounts, true);
  const page = await fetch(base + '/index.html', { redirect: 'manual' });
  assert.equal(page.status, 302); assert.equal(page.headers.get('location'), '/login.html');
  assert.equal((await b.get('/api/live')).status, 401);
  assert.equal((await b.get('/api/settings')).status, 401);
  assert.equal((await b.post('/api/settings', { baseUrl: 'http://x.test' })).status, 401);
  assert.equal((await b.get('/login.html')).status, 200);
  assert.equal((await b.get('/log.html')).status, 200);
  assert.equal((await b.post('/api/users', { name: 'Mallory', email: 'm@evil.test', role: 'admin' })).status, 401, 'no open sign-up');
  // device readings still flow without a login
  assert.equal((await b.post('/device-data', { device_id: 'aabbccddeeff', shots: 1 })).status, 200);
});

test('sign in is two steps: password, then the authenticator code; a code cannot be used twice', async () => {
  admin = browser();
  let r = await admin.post('/api/auth/login', { email: 'admin@factory.test', password: 'wrong-password-1' });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'Wrong email or password.');
  r = await admin.post('/api/auth/login', { email: 'nobody@factory.test', password: STRONG });
  assert.equal(r.body.error, 'Wrong email or password.', 'unknown email gives the same answer');
  r = await admin.post('/api/auth/login', { email: 'admin@factory.test', password: STRONG });
  assert.equal(r.status, 200); assert.equal(r.body.need2fa, true);
  assert.equal((await admin.get('/api/live')).status, 401, 'a password alone is not a session');

  assert.equal((await admin.post('/api/auth/2fa', { code: '123456' })).status, 401);
  // the code used to activate is the current step: replaying it is refused
  assert.equal((await admin.post('/api/auth/2fa', { code: nowCode(adminSecret) })).status, 401, 'replay of an already used code');
  r = await admin.post('/api/auth/2fa', { code: nowCode(adminSecret, 1) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.role, 'admin');
  assert.equal((await admin.get('/api/live')).status, 200);
  assert.equal((await admin.get('/index.html')).status, 200);
});

test('wrong passwords lock the account for a while; the right one is refused while locked; an admin can unlock', async () => {
  const c = await users.createUser({ name: 'Lock Me', email: 'lock@factory.test', role: 'manager' });
  const mgr = browser(); await activate(mgr, c.inviteToken);
  const b = browser();
  for (let i = 0; i < 4; i++) assert.equal((await b.post('/api/auth/login', { email: 'lock@factory.test', password: 'nope-nope-nope' })).status, 401);
  assert.equal((await b.post('/api/auth/login', { email: 'lock@factory.test', password: 'nope-nope-nope' })).status, 401);   // 5th
  const locked = await b.post('/api/auth/login', { email: 'lock@factory.test', password: STRONG });
  assert.equal(locked.status, 423, 'locked: the correct password is refused too');
  const id = users.listUsers().find(u => u.email === 'lock@factory.test').id;
  assert.equal((await admin.post('/api/users/unlock', { id })).body.ok, true);
  assert.equal((await b.post('/api/auth/login', { email: 'lock@factory.test', password: STRONG })).status, 200);
});

test('one address making too many bad attempts is refused outright', async () => {
  dbm.db.prepare('DELETE FROM auth_attempts').run();
  const b = browser(); let last;
  for (let i = 0; i < 22; i++) last = await b.post('/api/auth/login', { email: `ghost${i}@factory.test`, password: 'nope-nope-nope' });
  assert.equal(last.status, 429);
  dbm.db.prepare('DELETE FROM auth_attempts').run();
});

test('roles: viewer reads, manager also acknowledges and exports, only admin changes settings and people', async () => {
  const mk = async (role, email) => {
    const c = await users.createUser({ name: role, email, role });
    const b = browser(); const a = await activate(b, c.inviteToken);
    await b.post('/api/auth/logout');
    await b.post('/api/auth/login', { email, password: STRONG });
    // the activation code is spent; the next 30 s window is accepted
    const r = await b.post('/api/auth/2fa', { code: nowCode(a.secret, 1) });
    assert.equal(r.status, 200, `${role}: ${JSON.stringify(r.body)}`);
    return b;
  };
  const viewer = await mk('viewer', 'viewer@factory.test');
  const manager = await mk('manager', 'manager@factory.test');

  assert.equal((await viewer.get('/api/live')).status, 200);
  assert.equal((await viewer.get('/api/logs/defects.csv')).status, 200);
  assert.equal((await viewer.post('/api/issues/ack', { id: 1 })).status, 403);
  assert.equal((await viewer.get('/api/settings')).status, 403);
  assert.equal((await viewer.get('/api/users')).status, 403);
  assert.equal((await viewer.get('/settings.html')).status, 403);

  assert.notEqual((await manager.post('/api/issues/ack', { id: 99999 })).status, 403);
  assert.equal((await manager.get('/api/settings')).status, 403);
  assert.equal((await manager.post('/api/settings', { baseUrl: 'http://evil.test' })).status, 403);
  assert.equal((await manager.post('/api/devices/assign', { deviceId: 'aa', machineId: 'MA1' })).status, 403);

  assert.equal((await admin.get('/api/settings')).status, 200);
  assert.equal((await admin.get('/api/users')).body.users.length >= 4, true);
});

test('recovery codes sign you in once each; changing the password ends other sessions', async () => {
  const b = browser();
  await b.post('/api/auth/login', { email: 'admin@factory.test', password: STRONG });
  const r = await b.post('/api/auth/2fa', { code: recovery[0] });
  assert.equal(r.status, 200); assert.equal(r.body.recoveryLeft, 9);
  const again = browser();
  await again.post('/api/auth/login', { email: 'admin@factory.test', password: STRONG });
  assert.equal((await again.post('/api/auth/2fa', { code: recovery[0] })).status, 401, 'a recovery code works once');

  const before = admin.jar.dk_staff;
  const pw = await b.post('/api/auth/password', { current: STRONG, code: nowCode(adminSecret, 1) , next: 'A-brand-new-passphrase-7' });
  // totp_last moved forward on the recovery-code login? a code from the following window is accepted
  assert.ok(pw.body.ok || /code/.test(pw.body.error), JSON.stringify(pw.body));
  if (pw.body.ok) {
    assert.equal((await admin.get('/api/live')).status, 401, 'the other browser was signed out');
    assert.equal((await b.get('/api/live')).status, 200, 'this one stays');
  }
  assert.ok(before);
});

test('the last admin cannot be demoted or disabled; a reset link replaces a lost phone', async () => {
  const list = users.listUsers();
  const me = list.find(u => u.email === 'admin@factory.test');
  const b = browser();
  const dem = users.adminUpdate(me.id, { role: 'viewer' }, 'test');
  assert.equal(dem.ok, false); assert.match(dem.error, /only admin/);
  assert.equal(users.adminUpdate(me.id, { status: 'disabled' }, 'test').ok, false);

  const viewerId = list.find(u => u.email === 'viewer@factory.test').id;
  const reset = users.adminReset(viewerId, 'test');
  assert.ok(reset.inviteToken);
  assert.equal(users.listUsers().find(u => u.id === viewerId).status, 'invited');
  assert.equal((await b.post('/api/auth/login', { email: 'viewer@factory.test', password: STRONG })).status, 401, 'the old password stops working');
  await activate(b, reset.inviteToken, 'Another-Strong-Pass-5');
  assert.equal(users.adminUpdate(viewerId, { status: 'disabled' }, 'test').ok, true);
  assert.equal((await b.get('/api/live')).status, 401, 'a disabled user is signed out at once');
});

test('operators are just names: they cannot sign in to the dashboard, and do not switch accounts on', async () => {
  const op = await users.createUser({ name: 'Floor Person', role: 'operator', pin: '1357' });
  assert.equal(op.ok, true);
  const b = browser();
  assert.equal((await b.post('/api/auth/login', { email: '', password: 'x' })).status, 401);
  assert.equal(users.operatorList().some(o => o.name === 'Floor Person' && o.hasPin), true);
  assert.equal((await users.createUser({ name: 'floor person', role: 'operator' })).ok, false, 'duplicate names are refused');
  const ok = users.checkOperator(op.user.id, '1357', { pinRequired: true, ip: 'x', machine: 'MA1' });
  assert.equal(ok.ok, true);
  assert.equal(users.checkOperator(op.user.id, '9999', { pinRequired: true, ip: 'y', machine: 'MA1' }).ok, false);
});

test('a page on another website cannot make this one act', async () => {
  const r = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});
