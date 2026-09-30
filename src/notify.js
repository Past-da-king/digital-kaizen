// ============================================================
// Alert delivery — EMAIL.
//
// WhatsApp was removed on 25 Aug 2026.
// It is not a technical limitation: the official WhatsApp Business
// API needs a Meta business account, a verified number and message
// templates approved in advance, which is a lot of setup for a
// pilot. Email needs a mailbox. If WhatsApp comes back later it
// hangs off the same webhook below.
//
// Two ways out, in order of preference. Neither is wired by
// default, and nothing here claims success until the send has
// actually come back — an alert engine that silently sends
// nothing looks identical to one that works.
//
//   1. SMTP        set DK_SMTP_HOST, DK_SMTP_PORT, DK_SMTP_USER,
//                  DK_SMTP_PASS, DK_MAIL_FROM, DK_MAIL_TO
//                  (DK_MAIL_TO is comma separated).
//                  For Gmail use an App Password, not the account
//                  password — normal passwords are refused.
//
//   2. Webhook     DK_ALERT_WEBHOOK. One POST with the whole alert
//                  as JSON. Point it at Zapier / Make / n8n / a
//                  Node-RED http-in node and let that send the mail,
//                  or fan out to Teams, SMS, anything else.
//
//   3. Nothing     the alert is still recorded and still shown,
//                  marked "not delivered", so a demo stays honest.
// ============================================================

import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.DK_SMTP_HOST;
const SMTP_PORT = Number(process.env.DK_SMTP_PORT || 587);
const SMTP_USER = process.env.DK_SMTP_USER;
const SMTP_PASS = process.env.DK_SMTP_PASS;
const MAIL_FROM = process.env.DK_MAIL_FROM || SMTP_USER;
const MAIL_TO = (process.env.DK_MAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean);
const WEBHOOK = process.env.DK_ALERT_WEBHOOK;

let transport = null;
function mailer() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,        // 465 is implicit TLS, 587 upgrades via STARTTLS
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transport;
}

export function configured() {
  const email = Boolean(SMTP_HOST && MAIL_TO.length);
  const webhook = Boolean(WEBHOOK);
  return { email, webhook, any: email || webhook };
}

// Returns { attempted, detail, settled } where `settled` is a promise
// resolving to the REAL outcome. Callers record the alert immediately
// and update the row when settled resolves — an alert must never block
// the downtime engine, and must never be marked delivered before it was.
export function send({ recipient, message, subject }) {
  const cfg = configured();

  if (cfg.email) {
    const target = `email → ${MAIL_TO.join(', ')}`;
    return { attempted: true, detail: `sending — ${target}`, settled: sendMail({ subject, message, recipient }, target) };
  }

  if (cfg.webhook) {
    const target = `webhook → ${safeHost(WEBHOOK)}`;
    return { attempted: true, detail: `sending — ${target}`, settled: postWebhook({ recipient, subject, message }, target) };
  }

  const detail = 'not delivered — no channel configured (set DK_SMTP_HOST + DK_MAIL_TO, or DK_ALERT_WEBHOOK)';
  return { attempted: false, detail, settled: Promise.resolve({ delivered: false, detail }) };
}

async function sendMail({ subject, message, recipient }, target) {
  try {
    const info = await mailer().sendMail({
      from: MAIL_FROM,
      to: MAIL_TO.join(', '),
      subject: subject || 'Digital Kaizen alert',
      text: `${message}\n\n— Digital Kaizen${recipient ? `\nEscalation level: ${recipient}` : ''}`,
    });
    return { delivered: true, detail: `${target} (${info.messageId || 'accepted'})` };
  } catch (e) {
    return { delivered: false, detail: `FAILED — ${target} — ${e.message}` };
  }
}

async function postWebhook(payload, target) {
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, at: new Date().toISOString(), source: 'digital-kaizen' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { delivered: true, detail: target };
  } catch (e) {
    return { delivered: false, detail: `FAILED — ${target} — ${e.message}` };
  }
}

// Lets an install step prove the mailbox works before a real downtime
// event depends on it: node -e "import('./src/notify.js').then(m=>m.selfTest())"
export async function selfTest() {
  const r = send({
    recipient: 'Operations manager',
    subject: 'Digital Kaizen — test alert',
    message: 'This is a test. If you are reading it, downtime alerts will reach you.',
  });
  console.log('channels:', configured());
  console.log('result:', await r.settled);
}

function safeHost(u) { try { return new URL(u).host; } catch { return 'configured endpoint'; } }
