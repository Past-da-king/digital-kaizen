// ============================================================
// A throw-away mail server for TESTING escalation emails.
//
//   npm run mail-sink
//
// Listens for SMTP on port 1025 and keeps every message it is given
// in memory; nothing leaves this PC. Open http://localhost:8025 to
// read what "would have been sent". Point Settings > Email at host
// 127.0.0.1, port 1025, security "none", no user, and press "Send a
// test email". Real addresses on the ladder never receive anything
// while this is the mail server.
//
// (Needs the dev packages: npm install.)
// ============================================================

import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createServer } from 'node:http';

export async function startSink({ port = 1025, web = 0, host = '127.0.0.1' } = {}) {
  const messages = [];
  const smtp = new SMTPServer({
    authOptional: true, disabledCommands: ['STARTTLS'], logger: false, size: 5 * 1024 * 1024,
    onData(stream, session, done) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', async () => {
        try {
          const raw = Buffer.concat(chunks);
          const mail = await simpleParser(raw);
          messages.push({
            at: new Date().toISOString(),
            from: mail.from?.text, to: (mail.to?.value || []).map(v => v.address),
            envelopeTo: session.envelope.rcptTo.map(r => r.address),
            subject: mail.subject, text: mail.text, html: mail.html || '',
          });
          done();
        } catch (e) { done(e); }
      });
    },
  });
  await new Promise((res, rej) => { smtp.once('error', rej); smtp.listen(port, host, res); });
  const smtpPort = smtp.server.address().port;

  let httpServer = null;
  if (web !== null) {
    httpServer = createServer((req, res) => {
      if (req.url.startsWith('/messages.json')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(messages));
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      res.end(`<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=5><title>Mail sink</title>
<body style="font-family:system-ui;max-width:860px;margin:24px auto;padding:0 16px"><h1>Mail sink: ${messages.length} message(s)</h1>
${messages.slice().reverse().map(m => `<div style="border:1px solid #ccc;border-radius:8px;padding:12px;margin:12px 0">
<b>${esc(m.subject)}</b><br><small>${esc(m.at)} &middot; to ${esc(m.to.join(', '))}</small><pre style="white-space:pre-wrap">${esc(m.text)}</pre></div>`).join('')}</body>`);
    });
    await new Promise((r) => httpServer.listen(web, host, r));
  }
  return {
    port: smtpPort, webPort: httpServer?.address().port, messages,
    close: () => Promise.all([new Promise(r => smtp.close(r)), httpServer && new Promise(r => httpServer.close(r))]),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const sink = await startSink({ port: Number(process.env.SINK_SMTP || 1025), web: Number(process.env.SINK_WEB || 8025), host: '0.0.0.0' });
  console.log(`\n  Mail sink running.\n  SMTP  127.0.0.1:${sink.port}   (security: none, no login)\n  Read  http://localhost:${sink.webPort}\n  Nothing is delivered to real addresses.\n`);
}
