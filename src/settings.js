// ============================================================
// Settings that the factory changes from the Settings screen, not
// from a file: the escalation ladder, its thresholds, the reason
// and defect lists, and the SMTP account.
//
// Stored in the same SQLite file as everything else (table
// `settings`), so a backup of data/kaizen.db is a backup of the lot.
// Every read falls back to DEFAULTS, so a fresh install works and a
// half-filled screen can never leave the app without a ladder.
// ============================================================

import { db } from './db.js';
import { STOP_REASONS, MACHINES, DOWNTIME_RULES, CAVITIES } from './config.js';
import { STARTER_LADDER } from './starter.js';

// the settings table is created by migration 2 in migrate.js

export const DEFAULT_DEFECT_TYPES = [
  'Short shot', 'Flash', 'Sink marks', 'Burn marks', 'Warping',
  'Black specks / contamination', 'Splay / silver streaks', 'Weld lines',
  'Dimensions out of spec', 'Colour / cosmetic', 'Damaged / scratched', 'Other',
];

// The ladder: a list of levels, each with a time and the people told at that level.
// afterMin is minutes from the moment the issue opens, so
// "level 1 at once, then the next level every 30 minutes if nobody has
// acknowledged" is 0, 30, 60, 90, 120. Change a number and the
// next tick uses it.
export const DEFAULTS = {
  escalationEnabled: true,
  ladder: STARTER_LADDER,           // an editable starting example, see starter.js
  thresholds: {
    downtimeMin: 10,        // a sensor-detected stop this long raises an issue
    defectsPerShift: 25,    // defects logged on one machine in one shift
  },
  mail: {
    retryMinutes: [1, 2, 5, 10, 15],   // back-off, the last value repeats
    giveUpHours: 48,                   // then the message is marked failed
    sendRecovered: true,               // tell the people already told when it is over
  },
  smtp: {
    host: '', port: 587,
    security: 'auto',                  // auto | ssl | starttls | none
    user: '', pass: '', from: '',
    allowSelfSigned: false,
  },
  operatorPinRequired: false,         // names on the QR page ask for their PIN (only names that have one)
  machineEpochs: {},                   // bump one to retire that machine's printed QR stickers
  // Per machine: the moulds it runs and the ideal cycle time of each. OEE
  // Performance is measured against the ACTIVE mould's ideal cycle.
  machines: Object.fromEntries(MACHINES.map(m => [m.id, {
    activeMould: 0,
    moulds: [{ name: 'Standard mould', idealCycleSec: DOWNTIME_RULES[m.id]?.expectedCycleSec ?? m.cycleSec, cavities: CAVITIES[m.id] || 1 }],
  }])),
  baseUrl: '',                         // how phones reach this PC, e.g. http://192.120.0.7:4310
  downtimeReasons: STOP_REASONS.map(r => ({ label: r.label, planned: r.planned })),
  defectTypes: DEFAULT_DEFECT_TYPES,
};

const get = db.prepare('SELECT value FROM settings WHERE key = ?');
const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function read(key) {
  const row = get.get(key);
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// All settings, defaults filled in. Env vars seed the SMTP account only
// when nothing has been saved on the screen, so an older .env install
// keeps working untouched.
export function all() {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const v = read(key);
    const d = DEFAULTS[key];
    out[key] = v === undefined ? structuredClone(d) : isObj(d) && isObj(v) ? { ...structuredClone(d), ...v } : v;
  }
  if (!read('smtp') && process.env.DK_SMTP_HOST) {
    out.smtp = {
      ...out.smtp,
      host: process.env.DK_SMTP_HOST,
      port: Number(process.env.DK_SMTP_PORT || 587),
      user: process.env.DK_SMTP_USER || '',
      pass: process.env.DK_SMTP_PASS || '',
      from: process.env.DK_MAIL_FROM || process.env.DK_SMTP_USER || '',
    };
  }
  return out;
}

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'other';

// The lists the operator picks from, with stable codes.
export function reasons() {
  return all().downtimeReasons.map(r => ({ code: slug(r.label), label: r.label, planned: Boolean(r.planned) }));
}
export function defectTypes() {
  return all().defectTypes.map(label => ({ code: slug(label), label }));
}

// Validates and stores a partial update. Returns { ok, errors }.
// A blank SMTP password keeps the saved one, so the screen never has
// to hold the secret to resubmit the form.
export function update(patch) {
  const errors = [];
  const cur = all();

  if ('escalationEnabled' in patch) put.run('escalationEnabled', JSON.stringify(Boolean(patch.escalationEnabled)));

  if ('ladder' in patch) {
    const steps = (Array.isArray(patch.ladder) ? patch.ladder : []).slice(0, 10).map((st, i) => ({
      level: i + 1,
      afterMin: Number(st.afterMin),
      people: (Array.isArray(st.people) ? st.people : []).slice(0, 12).map(p => ({
        name: String(p.name || '').trim().slice(0, 80),
        role: String(p.role || '').trim().slice(0, 80),
        email: String(p.email || '').trim().toLowerCase(),
        enabled: p.enabled !== false,
      })),
    }));
    for (const st of steps) {
      if (!Number.isFinite(st.afterMin) || st.afterMin < 0 || st.afterMin > 7 * 24 * 60) errors.push(`Level ${st.level}: minutes must be 0 or more`);
      for (const p of st.people) {
        if (p.enabled && !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(p.email)) errors.push(`Level ${st.level}: "${p.email}" is not an email address`);
      }
    }
    const live = steps.filter(st => st.people.some(p => p.enabled));
    if (live.some((st, i) => i && st.afterMin < live[i - 1].afterMin)) errors.push('Each level must come at the same time or later than the one before it');
    if (!live.length) errors.push('At least one level needs at least one person who is switched on');
    if (!errors.length) put.run('ladder', JSON.stringify(steps));
  }

  if ('thresholds' in patch) {
    const t = { ...cur.thresholds, ...patch.thresholds };
    t.downtimeMin = Number(t.downtimeMin); t.defectsPerShift = Number(t.defectsPerShift);
    if (!(t.downtimeMin >= 1)) errors.push('Downtime threshold must be at least 1 minute');
    if (!(t.defectsPerShift >= 1)) errors.push('Defect threshold must be at least 1');
    if (!errors.length) put.run('thresholds', JSON.stringify(t));
  }

  if ('mail' in patch) {
    const m = { ...cur.mail, ...patch.mail };
    m.giveUpHours = Number(m.giveUpHours);
    m.sendRecovered = Boolean(m.sendRecovered);
    m.retryMinutes = (Array.isArray(m.retryMinutes) ? m.retryMinutes : String(m.retryMinutes).split(','))
      .map(Number).filter(n => n > 0);
    if (!m.retryMinutes.length) m.retryMinutes = DEFAULTS.mail.retryMinutes;
    if (!(m.giveUpHours >= 1)) errors.push('Give-up time must be at least 1 hour');
    if (!errors.length) put.run('mail', JSON.stringify(m));
  }

  if ('smtp' in patch) {
    const s = { ...cur.smtp, ...patch.smtp };
    s.port = Number(s.port);
    s.host = String(s.host || '').trim();
    s.from = String(s.from || '').trim();
    if (patch.smtp.pass === '' || patch.smtp.pass === undefined) s.pass = cur.smtp.pass;
    s.allowSelfSigned = Boolean(s.allowSelfSigned);
    if (!['auto', 'ssl', 'starttls', 'none'].includes(s.security)) s.security = 'auto';
    if (s.host && !(s.port > 0 && s.port < 65536)) errors.push('SMTP port must be a number such as 587');
    if (!errors.length) put.run('smtp', JSON.stringify(s));
  }

  if ('operatorPinRequired' in patch) put.run('operatorPinRequired', JSON.stringify(Boolean(patch.operatorPinRequired)));

  if ('machines' in patch && isObj(patch.machines)) {
    const next = { ...cur.machines };
    for (const [id, spec] of Object.entries(patch.machines)) {
      if (!MACHINES.some(m => m.id === id)) continue;
      const moulds = (Array.isArray(spec.moulds) ? spec.moulds : []).slice(0, 20).map(m => ({
        name: String(m.name || '').trim().slice(0, 60) || 'Mould',
        idealCycleSec: Number(m.idealCycleSec),
        cavities: Math.round(Number(m.cavities)),
      }));
      if (!moulds.length) { errors.push(`${id}: add at least one mould`); continue; }
      moulds.forEach(m => {
        if (!(m.idealCycleSec > 0 && m.idealCycleSec <= 3600)) errors.push(`${id} ${m.name}: ideal cycle must be above 0 seconds`);
        if (!(m.cavities >= 1 && m.cavities <= 256)) errors.push(`${id} ${m.name}: cavities must be 1 or more`);
      });
      const active = Math.min(Math.max(Math.round(Number(spec.activeMould) || 0), 0), moulds.length - 1);
      next[id] = { activeMould: active, moulds };
    }
    if (!errors.length) put.run('machines', JSON.stringify(next));
  }

  if ('baseUrl' in patch) {
    const u = String(patch.baseUrl || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\/[^\s]+$/.test(u)) errors.push('The dashboard address must start with http:// or https://');
    else put.run('baseUrl', JSON.stringify(u));
  }

  for (const key of ['downtimeReasons', 'defectTypes']) {
    if (!(key in patch)) continue;
    const lines = (Array.isArray(patch[key]) ? patch[key] : [])
      .filter(x => (key === 'defectTypes' ? String(x).trim() : String(x?.label || '').trim()));
    if (!lines.length) { errors.push(`The ${key === 'defectTypes' ? 'defect types' : 'downtime reasons'} list cannot be empty`); continue; }
    const value = key === 'defectTypes'
      ? lines.map(x => String(x).trim().slice(0, 60))
      : lines.map(x => ({ label: String(x.label).trim().slice(0, 60), planned: Boolean(x.planned) }));
    put.run(key, JSON.stringify(value));
  }

  return { ok: errors.length === 0, errors };
}

// The mould a machine is running now: ideal cycle and cavities.
export function mouldFor(machineId) {
  const spec = all().machines[machineId];
  const m = spec?.moulds?.[spec.activeMould] || spec?.moulds?.[0];
  return m || { name: 'Standard mould', idealCycleSec: DOWNTIME_RULES[machineId]?.expectedCycleSec || 30, cavities: 1 };
}

export function machineEpoch(id) { return Number(all().machineEpochs[id] || 0); }
export function rotateMachineToken(id) {
  const e = { ...all().machineEpochs, [id]: machineEpoch(id) + 1 };
  put.run('machineEpochs', JSON.stringify(e));
  return e[id];
}

// First run: copy the starting examples into the database so the Settings
// screen edits real rows and nothing is read from code afterwards.
for (const key of ['ladder', 'downtimeReasons', 'defectTypes', 'machines', 'thresholds', 'mail']) {
  if (read(key) === undefined) put.run(key, JSON.stringify(DEFAULTS[key]));
}

// What the browser may see: everything except the SMTP password.
export function publicView() {
  const s = all();
  const { pass, ...smtp } = s.smtp;
  return { ...s, smtp: { ...smtp, passSet: Boolean(pass) } };
}
