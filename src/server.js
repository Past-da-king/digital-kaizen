// ============================================================
// HTTP: the dashboard, its API, the QR log page's API and the device
// fallback route. Plain node:http, no framework, so it runs on a
// factory PC with nothing installed but Node.
//
// WHO CAN DO WHAT
//   Anyone         the static page shells, sign-in, the acknowledge link
//                  in an email (it carries a secret token), device
//                  readings.
//   QR page        needs the per-machine token printed in that machine's
//                  QR code. No login. Light rate limit.
//   Dashboard      a signed-in account. viewer reads; manager also
//                  acknowledges, resolves, retries mail and exports;
//                  admin also changes settings, people and sensors.
//   Before the first account exists the dashboard stays as it was
//   (open, or behind the old shared password) so an upgrade never locks
//   a factory out; creating the first admin switches accounts on.
// ============================================================

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { WEB, MACHINES, KAIZEN, SHIFTS, DOWNTIME_RULES } from './config.js';
import * as db from './db.js';
import * as settings from './settings.js';
import * as store from './store.js';
import * as users from './users.js';
import * as esc from './escalation.js';
import * as mail from './mail.js';
import * as oee from './oee.js';
import * as setup from './setup.js';
import { envBaseUrl } from './net.js';
import { getLive, subscribe, handlePayload, handleDevicePayload, unassignedDevices } from './ingest.js';
import { attribute, openFor, liveEventState, human } from './events.js';
import { isLocked, checkDashPassword, mintSession, validSession, secretsSource } from './auth.js';
import { getDevice, hasDevices } from './devices.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
export const PHOTOS = process.env.DK_PHOTOS || fileURLToPath(new URL('../data/photos/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const json = (res, body, code = 200, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

async function readJson(req, limit = 200 * 1024) {
  if (req._body) return req._body;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { req._body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { req._body = {}; }
  return req._body;
}

async function readRaw(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const cookie = (name, value, maxAgeSec, req) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` +
  (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');
const getCookie = (req, name) => {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
};
const clientIp = (req) => (req.socket.remoteAddress || '').replace('::ffff:', '');
const ua = (req) => req.headers['user-agent'] || '';

// Default window: the current shift-day so far.
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
function windowFrom(q) {
  const now = new Date();
  const from = q.get('from') || fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  let to = q.get('to') || fmt(new Date(now.getTime() + 60000));
  // a bare date means "to the end of that day"
  if (/^\d{4}-\d\d-\d\d$/.test(to)) to = `${to} 23:59:59`;
  return { from: /^\d{4}-\d\d-\d\d$/.test(from) ? `${from} 00:00:00` : from, to };
}

// ---------- csv ----------
// A cell that starts with = + - @ is read by a spreadsheet as a formula.
// Operators type free text, so neutralise it.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
const csv = (head, rows) => '﻿' + [head.join(','), ...rows.map(r => r.map(cell).join(','))].join('\r\n');
function sendCsv(res, name, body) {
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}_${new Date().toISOString().slice(0, 10)}.csv"` });
  res.end(body);
}

// ---------- who needs which role ----------
const ADMIN_PAGES = new Set(['/settings.html', '/users.html']);
const MANAGER_POST = [/^\/api\/issues\//, /^\/api\/mail\/retry$/];
function roleNeeded(method, path) {
  if (ADMIN_PAGES.has(path)) return 'admin';
  if (path.startsWith('/api/users') || path === '/api/auth-log') return 'admin';
  if (path === '/api/settings' || path === '/api/mail/test' || path === '/api/devices/assign' || path.startsWith('/api/demo/')) return 'admin';
  if (path === '/api/qr-token/rotate') return 'admin';
  if (method === 'POST' && MANAGER_POST.some(r => r.test(path))) return 'manager';
  return 'viewer';
}

// Pages and scripts that are only shells (the data behind them is gated).
const OPEN_PATHS = new Set([
  '/login.html', '/login.js', '/invite.html', '/invite.js', '/setup', '/setup.html', '/setup.js', '/api/setup/state', '/api/setup/create', '/ack', '/ack.html', '/ack.js',
  '/log.html', '/log.js', '/log.css', '/ui.js', '/attribute.html', '/attribute.js', '/style.css', '/favicon.ico', '/favicon.svg',
  '/api/login', '/api/auth/state', '/api/auth/login', '/api/auth/2fa', '/api/auth/logout',
  '/api/invite/info', '/api/invite/start', '/api/invite/rescan', '/api/invite/finish', '/api/ack/info', '/api/ack',
  // The device HTTP fallback only ACCEPTS readings, it never returns any.
  '/machine-data', '/device-data',
]);
// The QR page's own calls: the machine token, not a login.
const QR_PATHS = new Set([
  '/api/log/context', '/api/log/downtime', '/api/log/defects', '/api/log/photo',
  '/api/events/open', '/api/attribute',
]);

// ---------- the QR token check ----------
function qrAuth(machineId, q, body) {
  const spec = MACHINES.find(x => x.id === machineId);
  if (!spec) return { ok: false, status: 404, error: `Unknown machine "${machineId}". Check the QR label.` };
  const given = q.get('k') || body?.key;
  if (!users.tokenOk(machineId, settings.machineEpoch(machineId), given)) {
    return { ok: false, status: 403, error: 'This link is not valid for that machine. Scan the code on the machine itself.' };
  }
  return { ok: true, spec };
}

export function qrLink(machineId, base) {
  return `${base}/log.html?m=${machineId}&k=${users.machineToken(machineId, settings.machineEpoch(machineId))}`;
}

// What the page should offer, from what the sensors say right now.
function machineState(machineId) {
  const live = getLive().find(x => x.machine_id === machineId);
  const ev = openFor(machineId);
  if (!live || live.offline) return { state: 'unknown', status: 'OFFLINE', event: ev };
  if (ev || live.status === 'DOWNTIME') return { state: 'down', status: live.status, event: ev };
  return { state: 'running', status: live.status, event: null };
}

const minutesAgoIso = (min, now = new Date()) => fmt(new Date(now.getTime() - min * 60000));

// "08:30" -> the most recent time that was 08:30 (today, or yesterday if that is still in the future)
function lastClock(hhmm, now) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], 0);
  if (d.getTime() > now.getTime() + 60000) d.setDate(d.getDate() - 1);
  return d;
}

export function startServer({ onLog = () => {}, demo = false } = {}) {
  setup.configure({ demo });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams;
    const path = url.pathname;

    try {
      // A browser page on another site must not be able to make this one act.
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
        let o = ''; try { o = new URL(req.headers.origin).host; } catch { /* bad origin */ }
        if (o !== req.headers.host) return json(res, { ok: false, error: 'cross-site request refused' }, 403);
      }

      // ------------------------------------------------------------
      // ACCESS
      // ------------------------------------------------------------
      let me = null;
      if (users.accountsEnabled()) me = users.sessionFrom(getCookie(req, 'dk_staff'), 'staff');

      if (!OPEN_PATHS.has(path) && !QR_PATHS.has(path)) {
        if (setup.gateOn()) {
          // brand-new install: closed until the first admin exists
          const isPage = !path.startsWith('/api/') && path !== '/photos' && !path.startsWith('/photos/');
          if (isPage) { res.writeHead(302, { location: '/setup' }); return res.end(); }
          return json(res, { ok: false, error: 'setup needed: open /setup on the server' }, 401);
        }
        if (users.accountsEnabled()) {
          const need = roleNeeded(req.method, path);
          const isPage = !path.startsWith('/api/') && path !== '/photos' && !path.startsWith('/photos/');
          if (!me) {
            if (isPage || req.headers.accept?.includes('text/html')) { res.writeHead(302, { location: '/login.html' }); return res.end(); }
            return json(res, { ok: false, error: 'not signed in' }, 401);
          }
          if (!users.can(me, need)) {
            if (isPage) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end(`Your role (${me.role}) cannot open this. Ask an admin.`); }
            return json(res, { ok: false, error: `needs the ${need} role` }, 403);
          }
        } else if (isLocked() && !validSession(req.headers.cookie)) {
          // legacy single shared password, until the first account is made
          if (req.headers.accept?.includes('text/html')) { res.writeHead(302, { location: '/login.html' }); return res.end(); }
          return json(res, { ok: false, error: 'not signed in' }, 401);
        }
      }

      // ---------- legacy shared-password login (until accounts exist) ----------
      if (req.method === 'POST' && path === '/api/login') {
        const b = await readJson(req);
        if (!checkDashPassword(b.password)) return json(res, { ok: false, error: 'wrong password' }, 401);
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `dk_session=${encodeURIComponent(mintSession())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`,
        });
        return res.end(JSON.stringify({ ok: true }));
      }

      // ============================================================
      // ACCOUNTS
      // ============================================================
      if (path === '/api/auth/state') {
        return json(res, { accounts: users.accountsEnabled(), needsSetup: setup.gateOn(), legacy: !users.accountsEnabled() && isLocked(), user: me });
      }
      // ---- first-run setup (see setup.js)
      if (path === '/setup') return await serveFile(res, join(PUBLIC, 'setup.html'));
      if (path === '/api/setup/state') {
        const a = setup.access(req.headers.cookie);
        return json(res, { open: a.open, via: a.via || null, reason: a.reason || null, message: a.message || null });
      }
      if (req.method === 'POST' && path === '/api/setup/create') {
        const b = await readJson(req);
        const r = await setup.createFirstAdmin({ name: b.name, email: b.email, token: b.token, cookie: req.headers.cookie, ip: clientIp(req) });
        if (!r.ok) return json(res, { ok: false, error: r.error }, r.status);
        return json(res, { ok: true, invite: `/invite.html?t=${r.inviteToken}` });
      }
      if (path === '/api/me') return json(res, { ok: true, user: me, accounts: users.accountsEnabled(), recoveryLeft: me ? users.recoveryLeft(me.id) : null });

      if (req.method === 'POST' && path === '/api/auth/login') {
        const b = await readJson(req);
        const r = await users.login(b.email, b.password, clientIp(req), ua(req));
        if (!r.ok) return json(res, { ok: false, error: r.error }, r.status);
        return json(res, { ok: true, need2fa: true }, 200, { 'set-cookie': cookie('dk_pend', r.pending.token, r.pending.maxAgeSec, req) });
      }
      if (req.method === 'POST' && path === '/api/auth/2fa') {
        const b = await readJson(req);
        const r = users.verifySecondStep(getCookie(req, 'dk_pend'), b.code, clientIp(req), ua(req));
        if (!r.ok) return json(res, { ok: false, error: r.error }, r.status);
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': [cookie('dk_staff', r.session.token, r.session.maxAgeSec, req), cookie('dk_pend', '', 0, req)],
        });
        return res.end(JSON.stringify({ ok: true, user: r.user, recoveryLeft: r.recoveryLeft }));
      }
      if (req.method === 'POST' && path === '/api/auth/logout') {
        users.endSession(getCookie(req, 'dk_staff'));
        return json(res, { ok: true }, 200, { 'set-cookie': [cookie('dk_staff', '', 0, req), cookie('dk_pend', '', 0, req)] });
      }
      if (req.method === 'POST' && path === '/api/auth/password') {
        const b = await readJson(req);
        return json(res, await users.changePassword(me.id, b.current, b.code, b.next, getCookie(req, 'dk_staff')));
      }
      if (req.method === 'POST' && path === '/api/auth/recovery') {
        const b = await readJson(req);
        return json(res, await users.newRecoveryCodes(me.id, b.password, b.code));
      }

      // ---- one-time invitation links
      if (path === '/api/invite/info') {
        const i = users.inviteInfo(q.get('t'));
        return i ? json(res, { ok: true, name: i.user.name, email: i.user.email, role: i.user.role, kind: i.kind }) : json(res, { ok: false, error: 'This link has expired or was already used. Ask an admin for a new one.' }, 404);
      }
      if (req.method === 'POST' && path === '/api/invite/start') {
        const b = await readJson(req);
        const r = await users.inviteStart(b.t, b.password);
        if (!r.ok) return json(res, r, 400);
        const png = await QRCode.toDataURL(r.uri, { width: 240, margin: 1 });
        return json(res, { ok: true, secret: r.secret, qr: png, email: r.email });
      }
      if (req.method === 'POST' && path === '/api/invite/rescan') {
        const b = await readJson(req);
        const r = users.inviteRescan(b.t);
        if (!r.ok) return json(res, r, 400);
        const png = await QRCode.toDataURL(r.uri, { width: 240, margin: 1 });
        return json(res, { ok: true, secret: r.secret, qr: png, email: r.email });
      }
      if (req.method === 'POST' && path === '/api/invite/finish') {
        const b = await readJson(req);
        const r = users.inviteFinish(b.t, b.code, clientIp(req));
        if (!r.ok) return json(res, r, 400);
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': cookie('dk_staff', r.session.token, r.session.maxAgeSec, req) });
        return res.end(JSON.stringify({ ok: true, recoveryCodes: r.recoveryCodes }));
      }

      // ---- admin: people
      if (path === '/api/users' && req.method === 'GET') return json(res, { users: users.listUsers() });
      if (path === '/api/auth-log') return json(res, { log: users.recentAuthLog(100) });
      if (req.method === 'POST' && path === '/api/users') {
        const b = await readJson(req);
        const r = await users.createUser(b, me?.email || 'admin');
        if (!r.ok) return json(res, r, 400);
        const out = { ok: true, user: r.user };
        if (r.inviteToken) {
          out.inviteLink = `${esc.baseUrl()}/invite.html?t=${r.inviteToken}`;
          if (b.emailInvite && mail.mailReady()) {
            store.enqueueMail({ kind: 'invite', to: r.user.email, subject: '[Digital Kaizen] Your account', now: new Date(),
              text: `Hello ${r.user.name},\n\nAn account has been made for you on the Digital Kaizen dashboard (${r.user.role}).\nOpen this link within 72 hours to choose a password and set up your authenticator app:\n\n${out.inviteLink}\n` });
            out.emailed = true; mail.processQueue().catch(() => {});
          }
        }
        return json(res, out);
      }
      if (req.method === 'POST' && path === '/api/users/update') {
        const b = await readJson(req);
        return json(res, users.adminUpdate(Number(b.id), b, me?.email));
      }
      if (req.method === 'POST' && path === '/api/users/reset') {
        const b = await readJson(req);
        const r = users.adminReset(Number(b.id), me?.email);
        if (r.ok) r.inviteLink = `${esc.baseUrl()}/invite.html?t=${r.inviteToken}`;
        delete r.inviteToken;
        return json(res, r);
      }
      if (req.method === 'POST' && path === '/api/users/pin') {
        const b = await readJson(req);
        return json(res, users.setPin(Number(b.id), b.pin, me?.email));
      }
      if (req.method === 'POST' && path === '/api/users/unlock') {
        const b = await readJson(req);
        return json(res, users.unlock(Number(b.id)));
      }

      // ---- the e-mail link that stops an escalation
      if (path === '/ack') { return await serveFile(res, join(PUBLIC, "ack.html")); }
      if (path === '/api/ack/info') {
        const i = store.issueByToken(q.get('t'));
        if (!i) return json(res, { ok: false, error: 'This link is not valid.' }, 404);
        return json(res, { ok: true, issue: esc.issueView(i) });
      }
      if (req.method === 'POST' && path === '/api/ack') {
        const b = await readJson(req);
        const r = esc.acknowledge(String(b.t || ''), String(b.name || '').trim().slice(0, 60) || null);
        if (!r.ok) return json(res, r, 404);
        return json(res, { ok: true, already: r.already, issue: esc.issueView(r.issue) });
      }

      // ============================================================
      // THE QR LOG PAGE
      // ============================================================
      if (QR_PATHS.has(path)) {
        const body = (req.method === 'POST' && path !== '/api/log/photo') ? await readJson(req) : null;
        const machineId = q.get('machine') || q.get('m') || body?.machine;
        const auth = qrAuth(machineId, q, body);
        if (!auth.ok) return json(res, { ok: false, error: auth.error }, auth.status);
        if (!users.brake(clientIp(req), machineId)) return json(res, { ok: false, error: 'Slow down a moment and try again.' }, 429);

        // who is logging: a name from the list, with a PIN only if Settings say so
        const who = () => users.checkOperator(body?.operatorId ?? q.get('o'), body?.pin ?? q.get('pin'), {
          pinRequired: settings.all().operatorPinRequired, ip: clientIp(req), machine: machineId,
        });

        // ---- everything the page needs to draw itself
        if (path === '/api/log/context') {
          const st = machineState(machineId);
          const now = new Date();
          const cur = store.shiftOf(now);
          const unexplained = db.recentDowntime(machineId, 8).filter(e => e.state === 'CLOSED' && !e.reason_code && (e.seconds || 0) >= 60)
            .slice(0, 3).map(e => ({ id: e.id, started_at: e.started_at, duration_human: human(e.seconds || 0) }));
          const cfg = settings.all();
          return json(res, {
            ok: true,
            machine: { id: auth.spec.id, name: auth.spec.name, part: auth.spec.part },
            state: st.state, status: st.status,
            event: st.event ? { id: st.event.id, started_at: st.event.started_at, elapsed_seconds: st.event.elapsed_seconds, elapsed_human: st.event.elapsed_human, reason_code: st.event.reason_code } : null,
            unexplained,
            reasons: settings.reasons(), defectTypes: settings.defectTypes(),
            operators: users.operatorList(),
            pinRequired: cfg.operatorPinRequired,
            shift: cur.shift, shiftDay: cur.day, shifts: SHIFTS.map(s => s.name),
            serverTime: fmt(now),
            defectsThisShift: store.defectsInShift(machineId, cur.day, cur.shift),
            defectLimit: cfg.thresholds.defectsPerShift,
            recent: [
              ...store.listDowntime({ machine: machineId, from: minutesAgoIso(60 * 24 * 2, now), to: fmt(new Date(now.getTime() + 60000)), limit: 5 })
                .map(r => ({ kind: 'downtime', id: r.id, at: r.logged_at, text: `${r.reason_label}, ${Math.round(r.minutes)} min`, by: r.operator })),
              ...store.listDefects({ machine: machineId, from: minutesAgoIso(60 * 24 * 2, now), to: fmt(new Date(now.getTime() + 60000)), limit: 5 })
                .map(r => ({ kind: 'defects', id: r.id, at: r.logged_at, text: `${r.qty} x ${r.type_label}`, by: r.operator })),
            ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6),
          });
        }

        // ---- the older attribute page (kept working for printed stickers)
        if (path === '/api/events/open') {
          const st = machineState(machineId);
          return json(res, {
            machine: { id: auth.spec.id, name: auth.spec.name, part: auth.spec.part },
            live: { offline: st.state === 'unknown', status: st.status },
            event: st.event, reasons: settings.reasons().map(r => ({ ...r, icon: '' })),
            recent: db.recentDowntime(machineId, 5).filter(e => e.state === 'CLOSED' && !e.reason_code).map(e => ({ ...e, duration_human: human(e.seconds || 0) })),
          });
        }
        if (path === '/api/attribute') {
          const o = who(); if (!o.ok) return json(res, o, o.status);
          const r = attribute(body.eventId, body.code, body.note, o.operator?.name);
          return json(res, r, r.ok ? 200 : 400);
        }

        // ---- LOG DOWNTIME
        if (req.method === 'POST' && path === '/api/log/downtime') {
          const o = who(); if (!o.ok) return json(res, o, o.status);
          const reason = settings.reasons().find(r => r.code === body.reasonCode);
          if (!reason) return json(res, { ok: false, error: 'Pick a reason.' }, 400);
          const note = String(body.note || '').trim().slice(0, 500);
          const now = new Date();

          // Explaining a stop the sensor already saw: times come from the sensor.
          if (body.eventId) {
            const ev = db.downtimeById(Number(body.eventId));
            if (!ev || ev.machine_id !== machineId) return json(res, { ok: false, error: 'That stop is not on this machine.' }, 400);
            const r = attribute(ev.id, reason.code, note, o.operator?.name);
            if (!r.ok) return json(res, r, 400);
            return json(res, { ok: true, eventId: ev.id, reason: reason.label, open: ev.state === 'OPEN' });
          }

          // A stop typed in by hand: the SERVER clock decides when. A phone's own
          // clock is often wrong, so the phone sends "how long" and "how long ago".
          let minutes = Number(body.minutes);
          let end = now;
          if (body.startClock && body.endClock) {
            const e = lastClock(body.endClock, now);
            let s = lastClock(body.startClock, e || now);
            if (!e || !s) return json(res, { ok: false, error: 'Enter the times as hours and minutes.' }, 400);
            if (s.getTime() >= e.getTime()) s = new Date(s.getTime() - 86400000);
            end = e; minutes = (e - s) / 60000;
          } else {
            const ago = Number(body.endedAgoMin || 0);
            if (!(ago >= 0 && ago <= 60 * 48)) return json(res, { ok: false, error: 'That "ended" time is not possible.' }, 400);
            end = new Date(now.getTime() - ago * 60000);
          }
          if (!(minutes > 0 && minutes <= 24 * 60)) return json(res, { ok: false, error: 'Enter how long it was down (1 minute to 24 hours).' }, 400);
          minutes = Math.round(minutes * 10) / 10;
          const start = new Date(end.getTime() - minutes * 60000);
          const r = store.addDowntimeLog({
            clientId: body.clientId, machineId, reasonCode: reason.code, reasonLabel: reason.label, planned: reason.planned,
            startedAt: fmt(start), endedAt: fmt(end), minutes, shift: body.shift, note,
            operatorId: o.operator?.id, operator: o.operator?.name, now, source: 'qr',
          });
          return json(res, { ok: true, id: r.id, duplicate: r.duplicate, minutes });
        }

        // ---- LOG DEFECTS
        if (req.method === 'POST' && path === '/api/log/defects') {
          const o = who(); if (!o.ok) return json(res, o, o.status);
          const type = settings.defectTypes().find(t => t.code === body.typeCode);
          if (!type) return json(res, { ok: false, error: 'Pick the defect type.' }, 400);
          const qty = Math.round(Number(body.count));
          if (!(qty >= 1 && qty <= 100000)) return json(res, { ok: false, error: 'Enter how many defects (1 or more).' }, 400);
          const shift = body.shift && SHIFTS.some(s => s.name === body.shift) ? body.shift : undefined;
          const now = new Date();
          const r = store.addDefectLog({
            clientId: body.clientId, machineId, qty, typeCode: type.code, typeLabel: type.label, shift,
            note: String(body.note || '').trim().slice(0, 500), operatorId: o.operator?.id, operator: o.operator?.name,
            occurredAt: fmt(now), now,
          });
          let issue = null;
          if (!r.duplicate) issue = esc.checkDefects(machineId, r.shiftDay, r.shift, now);
          return json(res, {
            ok: true, id: r.id, duplicate: r.duplicate, shift: r.shift,
            shiftTotal: store.defectsInShift(machineId, r.shiftDay, r.shift), limit: settings.all().thresholds.defectsPerShift,
            escalated: Boolean(issue),
          });
        }

        // ---- the photo, sent after the entry so a slow upload never loses the log
        if (req.method === 'POST' && path === '/api/log/photo') {
          const id = Number(q.get('id'));
          const row = store.defectLog(id);
          if (!row || row.machine_id !== machineId) return json(res, { ok: false, error: 'No such entry on this machine.' }, 404);
          if (row.photo) return json(res, { ok: true, already: true });
          if (Date.now() - store.parse(row.logged_at).getTime() > 6 * 3600 * 1000) return json(res, { ok: false, error: 'Too late to add a photo to that entry.' }, 400);
          const buf = await readRaw(req, 6 * 1024 * 1024);
          const ext = buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg'
            : buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png'
            : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : null;
          if (!ext) return json(res, { ok: false, error: 'That is not a photo.' }, 400);
          await mkdir(PHOTOS, { recursive: true });
          const name = `${id}-${randomBytes(6).toString('hex')}.${ext}`;
          await writeFile(join(PHOTOS, name), buf);
          store.setDefectPhoto(id, name);
          return json(res, { ok: true });
        }
      }

      // photos are for signed-in staff
      if (path.startsWith('/photos/')) {
        const name = normalize(path.slice(8)).replace(/^(\.\.[/\\])+/, '');
        const file = join(PHOTOS, name);
        if (!file.startsWith(PHOTOS) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': TYPES['.' + name.split('.').pop()] || 'image/jpeg', 'cache-control': 'private, max-age=86400' });
        return createReadStream(file).pipe(res);
      }

      // ============================================================
      // DASHBOARD DATA
      // ============================================================
      // ---- the device's HTTP fallback, same path as the client's flow
      if (req.method === 'POST' && (path === '/machine-data' || path === '/device-data')) {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const p = JSON.parse(body);
          if (path === '/device-data' || p.device_id) handleDevicePayload(p, 'http');
          else handlePayload(p, 'http');
        } catch { /* ignore junk */ }
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('OK');
      }

      if (path === '/api/config') {
        const cfg = settings.all();
        return json(res, {
          machines: MACHINES.map(m => ({ id: m.id, name: m.name, part: m.part, cycleSec: m.cycleSec, mould: settings.mouldFor(m.id) })),
          kaizen: KAIZEN, shifts: SHIFTS, metrics: db.METRIC_LABELS, range: db.dataRange(),
          reasons: settings.reasons(), defectTypes: settings.defectTypes(),
          // roles and timings only; the addresses are on the admin Settings screen
          ladder: cfg.ladder.map(s => ({ level: s.level, afterMin: s.afterMin, roles: s.people.filter(p => p.enabled).map(p => p.role || p.name) })),
          thresholds: cfg.thresholds, escalationEnabled: cfg.escalationEnabled,
          rules: DOWNTIME_RULES,
          mail: mail.status(),
          security: { accounts: users.accountsEnabled(), locked: isLocked(), source: secretsSource() },
          me, demo: hasDevices(),
          alertScale: Number(process.env.DK_ALERT_SCALE || 1),
        });
      }

      if (path === '/api/engine') return json(res, { machines: liveEventState() });

      if (path === '/api/events') {
        const rows = db.recentDowntime(q.get('machine') || null, Number(q.get('limit') || 40));
        return json(res, {
          events: rows.map(e => ({ ...e, duration_human: e.seconds != null ? human(e.seconds) : null, lost_units: e.lost_value })),
        });
      }

      // ---- issues and the mail queue
      if (path === '/api/issues') {
        const now = new Date();
        return json(res, { issues: store.recentIssues(Number(q.get('limit') || 60), q.get('machine') || null).map(i => esc.issueView(i, now)) });
      }
      if (req.method === 'POST' && path === '/api/issues/ack') {
        const b = await readJson(req);
        const r = esc.acknowledge(Number(b.id), me?.name || 'dashboard');
        return json(res, r.ok ? { ok: true } : r, r.ok ? 200 : 404);
      }
      if (req.method === 'POST' && path === '/api/issues/resolve') {
        const b = await readJson(req);
        return json(res, esc.resolve(Number(b.id), me?.name || 'dashboard'));
      }
      if (path === '/api/mail') {
        return json(res, { status: mail.status(), mail: store.recentMail(Number(q.get('limit') || 60), q.get('issue') ? Number(q.get('issue')) : null) });
      }
      if (req.method === 'POST' && path === '/api/mail/retry') {
        const b = await readJson(req);
        const n = b.all ? store.retryAllFailed(new Date()) : store.retryMail(Number(b.id), new Date());
        mail.processQueue().catch(() => {});
        return json(res, { ok: true, requeued: n });
      }
      if (req.method === 'POST' && path === '/api/mail/test') {
        const b = await readJson(req);
        const to = String(b.to || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(res, { ok: false, error: 'Enter an email address to send the test to.' }, 400);
        return json(res, await mail.sendTest(to));
      }
      // one call for the dashboard strip
      if (path === '/api/escalation') {
        const now = new Date();
        return json(res, {
          open: store.liveIssues().map(i => esc.issueView(i, now)),
          acked: store.recentIssues(20).filter(i => i.state === 'ACKED').map(i => esc.issueView(i, now)),
          mail: mail.status(),
        });
      }

      // ---- settings
      if (path === '/api/settings' && req.method === 'GET') return json(res, { settings: settings.publicView(), resend: mail.resendStatus(), baseUrlGuess: esc.defaultBaseUrl() });
      if (req.method === 'POST' && path === '/api/settings') {
        const b = await readJson(req);
        const r = settings.update(b);
        return json(res, { ...r, settings: settings.publicView() }, r.ok ? 200 : 400);
      }

      // ---- the logs, the quality numbers and OEE
      if (path === '/api/logs/downtime') { const w = windowFrom(q); return json(res, { rows: store.listDowntime({ machine: q.get('machine') || null, ...w, limit: Number(q.get('limit') || 5000) }) }); }
      if (path === '/api/logs/defects') { const w = windowFrom(q); return json(res, { rows: store.listDefects({ machine: q.get('machine') || null, ...w, limit: Number(q.get('limit') || 5000) }) }); }
      if (path === '/api/logs/downtime.csv') {
        const w = windowFrom(q);
        return sendCsv(res, 'downtime_log', csv(
          ['id', 'machine', 'started_at', 'ended_at', 'minutes', 'reason', 'planned', 'shift', 'shift_day', 'logged_by', 'note', 'source', 'logged_at'],
          store.listDowntime({ machine: q.get('machine') || null, ...w }).map(r => [r.id, r.machine_id, r.started_at, r.ended_at, r.minutes, r.reason_label, r.planned ? 'planned' : 'unplanned', r.shift, r.shift_day, r.operator, r.note, r.source, r.logged_at])));
      }
      if (path === '/api/logs/defects.csv') {
        const w = windowFrom(q);
        return sendCsv(res, 'defect_log', csv(
          ['id', 'machine', 'occurred_at', 'quantity', 'defect_type', 'shift', 'shift_day', 'logged_by', 'note', 'photo', 'logged_at'],
          store.listDefects({ machine: q.get('machine') || null, ...w }).map(r => [r.id, r.machine_id, r.occurred_at, r.qty, r.type_label, r.shift, r.shift_day, r.operator, r.note, r.photo ? `${esc.baseUrl()}/photos/${r.photo}` : '', r.logged_at])));
      }
      if (path === '/api/issues.csv') {
        return sendCsv(res, 'escalations', csv(
          ['id', 'machine', 'kind', 'summary', 'opened_at', 'state', 'acknowledged_by', 'acknowledged_at', 'resolved_at', 'raised_by'],
          store.recentIssues(5000).map(i => [i.id, i.machine_id, i.kind, i.summary, i.opened_at, i.state, i.acked_by, i.acked_at, i.resolved_at, i.raised_by])));
      }
      if (path === '/api/mail.csv') {
        return sendCsv(res, 'escalation_emails', csv(
          ['id', 'issue', 'level', 'to', 'subject', 'created_at', 'status', 'attempts', 'sent_at', 'last_error'],
          store.recentMail(5000).map(m => [m.id, m.issue_id, m.level, m.to_addr, m.subject, m.created_at, m.status, m.attempts, m.sent_at, m.last_error])));
      }
      if (path === '/api/quality') {
        const w = windowFrom(q);
        return json(res, store.qualitySummary({ machine: q.get('machine') || null, ...w }));
      }
      if (path === '/api/oee') return json(res, oee.dashboard(new Date()));
      if (path === '/api/timeline') return json(res, oee.shiftTimelines(new Date()));
      if (path === '/api/oee/trend') return json(res, { points: oee.trend({ machineId: q.get('machine') || null, days: Math.min(60, Number(q.get('days') || 14)) }) });

      // The QR image. The link carries the machine's token, never a login.
      if (path === '/api/qr') {
        const m = q.get('m') || MACHINES[0].id;
        if (!MACHINES.some(x => x.id === m)) return json(res, { ok: false, error: 'unknown machine' }, 404);
        const base = settings.all().baseUrl || envBaseUrl() || `http://${req.headers.host}`;
        const target = qrLink(m, base);
        const png = await QRCode.toBuffer(target, { width: 640, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0e13', light: '#ffffff' } });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-qr-target': target });
        return res.end(png);
      }
      if (req.method === 'POST' && path === '/api/qr-token/rotate') {
        const b = await readJson(req);
        if (!MACHINES.some(x => x.id === b.machine)) return json(res, { ok: false, error: 'unknown machine' }, 404);
        settings.rotateMachineToken(b.machine);
        return json(res, { ok: true });
      }

      // ---- demo controls (no-ops against real hardware)
      if (req.method === 'POST' && path === '/api/demo/stop') {
        const b = await readJson(req);
        const dev = getDevice(b.machine);
        if (!dev) return json(res, { ok: false, error: 'no simulated device for ' + b.machine }, 404);
        dev.machine.forceStop(Number(b.seconds || 600));
        return json(res, { ok: true, stoppedFor: Number(b.seconds || 600) });
      }
      if (req.method === 'POST' && path === '/api/demo/start') {
        const b = await readJson(req);
        const dev = getDevice(b.machine);
        if (!dev) return json(res, { ok: false, error: 'no simulated device' }, 404);
        dev.machine.forceStart();
        return json(res, { ok: true });
      }

      if (path === '/api/live') return json(res, { machines: getLive() });

      if (path === '/api/devices') {
        const rows = db.allDevices();
        return json(res, {
          machines: MACHINES.map(m => ({ id: m.id, name: m.name, part: m.part, device: db.deviceOnMachine(m.id)?.device_id || null })),
          assigned: rows.filter(r => r.machine_id), unassigned: unassignedDevices(), known: rows.filter(r => !r.machine_id),
        });
      }
      if (req.method === 'POST' && path === '/api/devices/assign') {
        const b = await readJson(req);
        const deviceId = String(b.deviceId || '').toLowerCase();
        if (!deviceId) return json(res, { ok: false, error: 'no deviceId' }, 400);
        if (b.machineId && !MACHINES.some(m => m.id === b.machineId)) return json(res, { ok: false, error: `no machine "${b.machineId}"` }, 400);
        return json(res, { ok: true, device: db.assignDevice(deviceId, b.machineId || null, b.note) });
      }

      if (path === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'hello', machines: getLive() })}\n\n`);
        const off = subscribe((msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`));
        const keep = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { off(); clearInterval(keep); });
        return;
      }

      if (path === '/api/summary') {
        const { from, to } = windowFrom(q);
        const machine = q.get('machine');
        const ids = machine ? [machine] : MACHINES.map(m => m.id);
        return json(res, { from, to, machines: ids.map(id => ({ machine_id: id, ...db.summary(id, from, to) })) });
      }

      if (path === '/api/shifts') {
        const now = new Date();
        const day = q.get('day') || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const ids = q.get('machine') ? [q.get('machine')] : MACHINES.map(m => m.id);
        return json(res, { day, machines: ids.map(id => ({ machine_id: id, shifts: db.shiftTotals(id, day) })) });
      }

      if (path === '/api/series') {
        const { from, to } = windowFrom(q);
        return json(res, {
          metric: q.get('metric') || 'count', label: db.METRIC_LABELS[q.get('metric') || 'count'], unit: q.get('unit') || 'hour',
          points: db.series({ machineId: q.get('machine') || MACHINES[0].id, metric: q.get('metric') || 'count', unit: q.get('unit') || 'hour', fromIso: from, toIso: to }),
        });
      }

      if (path === '/api/shots') {
        const { from, to } = windowFrom(q);
        const rows = db.shotsBetween(q.get('machine') || MACHINES[0].id, from, to);
        const limit = Number(q.get('limit') || 500);
        return json(res, { from, to, total: rows.length, truncated: rows.length > limit, shots: rows.slice(-limit) });
      }

      if (path === '/api/recent') {
        return json(res, { shots: db.recentShots(q.get('machine') || MACHINES[0].id, Number(q.get('limit') || 60)) });
      }

      if (path === '/api/export.csv') {
        const { from, to } = windowFrom(q);
        const rows = db.shotsBetween(q.get('machine') || MACHINES[0].id, from, to);
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="production_${Date.now()}.csv"`,
        });
        return res.end(csv(['id', 'timestamp', 'machine_id', 'cycletime', 'downtime', 'class'],
          rows.map(r => [r.id, r.timestamp, r.machine_id, r.cycletime, r.downtime, r.class])));
      }

      // ---- static
      const clean = path === '/' ? '/index.html' : path;
      const file = join(PUBLIC, normalize(clean).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('no'); }
      return await serveFile(res, file);

    } catch (e) {
      if (e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
      if (e.status === 413) return json(res, { ok: false, error: 'That is too large.' }, 413);
      onLog(`http error: ${e.stack}`);
      res.writeHead(500); res.end('server error');
    }
  });

  return new Promise((resolve) => {
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`\n  Port ${WEB.port} is already used by another program on this machine.\n  Set DK_WEB_PORT in the .env file to a free port (for example 4311) and start again.\n`);
        process.exit(1);
      }
      throw e;
    });
    server.listen(WEB.port, '0.0.0.0', () => {
      onLog(`dashboard on http://localhost:${WEB.port}`);
      resolve(server);
    });
  });
}

async function serveFile(res, file) {
  const body = await readFile(file);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(body);
}
