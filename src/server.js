// ============================================================
// HTTP: the dashboard, its API, and the device fallback route.
// Plain node:http — no framework, so it runs on a factory laptop
// with nothing installed but Node.
// ============================================================

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WEB, MACHINES, KAIZEN, SHIFTS, STOP_REASONS, ESCALATION, DOWNTIME_RULES, CAVITIES } from './config.js';
import * as db from './db.js';
import { getLive, subscribe, handlePayload, handleDevicePayload, unassignedDevices } from './ingest.js';
import { attribute, openFor, liveEventState, human } from './events.js';
import { configured } from './notify.js';
import {
  isLocked, checkDashPassword, mintSession, validSession,
  checkMachineKey, machineKey, secretsSource,
} from './auth.js';
import { getDevice, hasDevices } from './devices.js';

async function readJson(req) {
  if (req._body) return req._body;          // already read by the access gate
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const json = (res, body, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

// Default window: today so far.
function windowFrom(q) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const now = new Date();
  const from = q.get('from') || fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const to = q.get('to') || fmt(new Date(now.getTime() + 60000));
  return { from, to };
}

export function startServer({ onLog = () => {} } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams;

    try {
      // ------------------------------------------------------------
      // ACCESS CONTROL
      //
      // Three tiers, deliberately. Anything under /attribute is the
      // OPERATOR surface and must never ask a person on the factory
      // floor for a password — it is gated by the per-machine key
      // printed into the QR code instead. Everything else is the
      // MANAGEMENT surface and needs a session.
      // ------------------------------------------------------------
      // Static shells are open; the DATA behind them is what is gated.
      // /attribute.js was originally in the operator set, and that broke
      // the whole page: a browser requests a script tag WITHOUT the ?k=
      // from the address bar, so the file 403'd and the page sat on
      // "Loading..." for ever. Gate endpoints, never assets.
      const OPEN_PATHS = new Set([
        '/login.html', '/login.js', '/style.css', '/api/login', '/favicon.ico',
        '/attribute.html', '/attribute.js',
        // The device HTTP fallback. Authenticating it would mean putting a
        // second secret in the firmware; MQTT already carries credentials
        // and this path only ACCEPTS readings, it never returns any.
        '/machine-data', '/device-data',
      ]);
      const OPERATOR_PATHS = new Set([
        '/api/events/open', '/api/attribute',
      ]);

      if (isLocked() && !OPEN_PATHS.has(url.pathname)) {
        if (OPERATOR_PATHS.has(url.pathname)) {
          // The key travels in the QR link, and in the body on POST.
          const body = req.method === 'POST' ? await readJson(req) : null;
          const key = q.get('k') || body?.key;
          const machine = q.get('machine') || q.get('m') || body?.machine;
          if (!checkMachineKey(machine, key)) {
            return json(res, { ok: false, error: 'this link is not valid for that machine' }, 403);
          }
          req._body = body;   // readJson can only run once per request
        } else if (!validSession(req.headers.cookie)) {
          // A browser asking for a page gets sent to the login screen;
          // anything else gets an honest 401 rather than an HTML body.
          if (req.headers.accept?.includes('text/html')) {
            res.writeHead(302, { location: '/login.html' });
            return res.end();
          }
          return json(res, { ok: false, error: 'not signed in' }, 401);
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/login') {
        const b = await readJson(req);
        if (!checkDashPassword(b.password)) {
          return json(res, { ok: false, error: 'wrong password' }, 401);
        }
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `dk_session=${encodeURIComponent(mintSession())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`,
        });
        return res.end(JSON.stringify({ ok: true }));
      }

      // ---- the device's HTTP fallback, same path as the client's flow
      if (req.method === 'POST' && (url.pathname === '/machine-data' || url.pathname === '/device-data')) {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const p = JSON.parse(body);
          if (url.pathname === '/device-data' || p.device_id) handleDevicePayload(p, 'http');
          else handlePayload(p, 'http');
        } catch { /* ignore junk */ }
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('OK');
      }

      if (url.pathname === '/api/config') {
        return json(res, {
          machines: MACHINES.map(m => ({ id: m.id, name: m.name, part: m.part, cycleSec: m.cycleSec })),
          kaizen: KAIZEN,
          shifts: SHIFTS,
          metrics: db.METRIC_LABELS,
          range: db.dataRange(),
          reasons: STOP_REASONS,
          escalation: ESCALATION,
          rules: DOWNTIME_RULES,
          cavities: CAVITIES,
          alerts: configured(),
          security: { locked: isLocked(), source: secretsSource() },
          demo: hasDevices(),
          alertScale: Number(process.env.DK_ALERT_SCALE || 1),
        });
      }

      // ---- downtime events
      if (url.pathname === '/api/engine') return json(res, { machines: liveEventState() });

      if (url.pathname === '/api/events') {
        const rows = db.recentDowntime(q.get('machine') || null, Number(q.get('limit') || 40));
        return json(res, {
          events: rows.map(e => ({
            ...e,
            duration_human: e.seconds != null ? human(e.seconds) : null,
            // lost_value holds UNITS now, not money. The column keeps its
            // name so an existing database still opens; the API does not.
            lost_units: e.lost_value,
            alerts: db.alertsForEvent(e.id).length,
          })),
        });
      }

      if (url.pathname === '/api/events/open') {
        const m = q.get('machine');
        const ev = m ? openFor(m) : null;
        const spec = MACHINES.find(x => x.id === m);
        // The operator page has to tell three states apart: running,
        // stopped, and NOBODY IS WATCHING THIS MACHINE. Without the live
        // state it read "no open event" as "running", so a machine with
        // no sensor on it at all cheerfully reported that it was running.
        const live = m ? getLive().find(x => x.machine_id === m) : null;
        return json(res, {
          machine: spec ? { id: spec.id, name: spec.name, part: spec.part } : null,
          live: live ? { offline: Boolean(live.offline), status: live.status } : { offline: true, status: 'OFFLINE' },
          event: ev,
          reasons: STOP_REASONS,
          // Show the operator the last few closed events too, so they can
          // attribute one they walked away from.
          recent: db.recentDowntime(m, 5).filter(e => e.state === 'CLOSED' && !e.reason_code)
            .map(e => ({ ...e, duration_human: human(e.seconds || 0) })),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/attribute') {
        const b = await readJson(req);
        const r = attribute(b.eventId, b.code, b.note);
        return json(res, r, r.ok ? 200 : 400);
      }

      if (url.pathname === '/api/alerts') {
        return json(res, {
          channels: configured(),
          alerts: db.recentAlerts(Number(q.get('limit') || 40), q.get('machine') || null),
        });
      }

      if (url.pathname === '/api/qr') {
        const m = q.get('m') || MACHINES[0].id;
        // Encode the address the BROWSER reached us on, not localhost —
        // a label printed from a laptop and stuck on a machine has to
        // resolve from an operator's PHONE, and "localhost" on a phone
        // is the phone. DK_BASE_URL still wins if it is set.
        const base = process.env.DK_BASE_URL || `http://${req.headers.host}`;
        const key = machineKey(m);
        const target = `${base}/attribute.html?m=${m}${key ? `&k=${key}` : ''}`;
        const png = await QRCode.toBuffer(target, { width: 512, margin: 1, color: { dark: '#0b0e13', light: '#ffffff' } });
        res.writeHead(200, {
          'content-type': 'image/png', 'cache-control': 'no-store',
          // So the labels page can warn instead of printing dead codes.
          'x-qr-target': target,
        });
        return res.end(png);
      }

      // ---- demo controls (no-ops against real hardware)
      if (req.method === 'POST' && url.pathname === '/api/demo/stop') {
        const b = await readJson(req);
        const dev = getDevice(b.machine);
        if (!dev) return json(res, { ok: false, error: 'no simulated device for ' + b.machine }, 404);
        dev.machine.forceStop(Number(b.seconds || 600));
        return json(res, { ok: true, stoppedFor: Number(b.seconds || 600) });
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/start') {
        const b = await readJson(req);
        const dev = getDevice(b.machine);
        if (!dev) return json(res, { ok: false, error: 'no simulated device' }, 404);
        dev.machine.forceStart();
        return json(res, { ok: true });
      }

      if (url.pathname === '/api/live') return json(res, { machines: getLive() });

      // ---- sensors: which physical device is on which machine
      if (url.pathname === '/api/devices') {
        const rows = db.allDevices();
        return json(res, {
          machines: MACHINES.map(m => ({
            id: m.id, name: m.name, part: m.part,
            device: db.deviceOnMachine(m.id)?.device_id || null,
          })),
          assigned: rows.filter(r => r.machine_id),
          unassigned: unassignedDevices(),
          known: rows.filter(r => !r.machine_id),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/devices/assign') {
        const b = await readJson(req);
        const deviceId = String(b.deviceId || '').toLowerCase();
        if (!deviceId) return json(res, { ok: false, error: 'no deviceId' }, 400);
        if (b.machineId && !MACHINES.some(m => m.id === b.machineId)) {
          return json(res, { ok: false, error: `no machine "${b.machineId}"` }, 400);
        }
        return json(res, { ok: true, device: db.assignDevice(deviceId, b.machineId || null, b.note) });
      }

      if (url.pathname === '/api/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ type: 'hello', machines: getLive() })}\n\n`);
        const off = subscribe((msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`));
        const keep = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { off(); clearInterval(keep); });
        return;
      }

      if (url.pathname === '/api/summary') {
        const { from, to } = windowFrom(q);
        const machine = q.get('machine');
        const ids = machine ? [machine] : MACHINES.map(m => m.id);
        return json(res, {
          from, to,
          machines: ids.map(id => ({ machine_id: id, ...db.summary(id, from, to) })),
        });
      }

      if (url.pathname === '/api/shifts') {
        // Local date, not toISOString() — that is UTC and picks the
        // wrong day between midnight and 02:00 in South Africa.
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const day = q.get('day') || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const ids = q.get('machine') ? [q.get('machine')] : MACHINES.map(m => m.id);
        return json(res, {
          day,
          machines: ids.map(id => ({ machine_id: id, shifts: db.shiftTotals(id, day) })),
        });
      }

      if (url.pathname === '/api/series') {
        const { from, to } = windowFrom(q);
        return json(res, {
          metric: q.get('metric') || 'count',
          label: db.METRIC_LABELS[q.get('metric') || 'count'],
          unit: q.get('unit') || 'hour',
          points: db.series({
            machineId: q.get('machine') || MACHINES[0].id,
            metric: q.get('metric') || 'count',
            unit: q.get('unit') || 'hour',
            fromIso: from, toIso: to,
          }),
        });
      }

      // The history table must honour the same window as the chart,
      // the summary and the CSV. /api/recent deliberately ignores dates
      // (it is the live view's "last N cycles"), so history uses this.
      if (url.pathname === '/api/shots') {
        const { from, to } = windowFrom(q);
        const rows = db.shotsBetween(q.get('machine') || MACHINES[0].id, from, to);
        const limit = Number(q.get('limit') || 500);
        return json(res, {
          from, to,
          total: rows.length,
          truncated: rows.length > limit,
          shots: rows.slice(-limit),
        });
      }

      if (url.pathname === '/api/recent') {
        return json(res, { shots: db.recentShots(q.get('machine') || MACHINES[0].id, Number(q.get('limit') || 60)) });
      }

      if (url.pathname === '/api/export.csv') {
        const { from, to } = windowFrom(q);
        const rows = db.shotsBetween(q.get('machine') || MACHINES[0].id, from, to);
        const head = 'id,timestamp,machine_id,cycletime,downtime,class';
        const csv = '﻿' + [head, ...rows.map(r =>
          [r.id, r.timestamp, r.machine_id, r.cycletime, r.downtime, r.class]
            .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
        )].join('\r\n');
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="production_${Date.now()}.csv"`,
        });
        return res.end(csv);
      }

      // ---- static
      let path = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = join(PUBLIC, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('no'); }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      return res.end(body);

    } catch (e) {
      if (e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
      onLog(`http error: ${e.stack}`);
      res.writeHead(500); res.end('server error');
    }
  });

  return new Promise((resolve) => {
    // A port already in use is the likeliest install-day failure. Say
    // what it is and how to move, instead of a stack trace.
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
