// ============================================================
// Accounts for the dashboard. Everything here runs on the factory
// PC; there is no outside sign-in service, so it works with the
// internet cable out.
//
//   ROLES     admin    everything, users, settings, SMTP
//             manager  see everything, acknowledge/resolve issues,
//                      retry mail, escalate, export
//             viewer   see the dashboard and exports (wall screens)
//             operator a NAME on the list that people pick on the QR log
//                      page (no sign-in there). An optional short PIN per
//                      name, off by default. Cannot open the dashboard.
//
//   SIGN-IN   email + password (scrypt) + a 6-digit authenticator code
//             (TOTP, RFC 6238) with one-time recovery codes. Two-step
//             is not optional for admin, manager or viewer.
//   NO SIGN-UP  an admin creates the account; the person opens a
//             one-time link, chooses a password and enrols the app.
//   LOCKOUT   5 wrong passwords lock the account for 15 minutes; an IP
//             address making 20 bad attempts in 15 minutes is refused.
//   SESSIONS  random 256-bit token, only its hash is stored, HttpOnly
//             cookie, idle and absolute expiry, ended on logout,
//             password change and 2FA reset.
//   OPERATORS the QR page needs no login. People choose their name and
//             it is stamped on the entry. If a name has a PIN, wrong PINs
//             are rate limited.
// ============================================================

import {
  scrypt, randomBytes, createHash, createHmac, createCipheriv, createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, iso } from './db.js';

const scryptAsync = promisify(scrypt);

export const ROLES = ['admin', 'manager', 'viewer', 'operator'];
const RANK = { viewer: 1, manager: 2, admin: 3 };

const LIMITS = {
  maxFails: 5, lockMin: 15,
  ipFails: 20, ipWindowMin: 15,
  pinFails: 6, pinWindowMin: 10,
  pendingMin: 5,
  staffIdleH: 8, staffAbsH: 24,
  viewerDays: 30,
  inviteH: 72,
};

// The tables are created by migration 2 in migrate.js.

// ---------- key material (kept beside the database, not inside it) ----------
const KEYFILE = process.env.DK_KEYFILE || fileURLToPath(new URL('../data/keystore.key', import.meta.url));
function loadKey() {
  if (existsSync(KEYFILE)) return Buffer.from(readFileSync(KEYFILE, 'utf8').trim(), 'hex');
  mkdirSync(dirname(KEYFILE), { recursive: true });
  const k = randomBytes(32);
  writeFileSync(KEYFILE, k.toString('hex'), { mode: 0o600 });
  return k;
}
const KEY = loadKey();

const seal = (plain) => {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
};
const unseal = (blob) => {
  const [iv, tag, enc] = blob.split('.').map(s => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const pinLookup = (id, pin) => createHmac('sha256', KEY).update(`pin:${id}:${pin}`).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

const now = () => new Date();
const plus = (ms, from = now()) => iso(new Date(from.getTime() + ms));
const log = (event, { userId = null, who = null, ip = null, detail = null } = {}) =>
  db.prepare('INSERT INTO auth_log (at, user_id, who, event, ip, detail) VALUES (?,?,?,?,?,?)').run(iso(now()), userId, who, event, ip, detail);

// ---------- the per-machine QR token ----------
// Printed in each machine's QR code. Random links cannot post without
// it. Rotating a machine's epoch (Labels page) kills its old stickers.
export function machineToken(machineId, epoch = 0) {
  return createHmac('sha256', KEY).update(`machine:${machineId}:${epoch}`).digest('hex').slice(0, 16);
}
export const tokenOk = (machineId, epoch, given) => safeEq(machineToken(machineId, epoch), String(given || ''));

// A light brake on the QR endpoints: generous for a person, useless for a script.
export function brake(ip, machineId, max = 120, windowMin = 10) {
  const key = `qr:${ip}:${machineId}`;
  if (tooMany(key, max, windowMin)) return false;
  noteFail(key);
  return true;
}

// ---------- passwords ----------
async function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function checkPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt') { await hashPassword('x'); return false; }   // equal work for unknown accounts
  const h = await scryptAsync(pw, Buffer.from(salt, 'base64'), 64, { N: +N, r: +r, p: +p, maxmem: 128 * 1024 * 1024 });
  return safeEq(h.toString('base64'), hash);
}
const COMMON = new Set(['password123', 'passw0rd123', '1234567890', 'qwertyuiop', 'letmein1234', 'welcome1234', 'administrator']);
export function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return 'That password is too easy to guess.';
  if (email && pw.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length > 3) return 'The password must not contain your email name.';
  return null;
}

// ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
export function b32decode(s) {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totpAt(secretB32, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', b32decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
// Returns the matching step (so it can be remembered) or 0.
export function totpCheck(secretB32, code, afterStep = 0, at = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return 0;
  const cur = Math.floor(at / 30000);
  for (const s of [cur, cur - 1, cur + 1]) if (s > afterStep && safeEq(totpAt(secretB32, s), c)) return s;
  return 0;
}
export const newSecret = () => b32encode(randomBytes(20));
export const otpauth = (email, secret) =>
  `otpauth://totp/${encodeURIComponent('Digital Kaizen')}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent('Digital Kaizen')}&algorithm=SHA1&digits=6&period=30`;

function makeRecoveryCodes() {
  const plain = Array.from({ length: 10 }, () => {
    const a = randomBytes(5).toString('hex').toUpperCase();
    return `${a.slice(0, 5)}-${a.slice(5)}`;
  });
  return { plain, hashes: plain.map(c => sha('rc:' + c.replace('-', ''))) };
}

// ---------- rate limiting ----------
function tooMany(key, max, windowMin) {
  const since = Date.now() - windowMin * 60000;
  db.prepare('DELETE FROM auth_attempts WHERE at < ?').run(Date.now() - 24 * 3600000);
  return db.prepare('SELECT COUNT(*) n FROM auth_attempts WHERE key = ? AND at >= ?').get(key, since).n >= max;
}
const noteFail = (key) => db.prepare('INSERT INTO auth_attempts (key, at) VALUES (?, ?)').run(key, Date.now());
const clearFails = (key) => db.prepare('DELETE FROM auth_attempts WHERE key = ?').run(key);

// ---------- queries ----------
const byId = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
const byEmail = (e) => db.prepare('SELECT * FROM users WHERE email = ?').get(String(e || '').trim().toLowerCase()) || null;
export const findByEmail = (e) => byEmail(e);
export const userCount = () => db.prepare(`SELECT COUNT(*) n FROM users WHERE role != 'operator'`).get().n;
// Accounts switch on with the first dashboard user. Names on the QR list do not count.
export const accountsEnabled = () => userCount() > 0;
export const hasOperators = () => db.prepare(`SELECT COUNT(*) n FROM users WHERE role='operator' AND status='active'`).get().n > 0;

const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
  twoFactor: Boolean(u.totp_on), hasPin: Boolean(u.pin_lookup),
  locked: Boolean(u.locked_until && u.locked_until > iso(now())),
  lastLogin: u.last_login, createdAt: u.created_at,
});
export const listUsers = () => db.prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser);

// ---------- invitations ----------
function makeInvite(userId, kind = 'invite') {
  const token = randomBytes(24).toString('base64url');
  db.prepare('DELETE FROM invites WHERE user_id = ? AND used_at IS NULL').run(userId);
  db.prepare('INSERT INTO invites (token_hash, user_id, kind, expires_at) VALUES (?,?,?,?)')
    .run(sha(token), userId, kind, plus(LIMITS.inviteH * 3600000));
  return token;
}

export async function createUser({ email, name, role, pin }, by = null) {
  name = String(name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Enter a name.' };
  if (!ROLES.includes(role)) return { ok: false, error: 'Pick a role.' };

  if (role === 'operator') {
    if (db.prepare(`SELECT 1 FROM users WHERE role='operator' AND lower(name)=lower(?)`).get(name)) return { ok: false, error: 'That name is already on the list.' };
    const id = Number(db.prepare(`INSERT INTO users (email, name, role, status, created_at) VALUES (NULL,?,?, 'active', ?)`)
      .run(name, role, iso(now())).lastInsertRowid);
    if (pin) { const r = setPin(id, pin, by); if (!r.ok) { db.prepare('DELETE FROM users WHERE id = ?').run(id); return r; } }
    log('user-created', { userId: id, who: by, detail: `operator ${name}` });
    return { ok: true, user: publicUser(byId(id)) };
  }

  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (byEmail(email)) return { ok: false, error: 'There is already an account with that email.' };
  const id = Number(db.prepare(`INSERT INTO users (email, name, role, status, created_at) VALUES (?,?,?, 'invited', ?)`)
    .run(email, name, role, iso(now())).lastInsertRowid);
  log('user-invited', { userId: id, who: by, detail: `${role} ${email}` });
  return { ok: true, user: publicUser(byId(id)), inviteToken: makeInvite(id) };
}

export function inviteInfo(token) {
  const inv = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha(String(token || '')));
  if (!inv || inv.used_at || inv.expires_at < iso(now())) return null;
  const u = byId(inv.user_id);
  return u ? { user: u, kind: inv.kind } : null;
}

// Step 1 of accepting: choose a password, get the authenticator secret.
// The secret stays the SAME for this link until the first code is accepted:
// going back, refreshing, a second tab or a double click all show the key
// already handed out, so a scan made earlier keeps working. Only "Scan a new
// code" (inviteRescan) replaces it, and the replaced keys are remembered so a
// code from an older authenticator entry can be named as such.
const pendingEnrol = new Map();   // user id -> { tok, secret, old[], hash, at }
const PENDING_MS = 30 * 60000;
function pendingFor(info, token) {
  const tok = sha(String(token));
  let p = pendingEnrol.get(info.user.id);
  if (!p || p.tok !== tok || Date.now() - p.at > PENDING_MS) {
    p = { tok, secret: newSecret(), old: [], hash: null, at: Date.now() };
    pendingEnrol.set(info.user.id, p);
  }
  return p;
}
export async function inviteStart(token, password) {
  const info = inviteInfo(token);
  if (!info) return { ok: false, error: 'This link has expired or was already used. Ask an admin for a new one.' };
  const bad = passwordProblem(password, info.user.email);
  if (bad) return { ok: false, error: bad };
  const p = pendingFor(info, token);   // chosen before the await, so two presses at once share it
  const hash = await hashPassword(password);
  if (pendingEnrol.get(info.user.id) === p) { p.hash = hash; p.at = Date.now(); }
  return { ok: true, email: info.user.email, name: info.user.name, secret: p.secret, uri: otpauth(info.user.email, p.secret) };
}

// "Scan a new code": a fresh key for the same link, keeping the password.
export function inviteRescan(token) {
  const info = inviteInfo(token);
  if (!info) return { ok: false, error: 'This link has expired or was already used. Ask an admin for a new one.' };
  const p = pendingEnrol.get(info.user.id);
  if (!p || !p.hash || p.tok !== sha(String(token)) || Date.now() - p.at > PENDING_MS) return { ok: false, restart: true, error: 'Start again: choose your password first.' };
  p.old = [p.secret, ...p.old].slice(0, 5);
  p.secret = newSecret();
  p.at = Date.now();
  return { ok: true, email: info.user.email, secret: p.secret, uri: otpauth(info.user.email, p.secret) };
}

const SCAN_AGAIN = 'delete every Digital Kaizen entry for this email in your authenticator app, press Scan a new code, scan it, and type the code it shows.';

// Step 2: prove the app works by typing the current code. Only then does
// the account become active, and recovery codes are shown once.
export function inviteFinish(token, code, ip) {
  const info = inviteInfo(token);
  if (!info) return { ok: false, error: 'This link has expired or was already used.' };
  const p = pendingEnrol.get(info.user.id);
  if (!p || !p.hash || p.tok !== sha(String(token)) || Date.now() - p.at > PENDING_MS) {
    return { ok: false, restart: true, error: 'This setup timed out. Choose your password again, then delete the old Digital Kaizen entry in your authenticator app and scan the new code.' };
  }
  const step = totpCheck(p.secret, code);
  if (!step) {
    if (p.old.some(s => totpCheck(s, code))) {
      return { ok: false, rescan: true, error: `That code is from an older Digital Kaizen entry, not the code on this screen. To fix it, ${SCAN_AGAIN}` };
    }
    return { ok: false, rescan: true, error: `That code did not match. Type the code showing now, not an old one. If it still fails, ${SCAN_AGAIN}` };
  }
  const rc = makeRecoveryCodes();
  db.prepare(`UPDATE users SET pw_hash=?, totp_secret=?, totp_on=1, totp_last=?, recovery=?, status='active', failed=0, locked_until=NULL WHERE id=?`)
    .run(p.hash, seal(p.secret), step, JSON.stringify(rc.hashes), info.user.id);
  db.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(iso(now()), sha(token));
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(info.user.id);
  pendingEnrol.delete(info.user.id);
  log('account-activated', { userId: info.user.id, who: info.user.email, ip });
  return { ok: true, recoveryCodes: rc.plain, session: openSession(info.user.id, 'staff', ip) };
}

// ---------- sessions ----------
function openSession(userId, kind, ip, ua = null) {
  const id = randomBytes(32).toString('base64url');
  const u = byId(userId);
  const ms = kind === 'pending' ? LIMITS.pendingMin * 60000
    : u.role === 'viewer' ? LIMITS.viewerDays * 86400000 : LIMITS.staffAbsH * 3600000;
  db.prepare('INSERT INTO sessions (id_hash, user_id, kind, created_at, last_seen, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?,?)')
    .run(sha(id), userId, kind, iso(now()), iso(now()), plus(ms), ip || null, ua ? String(ua).slice(0, 120) : null);
  return { token: id, maxAgeSec: Math.round(ms / 1000), kind };
}

export function sessionFrom(token, wantKind = 'staff') {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha(token));
  if (!s || s.kind !== wantKind) return null;
  const t = iso(now());
  if (s.expires_at < t) { db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash); return null; }
  const u = byId(s.user_id);
  if (!u || u.status !== 'active') return null;
  if (wantKind === 'staff' && u.role !== 'viewer') {
    // idle timeout for people who can change things
    if (plus(-LIMITS.staffIdleH * 3600000) > s.last_seen) { db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash); return null; }
  }
  db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?').run(t, s.id_hash);
  return publicUser(u);
}

export function endSession(token) { if (token) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha(token)); }
export const endAllSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

export const can = (user, min) => Boolean(user) && user.role !== 'operator' && RANK[user.role] >= RANK[min];

// ---------- sign in ----------
const GENERIC = 'Wrong email or password.';

export async function login(email, password, ip, ua) {
  const ipKey = `ip:${ip}`;
  if (tooMany(ipKey, LIMITS.ipFails, LIMITS.ipWindowMin)) return { ok: false, status: 429, error: 'Too many attempts from this device. Wait 15 minutes.' };
  const u = byEmail(email);
  const t = iso(now());
  if (u && u.locked_until && u.locked_until > t) {
    log('login-locked', { userId: u.id, who: u.email, ip });
    return { ok: false, status: 423, error: 'This account is locked after too many wrong passwords. Try again in a few minutes, or ask an admin.' };
  }
  const okPw = await checkPassword(String(password || ''), u?.pw_hash);
  if (!u || u.status !== 'active' || u.role === 'operator' || !okPw) {
    noteFail(ipKey);
    if (u && u.status === 'active') {
      const f = u.failed + 1;
      if (f >= LIMITS.maxFails) {
        db.prepare('UPDATE users SET failed = 0, locked_until = ? WHERE id = ?').run(plus(LIMITS.lockMin * 60000), u.id);
        log('account-locked', { userId: u.id, who: u.email, ip });
      } else db.prepare('UPDATE users SET failed = ? WHERE id = ?').run(f, u.id);
    }
    log('login-failed', { userId: u?.id ?? null, who: String(email).slice(0, 80), ip });
    return { ok: false, status: 401, error: GENERIC };
  }
  db.prepare('UPDATE users SET failed = 0 WHERE id = ?').run(u.id);
  return { ok: true, need2fa: true, pending: openSession(u.id, 'pending', ip, ua) };
}

export function verifySecondStep(pendingToken, code, ip, ua) {
  const ipKey = `ip:${ip}`;
  if (tooMany(ipKey, LIMITS.ipFails, LIMITS.ipWindowMin)) return { ok: false, status: 429, error: 'Too many attempts from this device. Wait 15 minutes.' };
  const s = pendingToken && db.prepare('SELECT * FROM sessions WHERE id_hash = ? AND kind = ?').get(sha(pendingToken), 'pending');
  if (!s || s.expires_at < iso(now())) return { ok: false, status: 401, error: 'That sign-in timed out. Start again.' };
  const u = byId(s.user_id);
  const fail = (msg) => {
    noteFail(ipKey);
    const f = u.failed + 1;
    if (f >= LIMITS.maxFails) {
      db.prepare('UPDATE users SET failed = 0, locked_until = ? WHERE id = ?').run(plus(LIMITS.lockMin * 60000), u.id);
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash);
      log('account-locked', { userId: u.id, who: u.email, ip });
    } else db.prepare('UPDATE users SET failed = ? WHERE id = ?').run(f, u.id);
    log('2fa-failed', { userId: u.id, who: u.email, ip });
    return { ok: false, status: 401, error: msg };
  };

  const raw = String(code || '').trim();
  let usedRecovery = false;
  const step = totpCheck(unseal(u.totp_secret), raw, u.totp_last);
  if (step) db.prepare('UPDATE users SET totp_last = ? WHERE id = ?').run(step, u.id);
  else {
    // a one-time recovery code
    const h = sha('rc:' + raw.toUpperCase().replace(/[\s-]/g, ''));
    const list = JSON.parse(u.recovery || '[]');
    const i = list.indexOf(h);
    if (i < 0) return fail('That code is not right.');
    list.splice(i, 1);
    db.prepare('UPDATE users SET recovery = ? WHERE id = ?').run(JSON.stringify(list), u.id);
    usedRecovery = true;
  }
  clearFails(ipKey);
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash);
  db.prepare('UPDATE users SET failed = 0, last_login = ? WHERE id = ?').run(iso(now()), u.id);
  log(usedRecovery ? 'login-recovery-code' : 'login', { userId: u.id, who: u.email, ip });
  return {
    ok: true, session: openSession(u.id, 'staff', ip, ua), user: publicUser(byId(u.id)),
    recoveryLeft: usedRecovery ? JSON.parse(byId(u.id).recovery).length : undefined,
  };
}

// ---------- the operator list (QR page) ----------
export const operatorList = () =>
  db.prepare(`SELECT id, name, pin_lookup IS NOT NULL AS has_pin FROM users WHERE role='operator' AND status='active' ORDER BY name COLLATE NOCASE`)
    .all().map(r => ({ id: r.id, name: r.name, hasPin: Boolean(r.has_pin) }));

// Checks the person picked from the list. Returns { ok, operator } where
// operator is { id, name } or null when nobody was picked. When
// `pinRequired` (a Setting, off by default) a name must come with its PIN.
export function checkOperator(id, pin, { pinRequired = false, ip = '', machine = '' } = {}) {
  if (id === undefined || id === null || id === '') {
    return pinRequired ? { ok: false, status: 400, error: 'Pick your name.' } : { ok: true, operator: null };
  }
  const u = byId(Number(id));
  if (!u || u.role !== 'operator' || u.status !== 'active') return { ok: false, status: 400, error: 'That name is not on the list.' };
  // PINs are off unless Settings turn them on, and a name with no PIN set never asks.
  if (!pinRequired || !u.pin_lookup) return { ok: true, operator: { id: u.id, name: u.name } };
  const key = `pin:${ip}:${machine}`;
  if (tooMany(key, LIMITS.pinFails, LIMITS.pinWindowMin)) return { ok: false, status: 429, error: 'Too many wrong PINs. Wait 10 minutes.' };
  if (!/^\d{4,8}$/.test(String(pin || '')) || !safeEq(pinLookup(u.id, String(pin)), u.pin_lookup)) {
    noteFail(key);
    return { ok: false, status: 401, error: 'PIN not right.' };
  }
  clearFails(key);
  return { ok: true, operator: { id: u.id, name: u.name } };
}

// ---------- account management ----------
async function reauth(userId, password, code) {
  const u = byId(userId);
  if (!u || !(await checkPassword(String(password || ''), u.pw_hash))) return 'Your current password is not right.';
  const step = totpCheck(unseal(u.totp_secret), code, u.totp_last);
  if (!step) return 'The authenticator code is not right.';
  db.prepare('UPDATE users SET totp_last = ? WHERE id = ?').run(step, u.id);
  return null;
}

export async function changePassword(userId, current, code, next, keepToken) {
  const bad = await reauth(userId, current, code);
  if (bad) return { ok: false, error: bad };
  const problem = passwordProblem(next, byId(userId).email);
  if (problem) return { ok: false, error: problem };
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashPassword(next), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(userId, keepToken ? sha(keepToken) : '');
  log('password-changed', { userId });
  return { ok: true };
}

export async function newRecoveryCodes(userId, password, code) {
  const bad = await reauth(userId, password, code);
  if (bad) return { ok: false, error: bad };
  const rc = makeRecoveryCodes();
  db.prepare('UPDATE users SET recovery = ? WHERE id = ?').run(JSON.stringify(rc.hashes), userId);
  log('recovery-codes-renewed', { userId });
  return { ok: true, recoveryCodes: rc.plain };
}

export function recoveryLeft(userId) { return JSON.parse(byId(userId)?.recovery || '[]').length; }

const activeAdmins = () => db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin' AND status='active'`).get().n;

// An admin edits somebody else. The last working admin can never be
// demoted, disabled or locked out of their own power.
export function adminUpdate(id, { role, status, name }, by) {
  const u = byId(id);
  if (!u) return { ok: false, error: 'No such user.' };
  const wasAdmin = u.role === 'admin' && u.status === 'active';
  const newRole = role ?? u.role, newStatus = status ?? u.status;
  if (role && !ROLES.includes(role)) return { ok: false, error: 'Unknown role.' };
  if (status && !['active', 'disabled'].includes(status)) return { ok: false, error: 'Unknown status.' };
  if (wasAdmin && (newRole !== 'admin' || newStatus !== 'active') && activeAdmins() <= 1) {
    return { ok: false, error: 'This is the only admin. Make someone else an admin first.' };
  }
  if ((newRole === 'operator') !== (u.role === 'operator')) return { ok: false, error: 'Create the person again to change between operator and staff.' };
  db.prepare('UPDATE users SET role = ?, status = ?, name = ? WHERE id = ?').run(newRole, newStatus, String(name ?? u.name).trim().slice(0, 80), id);
  if (newStatus === 'disabled') endAllSessions(id);
  log('user-updated', { userId: id, who: by, detail: JSON.stringify({ role: newRole, status: newStatus }) });
  return { ok: true, user: publicUser(byId(id)) };
}

// Lost phone or forgotten password: a fresh one-time link. The old
// password and authenticator stop working the moment it is issued.
export function adminReset(id, by) {
  const u = byId(id);
  if (!u || u.role === 'operator') return { ok: false, error: 'No such staff account.' };
  db.prepare(`UPDATE users SET pw_hash = NULL, totp_secret = NULL, totp_on = 0, recovery = NULL, status = 'invited', failed = 0, locked_until = NULL WHERE id = ?`).run(id);
  endAllSessions(id);
  log('user-reset', { userId: id, who: by });
  return { ok: true, inviteToken: makeInvite(id, 'reset') };
}

export function setPin(id, pin, by) {
  const u = byId(id);
  if (!u || u.role !== 'operator') return { ok: false, error: 'Not an operator.' };
  if (pin === '' || pin === null || pin === undefined) {
    db.prepare('UPDATE users SET pin_lookup = NULL WHERE id = ?').run(id);
    return { ok: true, cleared: true };
  }
  if (!/^\d{4,8}$/.test(String(pin))) return { ok: false, error: 'A PIN is 4 to 8 digits.' };
  db.prepare('UPDATE users SET pin_lookup = ? WHERE id = ?').run(pinLookup(id, String(pin)), id);
  log('pin-changed', { userId: id, who: by });
  return { ok: true };
}

export function unlock(id) {
  db.prepare('UPDATE users SET failed = 0, locked_until = NULL WHERE id = ?').run(id);
  return { ok: true };
}

export const recentAuthLog = (limit = 60) => db.prepare('SELECT * FROM auth_log ORDER BY id DESC LIMIT ?').all(limit);


