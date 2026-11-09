// ============================================================
// Outgoing email, built for a factory network that may not reach
// the internet.
//
//   * Every message is written to the mail_queue table FIRST.
//   * A worker sends from the queue. If the SMTP server cannot be
//     reached the message stays queued and is retried with a growing
//     delay (1, 2, 5, 10, 15 minutes, then every 15), so a day-long
//     outage loses nothing.
//   * After "give up" hours the message is marked failed (it stays on
//     the dashboard, with a Retry button).
//   * The SMTP account is the factory's own, entered on the Settings
//     screen (their mail server, or a Gmail app password). Nothing
//     is baked into the code.
//   * Nothing is claimed as sent until the SMTP server has accepted it.
// ============================================================

import nodemailer from 'nodemailer';
import * as resend from './resend.js';
const resendConfig = { apiKey: process.env.RESEND_API_KEY || '', from: process.env.DK_MAIL_FROM || '', fromName: process.env.DK_MAIL_FROM_NAME || '' };
export function mailReady(s = settings.all().smtp) { return resendConfig.apiKey ? resend.resendReady(resendConfig) : smtpReady(s); }
export function resendStatus() { return { keySet: Boolean(resendConfig.apiKey), from: resendConfig.from }; }
import { db, iso } from './db.js';
import * as settings from './settings.js';
import * as store from './store.js';

export function smtpReady(s = settings.all().smtp) {
  return Boolean(s.host && (s.from || s.user));
}

function makeTransport(s) {
  const secure = s.security === 'ssl' || (s.security === 'auto' && s.port === 465);
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure,
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    tls: { rejectUnauthorized: !s.allowSelfSigned },
    // A dead network must fail in seconds, not hang the worker.
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
}

let cached = { key: '', transport: null };
function transportFor(s) {
  const key = JSON.stringify(s);
  if (cached.key !== key) { cached.transport?.close?.(); cached = { key, transport: makeTransport(s) }; }
  return cached.transport;
}

// Errors that mean "could not reach / talk to the server" rather than
// "the server looked at this message and refused it".
const NETWORK = /ECONNECTION|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ESOCKET|ECONNRESET|EHOSTUNREACH|ENETUNREACH|timed? ?out/i;

let lastOkAt = null;
let lastError = null;
let busy = false;

export function status() {
  const s = settings.all().smtp;
  return {
    configured: mailReady(s),
    transport: resendConfig.apiKey ? 'resend' : 'smtp',
    host: s.host ? `${s.host}:${s.port}` : '',
    from: resendConfig.apiKey ? resendConfig.from : (s.from || s.user || ''),
    counts: store.mailCounts(),
    lastOkAt, lastError,
  };
}

const fromAddress = (s) => s.from || s.user;

export async function sendNow({ to, subject, text, html }, smtp = settings.all().smtp) {
  if (resendConfig.apiKey) {
    if (!resendConfig.from) throw new Error('Set DK_MAIL_FROM in .env and restart the service.');
    return resend.sendMail(resendConfig, { to, subject, text, html });
  }
  const info = await transportFor(smtp).sendMail({ from: fromAddress(smtp), to, subject, text, html: html || undefined });
  return info.messageId || 'accepted';
}

// One pass over what is due. Returns counts so a test can assert them.
export async function processQueue(now = new Date()) {
  if (busy) return { skipped: true };
  busy = true;
  const out = { sent: 0, retried: 0, failed: 0, waiting: 0, notConfigured: false };
  try {
    const cfg = settings.all();
    const due = store.dueMail(now);
    if (!due.length) return out;
    if (!mailReady(cfg.smtp)) { out.notConfigured = true; out.waiting = due.length; lastError = resendConfig.apiKey ? 'Set DK_MAIL_FROM in .env and restart the service.' : 'Email is not set up yet (Settings > Email)'; return out; }

    const retry = cfg.mail.retryMinutes;
    const giveUpMs = cfg.mail.giveUpHours * 3600 * 1000;

    for (let i = 0; i < due.length; i++) {
      const m = due[i];
      try {
        const id = await sendNow({ to: m.to_addr, subject: m.subject, text: m.body_text, html: m.body_html }, cfg.smtp);
        store.markMailSent(m.id, id, now);
        lastOkAt = iso(now); lastError = null;
        out.sent++;
      } catch (e) {
        const msg = e.response ? `${e.responseCode || ''} ${e.response}`.trim() : e.message;
        lastError = msg.slice(0, 200);
        const tooOld = now.getTime() - store.parse(m.created_at).getTime() > giveUpMs;
        // The server answered and refused this one (bad address, rejected
        // sender): retrying forever will not help, but a few tries cover
        // a greylisting or a busy server.
        const refused = !NETWORK.test(msg) && !e.config && !['network', 'throttled', 'server'].includes(e.kind) && m.attempts + 1 >= 5;
        if (tooOld || refused) { store.markMailFailed(m.id, msg); out.failed++; }
        else {
          const wait = retry[Math.min(m.attempts, retry.length - 1)];
          const next = new Date(now.getTime() + wait * 60000);
          store.markMailRetry(m.id, msg, next);
          out.retried++;
          if (NETWORK.test(msg)) {
            // The network is down: do not spend 10 seconds timing out on
            // every other queued message. Hold them until the same time.
            for (const rest of due.slice(i + 1)) {
              db.prepare('UPDATE mail_queue SET next_attempt_at = ?, last_error = ? WHERE id = ?').run(iso(next), msg.slice(0, 300), rest.id);
              out.waiting++;
            }
            break;
          }
        }
      }
    }
    return out;
  } finally {
    busy = false;
  }
}

// Used by the Settings screen: proves the account works right now, and
// puts the result in the queue so it shows on the dashboard like any
// other message.
export async function sendTest(to, now = new Date()) {
  const cfg = settings.all();
  if (!mailReady(cfg.smtp)) return { ok: false, error: resendConfig.apiKey ? 'Set DK_MAIL_FROM in .env and restart the service.' : 'Configure SMTP or add a Resend key and From address in .env.' };
  const text = 'This is a test message from Digital Kaizen. If you are reading it, escalation emails from this PC can reach you.';
  const qid = store.enqueueMail({ kind: 'test', to, subject: '[Digital Kaizen] Test message', text, now });
  const r = await processQueue(now);
  const row = store.recentMail(5).find(x => x.id === qid);
  return row?.status === 'sent'
    ? { ok: true, id: qid }
    : { ok: false, id: qid, error: row?.last_error || (r.notConfigured ? 'Email is not set up' : 'Not sent yet') + ' (it stays queued and will be retried)' };
}
