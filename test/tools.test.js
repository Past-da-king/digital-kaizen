// reset / seed guards, reset-account, and the link address.
import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('..', import.meta.url).pathname;
// a private data folder per case; the child process never sees the test's own env
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'dk-tool-'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DK_DB: join(dir, 'kaizen.db'), DK_KEYFILE: join(dir, 'keystore.key'), DK_SECRETS: join(dir, 'secrets.json'), DK_PHOTOS: join(dir, 'photos'), DK_WEB_PORT: '4399', DK_QUIET: '1' };
  return { dir, env, db: env.DK_DB };
}
const run = (script, args, env, input) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { env, input, encoding: 'utf8', cwd: ROOT, timeout: 60000 });
const count = (file, table = 'production') => { const d = new DatabaseSync(file); try { return d.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; } finally { d.close(); } };
const addShots = (file, n) => { const d = new DatabaseSync(file); for (let i = 0; i < n; i++) d.prepare(`INSERT INTO production (timestamp, machine_id, cycletime, downtime) VALUES (?,?,?,?)`).run(`2026-11-0${1 + (i % 5)} 08:00:0${i % 10}`, 'MA1', 28, 0); d.close(); };

async function makeDb(s, shots = 5) {
  // open the app's own db module in a child so the schema is created by the real migrations
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/db.js')"], { env: s.env, cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  addShots(s.db, shots);
}

test('npm run reset refuses with no confirmation: nothing is deleted, no backup is made', async () => {
  const s = sandbox(); await makeDb(s, 5);
  const r = run('reset-db.js', [], s.env, '');          // no terminal, no flag
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Refused/);
  assert.equal(count(s.db), 5, 'all 5 rows still there');
  assert.equal(existsSync(join(s.dir, 'backups')), false);
});

test('npm run reset: a wrong phrase typed in a terminal cancels; piped "yes" is not accepted', async () => {
  const s = sandbox(); await makeDb(s, 5);
  const r = run('reset-db.js', [], s.env, 'yes\n');
  assert.notEqual(r.status, 0);
  assert.equal(count(s.db), 5);
});

test('npm run reset --yes-delete-everything: backs up first, says where, then wipes', async () => {
  const s = sandbox(); await makeDb(s, 5);
  const r = run('reset-db.js', ['--yes-delete-everything'], s.env, '');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Backup written to .*before-reset/);
  assert.equal(count(s.db), 0, 'wiped');
  const b = readdirSync(join(s.dir, 'backups'));
  assert.equal(b.length, 1);
  assert.equal(count(join(s.dir, 'backups', b[0], 'kaizen.db')), 5, 'the backup holds the 5 rows');
});

test('the typed phrase is accepted by the guard itself (interactive path)', async () => {
  const { confirmDestructive, PHRASE } = await import('../scripts/_confirm.js');
  const log = console.log; console.log = () => {};
  try {
    const good = await confirmDestructive({ what: 'x', flag: '--f', argv: [], tty: true, ask: async () => PHRASE });
    const bad = await confirmDestructive({ what: 'x', flag: '--f', argv: [], tty: true, ask: async () => 'delete everything please' });
    const none = await confirmDestructive({ what: 'x', flag: '--f', argv: [], tty: false });
    const flag = await confirmDestructive({ what: 'x', flag: '--f', argv: ['--f'], tty: false });
    assert.equal(good.ok, true); assert.equal(bad.ok, false); assert.equal(none.ok, false); assert.equal(flag.ok, true);
  } finally { console.log = log; }
});

test('npm run seed refuses on a database that already holds data; goes ahead (with a backup) only with the flag; an empty one needs no question', async () => {
  const s = sandbox(); await makeDb(s, 3);
  const r = run('seed-history.js', ['1'], s.env, '');
  assert.notEqual(r.status, 0); assert.match(r.stdout, /Refused/);
  assert.equal(count(s.db), 3);
  const empty = sandbox(); await makeDb(empty, 0);
  const e = run('seed-history.js', ['1'], empty.env, '');
  assert.equal(e.status, 0, e.stdout + e.stderr);
  assert.ok(count(empty.db) > 100);
});

test('reset-account: new one-time link, old password and sessions gone, written to the log; unknown email refused', async () => {
  const s = sandbox();
  const mk = run('create-admin.js', ['Thandi Admin', 'thandi@factory.test'], s.env);
  assert.equal(mk.status, 0, mk.stdout + mk.stderr);
  // finish the account in-process against the same file
  const d = new DatabaseSync(s.db);
  const uid = d.prepare(`SELECT id FROM users WHERE email='thandi@factory.test'`).get().id;
  d.prepare(`UPDATE users SET status='active', pw_hash='x', totp_on=1, totp_secret='y', recovery='["a"]' WHERE id=?`).run(uid);
  d.prepare(`INSERT INTO sessions (id_hash, user_id, kind, created_at, last_seen, expires_at) VALUES ('h', ?, 'staff', '2026-11-05', '2026-11-05', '2999-01-01')`).run(uid);
  d.close();

  const bad = run('reset-account.js', ['nobody@factory.test'], s.env);
  assert.notEqual(bad.status, 0); assert.match(bad.stdout, /No dashboard account/);

  const r = run('reset-account.js', ['Thandi@Factory.test'], s.env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /http:\/\/[^\s]+\/invite\.html\?t=[\w-]+/);
  const d2 = new DatabaseSync(s.db);
  const u = d2.prepare('SELECT * FROM users WHERE id=?').get(uid);
  assert.equal(u.pw_hash, null); assert.equal(u.totp_on, 0); assert.equal(u.status, 'invited');
  assert.equal(d2.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(uid).n, 0, 'sessions ended');
  const row = d2.prepare(`SELECT * FROM auth_log WHERE event='user-reset' ORDER BY id DESC`).get();
  assert.ok(row, 'audited'); assert.match(row.who, /reset-account/);
  d2.close();
  // the printed link is a real, working invite
  const link = /invite\.html\?t=([\w-]+)/.exec(r.stdout)[1];
  const chk = spawnSync(process.execPath, ['--input-type=module', '-e', `const u = await import('./src/users.js'); console.log(JSON.stringify(u.inviteInfo(process.argv[1])?.kind))`, link], { env: s.env, cwd: ROOT, encoding: 'utf8' });
  assert.equal(chk.stdout.trim(), '"reset"');
});

test('reset-account refuses a switched-off account and an operator name', async () => {
  const s = sandbox();
  run('create-admin.js', ['Off User', 'off@factory.test', 'viewer'], s.env);
  const d = new DatabaseSync(s.db); d.prepare(`UPDATE users SET status='disabled' WHERE email='off@factory.test'`).run();
  d.prepare(`INSERT INTO users (email, name, role, status, created_at) VALUES (NULL,'Sipho','operator','active','2026-11-05')`).run(); d.close();
  const r = run('reset-account.js', ['off@factory.test'], s.env);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /switched off/);
  assert.notEqual(run('reset-account.js', ['Sipho'], s.env).status, 0);
  assert.notEqual(run('reset-account.js', [], s.env).status, 0);
});

// ---------- the link address ----------
const net = await import('../src/net.js');
const nic = (name, address, internal = false) => ({ [name]: [{ family: 'IPv4', address, internal }] });

test('link address: Tailscale 100.x loses to a LAN address, whatever order the adapters come in', () => {
  const a = { ...nic('tailscale0', '100.101.102.103'), ...nic('eth0', '192.168.1.20') };
  const b = { ...nic('eth0', '192.168.1.20'), ...nic('tailscale0', '100.101.102.103') };
  assert.equal(net.pickAddress(a).address, '192.168.1.20');
  assert.equal(net.pickAddress(b).address, '192.168.1.20');
  // 100.x even with an innocent adapter name (Windows names it "Ethernet 2")
  assert.equal(net.pickAddress({ ...nic('Ethernet 2', '100.80.1.2'), ...nic('Ethernet', '10.0.0.7') }).address, '10.0.0.7');
});

test('link address: private ranges, then real addresses, then virtual adapters, then 100.64/10, link-local last', () => {
  assert.equal(net.pickAddress({ ...nic('vEthernet (WSL)', '172.24.0.1'), ...nic('Wi-Fi', '172.20.5.9') }).address, '172.20.5.9', 'WSL/Hyper-V adapter loses');
  assert.equal(net.pickAddress({ ...nic('docker0', '172.17.0.1'), ...nic('eth0', '192.120.0.7') }).address, '192.120.0.7', "the factory's own non-RFC1918 range still beats Docker");
  assert.equal(net.pickAddress({ ...nic('eth0', '169.254.3.3'), ...nic('tailscale0', '100.64.0.9') }).address, '100.64.0.9');
  assert.equal(net.pickAddress(nic('tailscale0', '100.64.0.9')).address, '100.64.0.9', 'still used when it is all there is');
  assert.equal(net.pickAddress({ ...nic('lo', '127.0.0.1', true) }), null);
  assert.equal(net.pickAddress({}), null);
  for (const [ip, rank] of [['192.168.0.1', 0], ['10.1.2.3', 0], ['172.16.0.1', 0], ['172.31.255.1', 0], ['172.32.0.1', 3], ['100.64.0.1', 4], ['100.127.255.1', 4], ['100.128.0.1', 3], ['169.254.1.1', 5]]) assert.equal(net.rangeRank(ip), rank, ip);
});

test('link address: Settings wins, then DK_BASE_URL, then the guess; a bad DK_BASE_URL is ignored with a reason', () => {
  const ifaces = nic('eth0', '192.168.1.20');
  assert.equal(net.resolveBaseUrl({ saved: 'http://saved.test:4310/', port: 4310, env: { DK_BASE_URL: 'http://env.test:4310' }, ifaces }).url, 'http://saved.test:4310');
  const e = net.resolveBaseUrl({ saved: '', port: 4310, env: { DK_BASE_URL: ' http://env.test:4310/// ' }, ifaces });
  assert.equal(e.url, 'http://env.test:4310'); assert.match(e.source, /DK_BASE_URL/);
  const g = net.resolveBaseUrl({ saved: '', port: 4310, env: {}, ifaces });
  assert.equal(g.url, 'http://192.168.1.20:4310'); assert.match(g.source, /eth0/);
  assert.equal(net.resolveBaseUrl({ saved: '', port: 4310, env: { DK_BASE_URL: 'ftp://x' }, ifaces }).url, 'http://192.168.1.20:4310');
  assert.match(net.envBaseUrlProblem({ DK_BASE_URL: 'nonsense' }), /ignored/);
  assert.equal(net.envBaseUrlProblem({}), null);
});

test('DK_BASE_URL is honoured in every place a link is made: invite (admin script, People page, invite email), ack link, QR', async () => {
  const s = sandbox();
  const env = { ...s.env, DK_BASE_URL: 'https://kaizen.evernu.test:8443/' };
  // command line invite
  const a = run('create-admin.js', ['Env Admin', 'env@factory.test'], env);
  assert.match(a.stdout, /https:\/\/kaizen\.evernu\.test:8443\/invite\.html\?t=/);
  assert.match(a.stdout, /DK_BASE_URL in \.env/);
  const r = run('reset-account.js', ['env@factory.test'], env);
  assert.match(r.stdout, /https:\/\/kaizen\.evernu\.test:8443\/invite\.html\?t=/);
  // server routes: People page "Add" and "Reset", the invite email text, the QR image target
  const script = `
    const { startServer } = await import('./src/server.js');
    const users = await import('./src/users.js');
    const db = (await import('./src/db.js')).db;
    const srv = await startServer(); const base = 'http://127.0.0.1:' + srv.address().port;
    // sign an admin in directly: make the account active and add a session
    const { randomBytes, createHash } = await import('node:crypto');
    const uid = db.prepare("SELECT id FROM users WHERE email='env@factory.test'").get().id;
    db.prepare("UPDATE users SET status='active', totp_on=1 WHERE id=?").run(uid);
    const tok = randomBytes(24).toString('base64url');
    const sha = (x) => createHash('sha256').update(x).digest('hex');
    db.prepare("INSERT INTO sessions (id_hash,user_id,kind,created_at,last_seen,expires_at) VALUES (?,?,?,?,?,?)").run(sha(tok), uid, 'staff', new Date().toISOString(), new Date().toISOString(), '2999-01-01');
    const h = { cookie: 'dk_staff=' + tok, 'content-type': 'application/json' };
    const add = await (await fetch(base + '/api/users', { method: 'POST', headers: h, body: JSON.stringify({ name: 'New Mgr', email: 'mgr@factory.test', role: 'manager' }) })).json();
    const list = await (await fetch(base + '/api/users', { headers: h })).json();
    const mid = list.users.find(u => u.email === 'mgr@factory.test').id;
    const reset = await (await fetch(base + '/api/users/reset', { method: 'POST', headers: h, body: JSON.stringify({ id: mid }) })).json();
    const qr = await fetch(base + '/api/qr?m=MA1', { headers: h });
    const st = await (await fetch(base + '/api/settings', { headers: h })).json();
    console.log(JSON.stringify({ add: add.inviteLink, reset: reset.inviteLink, qr: qr.headers.get('x-qr-target'), guess: st.baseUrlGuess }));
    const esc = await import('./src/escalation.js'); console.log(esc.baseUrl());
    process.exit(0);`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const lines = out.stdout.trim().split('\n');
  const j = JSON.parse(lines[lines.length - 2]);
  assert.match(j.add, /^https:\/\/kaizen\.evernu\.test:8443\/invite\.html\?t=/);
  assert.match(j.reset, /^https:\/\/kaizen\.evernu\.test:8443\/invite\.html\?t=/);
  assert.match(j.qr, /^https:\/\/kaizen\.evernu\.test:8443\/log\.html\?m=MA1/);
  assert.equal(j.guess, 'https://kaizen.evernu.test:8443');
  assert.equal(lines[lines.length - 1], 'https://kaizen.evernu.test:8443', 'the ack link in escalation emails uses it');
});
