import './_env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.RESEND_API_KEY = 're_test_secret_do_not_log';
process.env.DK_MAIL_FROM = 'alerts@factory.example';
process.env.DK_MAIL_FROM_NAME = 'Factory alerts';
const transport = await import('../src/resend.js');
transport.setBackoff([1, 1]);
const mail = await import('../src/mail.js');
const store = await import('../src/store.js');

let server, responses = [], requests = [];
before(async () => {
  server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    requests.push({ auth: req.headers.authorization, body: JSON.parse(data), url: req.url });
    const code = responses.shift() || 200;
    res.writeHead(code, {'content-type': 'application/json'});
    res.end(JSON.stringify(code === 200 ? {id: 'test-id'} : {message: 're_test_secret_do_not_log'}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.DK_RESEND_URL = 'http://127.0.0.1:' + server.address().port;
});
after(async () => new Promise(resolve => server.close(resolve)));

test('queue and test mail use Resend with the environment sender', async () => {
  const r = await mail.sendTest('recipient@factory.example');
  assert.equal(r.ok, true); assert.equal(mail.status().transport, 'resend');
  assert.equal(requests[0].auth, 'Bearer re_test_secret_do_not_log');
  assert.equal(requests[0].url, '/emails');
  assert.equal(requests[0].body.from, 'Factory alerts <alerts@factory.example>');
  assert.deepEqual(requests[0].body.to, ['recipient@factory.example']);
  assert.equal(store.recentMail(1)[0].status, 'sent');
});
for (const code of [401,403,422]) test('clear error '+code+' without leaking key', async () => {
  responses.push(code);
  let error;
  try { await mail.sendNow({to:'recipient@factory.example', subject:'Test', text:'Test'}); } catch (e) { error = e; }
  assert.ok(error); assert.equal(error.status, code); assert.ok(!error.message.includes(process.env.RESEND_API_KEY));
  if (code === 401) assert.match(error.message, /key/i);
  if (code === 403) assert.match(error.message, /refused|domain/i);
  if (code === 422) assert.match(error.message, /verified domain/i);
});
for (const code of [429,500]) test('retries '+code+' before success', async () => {
  const count = requests.length; responses.push(code, code, 200);
  assert.equal(await mail.sendNow({to:'recipient@factory.example', subject:'Test', text:'Test'}), 'test-id');
  assert.equal(requests.length - count, 3);
});
test('queue records safe error and retries after temporary failures', async () => {
  responses.push(500,500,500);
  const now = new Date();
  const id = store.enqueueMail({kind:'test',to:'recipient@factory.example',subject:'Test',text:'Test',now});
  const result = await mail.processQueue(now);
  assert.equal(result.retried, 1);
  const row = store.recentMail(1).find(x => x.id === id);
  assert.ok(!JSON.stringify(row).includes(process.env.RESEND_API_KEY));
});
