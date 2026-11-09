// ============================================================
// Email through Resend (https://resend.com), the simple option: one
// API key, one verified sending domain, no mail server to configure.
//
//   POST https://api.resend.com/emails   Authorization: Bearer <key>
//
// 429 (too many per second) and 5xx are retried with a short backoff
// (the Retry-After header is honoured). Every failure becomes a
// ResendError with a plain-English message the Settings screen shows
// as it is. `config: true` means only a person fixing Settings or the
// Resend account will help, so the queue keeps the message (until the
// give-up time) instead of marking it failed.
// ============================================================

const API = () => (process.env.DK_RESEND_URL || 'https://api.resend.com').replace(/\/+$/, '');

export class ResendError extends Error {
  // kind: network | auth | domain | forbidden | bad_request | throttled | server | other
  constructor(kind, message, { status, config = false } = {}) {
    super(message);
    this.name = 'ResendError';
    this.kind = kind; this.status = status; this.config = config;
  }
}

export function resendReady(r) {
  return Boolean(r && r.apiKey && r.from);
}

export function fromHeader(r) {
  const name = String(r.fromName || '').replace(/["<>\r\n]/g, '').trim();
  return name ? `${name} <${r.from}>` : r.from;
}

// Waits between tries of a 429 or 5xx (milliseconds). Tests shorten them.
let backoffMs = [1000, 3000, 8000];
export function setBackoff(list) { backoffMs = list; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function classify(res, body, from) {
  const msg = String(body.message || '');
  const said = '';
  const domain = String(from).split('@').pop().replace(/[>\s]/g, '');
  if (res.status === 401)
    return new ResendError('auth', 'Resend did not accept the API key. Check it was pasted in full, was not deleted, and has Sending access.' + said, { status: 401, config: true });
  if (/not verified|verify your domain/i.test(msg) || (res.status === 403 && /domain/i.test(msg)))
    return new ResendError('domain', `The domain ${domain} is not verified in Resend. Add it in Resend > Domains, add the DNS records Resend shows, wait until it says Verified, and use a From address on that domain.` + said, { status: res.status, config: true });
  if (res.status === 403)
    return new ResendError('forbidden', 'Resend refused this key (403). It may be restricted, or the account may be paused.' + said, { status: 403, config: true });
  if (res.status === 429)
    return new ResendError('throttled', 'Resend is asking us to slow down (too many messages per second).' + said, { status: 429 });
  if (res.status >= 500)
    return new ResendError('server', 'Resend had a problem on its side.' + said, { status: res.status });
  if (res.status === 400 || res.status === 422)
    return new ResendError('bad_request', 'Resend refused the message. Check the From address is allowed on a verified domain and the recipient address is valid.' + said, { status: res.status });
  return new ResendError('other', `Resend answered ${res.status}.` + said, { status: res.status });
}

export async function sendMail(r, { to, subject, text, html }) {
  const from = fromHeader(r);
  const payload = JSON.stringify({
    from,
    to: String(to).split(/[;,]/).map(a => a.trim()).filter(Boolean),
    subject,
    text: text || undefined,
    html: html || undefined,
  });
  let last;
  for (let i = 0; i <= backoffMs.length; i++) {
    let res;
    try {
      res = await fetch(`${API()}/emails`, {
        method: 'POST',
        headers: { authorization: `Bearer ${r.apiKey}`, 'content-type': 'application/json', 'user-agent': 'digital-kaizen' },
        body: payload,
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      const code = e.cause?.code || e.code || e.name;
      // Network errors are not retried here: the queue holds the message and tries later.
      throw new ResendError('network', `Could not reach Resend: ${code === 'TimeoutError' ? 'timed out' : code || 'network error'}`);
    }
    const t = await res.text();
    let body = {}; try { body = t ? JSON.parse(t) : {}; } catch { body = { message: t.slice(0, 120) }; }
    if (res.ok) return body.id || 'accepted';
    last = classify(res, body, from);
    if (last.kind !== 'throttled' && last.kind !== 'server') throw last;
    const ra = Number(res.headers.get('retry-after'));
    if (i < backoffMs.length) await sleep(ra > 0 ? Math.min(ra * 1000, 30000) : backoffMs[i]);
  }
  throw last;
}
