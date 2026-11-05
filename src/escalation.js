// ============================================================
// The escalation ladder.
//
// An ISSUE is something that needs a person above the operator:
//   downtime   a sensor-detected stop that has lasted past the limit
//   defects    defects logged on one machine in one shift past the limit
//   manual     somebody pressed "Escalate" on the log page
//
// Each tick walks every OPEN issue up the ladder from Settings: when
// an issue is old enough for a level, the people at that level are
// emailed (through the queue, see mail.js). Acknowledging the issue,
// from the link in any email or from the dashboard, stops it climbing.
// Resolving it (machine running again) tells the people already told.
//
// Time is passed in, never read from the clock inside the logic, so
// the whole ladder can be proven in a test without waiting 2 hours.
// ============================================================

import { randomBytes } from 'node:crypto';
import { lanAddress as pickLan, resolveBaseUrl } from './net.js';
import { MACHINES, WEB } from './config.js';
import { db } from './db.js';
import * as settings from './settings.js';
import * as store from './store.js';

let broadcast = () => {};
export function onIssueEvent(fn) { broadcast = fn; }

const nameOf = (id) => MACHINES.find(m => m.id === id)?.name || id;

export const lanAddress = () => pickLan();

// The address phones and managers use to reach this PC; it goes into every
// email, the invite links and the QR codes. Settings, then DK_BASE_URL, then
// the best network address (see net.js).
export function baseUrlInfo() {
  return resolveBaseUrl({ saved: settings.all().baseUrl, port: WEB.port });
}
export const baseUrl = () => baseUrlInfo().url;
// What the Settings screen shows as the blank-field default (no saved value).
export const defaultBaseUrl = () => resolveBaseUrl({ saved: '', port: WEB.port }).url;

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longTime = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${hhmm(d)}`;
export function human(min) {
  min = Math.max(0, Math.round(min));
  return min >= 60 ? `${Math.floor(min / 60)} h ${pad(min % 60)} min` : `${min} min`;
}

// ---------- raising ----------
export function raise({ kind, machineId, summary, detail, sourceKey, raisedBy, now = new Date() }) {
  if (sourceKey) {
    const old = store.issueByKey(sourceKey);
    if (old) return { id: old.id, existing: true };
  }
  const id = store.insertIssue({ kind, machineId, summary, detail, sourceKey, raisedBy, now, token: randomBytes(16).toString('hex') });
  broadcast({ type: 'issue-open', machine_id: machineId, issue_id: id, summary });
  tick(now);                      // level 1 goes out in the same breath
  return { id, existing: false };
}

// Defects over the limit for this machine in this shift.
export function checkDefects(machineId, shiftDay, shift, now = new Date()) {
  const limit = settings.all().thresholds.defectsPerShift;
  const total = store.defectsInShift(machineId, shiftDay, shift);
  if (total < limit) return null;
  return raise({
    kind: 'defects', machineId, now,
    sourceKey: `defects:${machineId}:${shiftDay}:${shift}`,
    summary: `${total} defects logged in shift ${shift} (limit ${limit})`,
    detail: `Shift ${shift} of ${shiftDay}`,
    raisedBy: 'defect log',
  });
}

// ---------- the tick ----------
export function tick(now = new Date()) {
  const cfg = settings.all();
  let queued = 0;

  // 1. stops the sensor has seen, long enough to matter
  for (const ev of db.prepare(`SELECT * FROM downtime_events WHERE state = 'OPEN'`).all()) {
    const mins = (now - store.parse(ev.started_at)) / 60000;
    if (mins >= cfg.thresholds.downtimeMin) {
      raise({
        kind: 'downtime', machineId: ev.machine_id, now,
        sourceKey: `downtime:${ev.id}`,
        summary: `Machine down, no shots past the ${cfg.thresholds.downtimeMin} min limit`,
        detail: `Stopped at ${ev.started_at}`,
        raisedBy: 'sensor',
      });
    }
  }

  // 2. a downtime issue whose stop has ended is over
  for (const i of db.prepare(`SELECT * FROM issues WHERE kind = 'downtime' AND state != 'RESOLVED'`).all()) {
    const ev = db.prepare('SELECT state FROM downtime_events WHERE id = ?').get(Number(String(i.source_key).split(':')[1]));
    if (ev && ev.state === 'CLOSED') resolve(i.id, 'machine running again', now);
  }

  // 3. climb the ladder
  if (!cfg.escalationEnabled) return queued;
  for (const issue of store.liveIssues()) queued += climb(issue, cfg, now);
  return queued;
}

function climb(issue, cfg, now) {
  const age = (now - store.parse(issue.opened_at)) / 60000;
  const steps = cfg.ladder;
  const sent = new Set(store.mailForIssue(issue.id).filter(m => m.kind === 'escalation').map(m => `${m.level}|${m.to_addr}`));
  let n = 0;
  for (const step of steps) {
    if (age < step.afterMin) break;
    for (const p of step.people) {
      if (!p.enabled || !p.email || sent.has(`${step.level}|${p.email}`)) continue;
      const msg = build(issue, step, p, steps, now);
      store.enqueueMail({ issueId: issue.id, level: step.level, kind: 'escalation', role: p.role || p.name, to: p.email, now, ...msg });
      sent.add(`${step.level}|${p.email}`);
      n++;
      broadcast({ type: 'issue-escalated', machine_id: issue.machine_id, issue_id: issue.id, level: step.level });
    }
  }
  return n;
}

// ---------- acknowledge / resolve ----------
export function acknowledge(tokenOrId, by, now = new Date()) {
  const issue = typeof tokenOrId === 'number' ? store.issueById(tokenOrId) : store.issueByToken(tokenOrId);
  if (!issue) return { ok: false, error: 'This link is not valid.' };
  if (issue.state === 'RESOLVED') return { ok: true, issue, already: true, note: 'It was already resolved.' };
  if (issue.state === 'ACKED') return { ok: true, issue, already: true };
  store.ackIssue(issue.id, by, now);
  const fresh = store.issueById(issue.id);
  broadcast({ type: 'issue-acked', machine_id: issue.machine_id, issue_id: issue.id, by });
  if (settings.all().mail.sendRecovered) notifyTold(fresh, 'ack', now, `Acknowledged by ${by || 'a manager'} at ${hhmm(now)}. Escalation has stopped.`);
  return { ok: true, issue: fresh };
}

export function resolve(id, by, now = new Date()) {
  const issue = store.issueById(id);
  if (!issue) return { ok: false, error: 'No such issue' };
  if (!store.resolveIssue(id, now)) return { ok: true, already: true };
  broadcast({ type: 'issue-resolved', machine_id: issue.machine_id, issue_id: id });
  if (settings.all().mail.sendRecovered) {
    notifyTold(store.issueById(id), 'recovered', now, `Resolved at ${hhmm(now)}${by ? ` (${by})` : ''}. No action needed.`);
  }
  return { ok: true };
}

// Tells the people who were already emailed. Never emails someone the
// ladder did not reach, and never a resolved note to nobody.
function notifyTold(issue, kind, now, line) {
  const told = store.mailForIssue(issue.id).filter(m => m.kind === 'escalation');
  const seen = new Set();
  for (const m of told) {
    if (seen.has(m.to_addr)) continue;
    seen.add(m.to_addr);
    const head = kind === 'ack' ? 'ACKNOWLEDGED' : 'RESOLVED';
    const text = `${head}\n\nMachine: ${nameOf(issue.machine_id)}\nIssue: ${issue.summary}\nSince: ${longTime(store.parse(issue.opened_at))}\n\n${line}\n`;
    store.enqueueMail({
      issueId: issue.id, level: m.level, kind: 'recovered', role: m.role, to: m.to_addr, now,
      subject: `[Digital Kaizen] ${head.charAt(0) + head.slice(1).toLowerCase()}: ${nameOf(issue.machine_id)}`,
      text, html: wrapHtml(head, [['Machine', nameOf(issue.machine_id)], ['Issue', issue.summary], ['Since', longTime(store.parse(issue.opened_at))]], line, null, kind === 'ack' ? '#1b7f4b' : '#1b7f4b'),
    });
  }
}

// ---------- the email ----------
function build(issue, step, person, steps, now) {
  const opened = store.parse(issue.opened_at);
  const mins = (now - opened) / 60000;
  const machine = nameOf(issue.machine_id);
  const ack = `${baseUrl()}/ack?t=${issue.ack_token}`;
  const kindLine = { downtime: 'Machine down', defects: 'Defects over the limit', manual: 'Escalated from the floor' }[issue.kind] || 'Issue';

  const told = store.mailForIssue(issue.id).filter(m => m.kind === 'escalation');
  const toldLines = told.map(m => `Level ${m.level} ${m.role || ''} (${m.to_addr}), emailed ${m.created_at.slice(11, 16)}`);
  const next = steps.find(s => s.afterMin > step.afterMin && s.people.some(p => p.enabled));
  const nextLine = next
    ? `Level ${next.level} (${next.people.filter(p => p.enabled).map(p => p.role || p.name || p.email).join(', ')}) at ${hhmm(new Date(opened.getTime() + next.afterMin * 60000))} unless someone acknowledges`
    : 'This is the last level. Nobody is above it.';

  const who = person.name ? `${person.name}${person.role ? `, ${person.role}` : ''}` : person.role;
  const rows = [
    ['Machine', machine],
    ['Issue', `${kindLine}: ${issue.summary}`],
    ['Since', `${longTime(opened)} (${human(mins)} ago)`],
    ['Raised by', issue.raised_by || 'sensor'],
  ];
  if (issue.detail && issue.kind === 'manual') rows.push(['Note', issue.detail]);
  rows.push(['This email', `Level ${step.level}${who ? ': ' + who : ''}`]);
  rows.push(['Already told', toldLines.length ? toldLines.join('\n') : 'Nobody yet, you are first']);
  rows.push(['Next', nextLine]);

  const subject = `[Digital Kaizen] Level ${step.level}: ${machine} ${issue.kind === 'downtime' ? `down ${human(mins)}` : issue.kind === 'defects' ? 'defects over limit' : 'escalated'}`;
  const text = `LEVEL ${step.level} ESCALATION\n\n` +
    rows.map(([k, v]) => `${(k + ':').padEnd(14)}${String(v).replace(/\n/g, '\n' + ' '.repeat(14))}`).join('\n') +
    `\n\nAcknowledge (stops further escalation):\n${ack}\n`;
  return { subject, text, html: wrapHtml(`LEVEL ${step.level} ESCALATION`, rows, null, ack, '#b3261e') };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
function wrapHtml(title, rows, note, ackUrl, colour) {
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e1e4e8">
<tr><td style="background:${colour};color:#fff;padding:16px 22px;font-size:15px;font-weight:700;letter-spacing:.04em">${esc(title)}</td></tr>
<tr><td style="padding:20px 22px"><table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.5">
${rows.map(([k, v]) => `<tr><td valign="top" style="padding:5px 14px 5px 0;color:#667;white-space:nowrap">${esc(k)}</td><td style="padding:5px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}
</table>${note ? `<p style="font-size:15px">${esc(note)}</p>` : ''}
${ackUrl ? `<p style="margin:22px 0 6px"><a href="${esc(ackUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:8px">Acknowledge, stop escalation</a></p>
<p style="font-size:12px;color:#667;margin:8px 0 0">If the button does not work, open: ${esc(ackUrl)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

export function issueView(i, now = new Date()) {
  const mails = store.mailForIssue(i.id).filter(m => m.kind === 'escalation');
  const levels = [...new Set(mails.map(m => m.level))];
  return {
    ...i, ack_token: undefined,
    machine_name: nameOf(i.machine_id),
    age_min: Math.round((now - store.parse(i.opened_at)) / 60000),
    level_reached: levels.length ? Math.max(...levels) : 0,
    mail: { queued: mails.filter(m => m.status === 'queued').length, sent: mails.filter(m => m.status === 'sent').length, failed: mails.filter(m => m.status === 'failed').length },
  };
}
