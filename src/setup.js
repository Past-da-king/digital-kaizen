// ============================================================
// First-run setup: making the first admin safely.
//
// The old way left a brand-new install's dashboard open, so whoever
// reached it first could run things. Now:
//
//   NEW install (the database file did not exist at start, no shared
//   password, no account): the dashboard is closed. The only open page
//   is /setup, and it needs a one-time setup token that the server
//   prints in its window and log at every start. It makes the first
//   admin and hands over to the normal invite page (password, QR,
//   6 digits, recovery codes).
//
//   EXISTING install (it has data, or it uses the shared password):
//   nothing changes. The dashboard stays as it was, so an upgrade can
//   never lock the floor out. Setup is offered only after the shared
//   password is entered, or by command: npm run admin.
//
//   DEMO (the simulator is running): the dashboard stays open by
//   design and /setup is off. Use npm run admin to try accounts.
//
// The QR operator page, sensor ingest and MQTT are never behind any of this.
// ============================================================
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import * as users from './users.js';
import { isLocked, validSession } from './auth.js';
import { baseUrl } from './escalation.js';

let demo = false;
let token = null;            // in memory only: a new one at every start, printed, never stored
let spent = false;
let fails = []; // timestamps of wrong tokens

export function configure({ demo: d = false } = {}) {
  demo = Boolean(d);
  spent = false;
  token = randomBytes(24).toString('base64url');
  fails = [];
}
const ensure = () => { if (!token && !spent) configure({ demo }); };

const marker = () => { try { return JSON.parse(db.prepare(`SELECT value FROM settings WHERE key = 'setupGate'`).get()?.value ?? 'null'); } catch { return null; } };

// Is the dashboard closed until the first admin is made?
export function gateOn() {
  return !demo && marker() === 'on' && !users.accountsEnabled() && !isLocked();
}

// Who may use /setup right now, and how.
//   { open: true, via: 'token' | 'shared-password' }  or  { open: false, reason }
export function access(cookieHeader) {
  if (users.accountsEnabled()) return { open: false, reason: 'accounts-exist', message: 'An admin already exists. Sign in, or ask an admin for a link.' };
  if (demo) return { open: false, reason: 'demo', message: 'Setup is off in the demo. Use: npm run admin -- "Name" email' };
  if (isLocked()) {
    return validSession(cookieHeader)
      ? { open: true, via: 'shared-password' }
      : { open: false, reason: 'sign-in-first', message: 'Enter the dashboard password first (it is the temporary one from npm run setup), then open this page again.' };
  }
  if (marker() === 'on') return { open: true, via: 'token' };
  return { open: false, reason: 'existing-install', message: 'This install already has data and is running as before. Make the first admin on the PC with: npm run admin -- "Name" email' };
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export async function createFirstAdmin({ name, email, token: given, cookie, ip = '' }) {
  ensure();
  const a = access(cookie);
  if (!a.open) return { ok: false, status: 403, error: a.message };
  if (a.via === 'token') {
    const now = Date.now();
    fails = fails.filter(t => now - t < 15 * 60000);
    if (fails.length >= 10) return { ok: false, status: 429, error: 'Too many wrong setup codes. Wait 15 minutes, or restart the app for a new one.' };
    if (spent || !token || !given || !same(token, given)) {
      fails.push(now);
      return { ok: false, status: 403, error: spent ? 'That setup code was already used. Restart the app to get a new one, or use: npm run admin -- "Name" email' : 'That setup code is not right. Copy it from the server window (or log) again.' };
    }
  }
  const r = await users.createUser({ name, email, role: 'admin' }, `first-run setup${ip ? ' from ' + ip : ''}`);
  if (!r.ok) return { ok: false, status: 400, error: r.error };   // a typo does not burn the code
  if (a.via === 'token') { spent = true; token = null; }
  return { ok: true, inviteToken: r.inviteToken };
}

// Lines for the console and the log at start.
export function startupLines() {
  ensure();
  const base = baseUrl();
  if (demo) return { gated: false, lines: [] };
  if (users.accountsEnabled() || isLocked()) return { gated: false, lines: [] };
  if (marker() === 'on') {
    return { gated: true, lines: [
      'NEW INSTALL: the dashboard is CLOSED until the first admin is made.',
      `Open this link on this PC or any PC you trust (it works once, until you restart):`,
      `${base}/setup?t=${token}`,
    ] };
  }
  return { gated: false, lines: [] };
}
export const currentToken = () => { ensure(); return token; };
