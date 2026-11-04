// End-to-end proof in a real browser against a running SIMULATED factory
// (no factory access, local test mail server only).
//
//   1. start the demo with its own database, and the mail sink (npm run mail-sink)
//   2. node scripts/create-admin.js "Name" a@factory.test      (prints the setup link)
//   3. E2E_INVITE=<that link> E2E_BASE=http://localhost:4410 node scripts/e2e-browser.mjs <screenshot folder>
//
// Needs playwright-core and a Chrome or Edge.
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PW || 'playwright-core');
const BASE = process.env.E2E_BASE || 'http://localhost:4410';
const SINK = process.env.E2E_SINK || 'http://localhost:8025';
const INVITE = process.env.E2E_INVITE;
const OUT = process.argv[2] || './e2e-shots'; mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASSWORD = 'Factory-Floor-Kaizen-42';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (s) => { let bits = ''; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (secret, offset = 0) => { const step = Math.floor(Date.now() / 30000) + offset; const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac('sha1', b32(secret)).update(m).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = []; const errors = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: Boolean(cond), extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const desk = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await desk.newPage();
const watch = (p, tag) => { p.on('pageerror', e => errors.push(`${tag}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); }); };
watch(page, 'desktop');
const sinkMsgs = async () => (await fetch(`${SINK}/messages.json`)).json();

// ---------- 1. accounts: invite -> password -> authenticator -> recovery codes
await page.goto(INVITE);
await page.fill('#pw', PASSWORD); await page.fill('#pw2', PASSWORD); await page.click('button[type=submit]');
await page.waitForSelector('img[alt^="QR code"]');
const secret = (await page.locator('b[style*="mono"]').innerText()).trim();
await page.screenshot({ path: join(OUT, 'e2e-1-authenticator-setup.png') });
await page.fill('#code', totp(secret)); await page.click('button[type=submit]');
await page.waitForSelector('.codes');
const codes = await page.locator('.codes span').allInnerTexts();
ok('invite flow gives 10 recovery codes', codes.length === 10);
await page.click('#done'); await page.waitForURL(BASE + '/');
ok('admin lands on the dashboard after setup', await page.locator('.hero').count() === 1);

// sign out, sign in with the NEXT 30 s code (the setup code is spent)
await page.click('#meBtn'); await page.click('#signOut'); await page.waitForURL('**/login.html');
await page.fill('#email', 'a@factory.test'); await page.fill('#pw', 'wrong-password-123'); await page.click('#go');
await page.waitForFunction(() => document.querySelector('#err')?.textContent.length > 0);
ok('wrong password is refused', (await page.locator('#err').innerText()).includes('Wrong email or password'));
await page.waitForTimeout(500);
await page.fill('#pw', PASSWORD); await page.click('#go');
await page.waitForSelector('#code');
await page.fill('#code', '111111'); await page.click('#go'); await page.waitForTimeout(400);
ok('wrong authenticator code is refused', (await page.locator('#err').innerText()).length > 0);
await page.fill('#code', totp(secret, 1)); await page.click('#go'); await page.waitForURL(BASE + '/');
ok('two-step sign in works', true);

// ---------- 2. settings: mail account is the LOCAL SINK; fast ladder for the test
await page.goto(BASE + '/settings.html'); await page.waitForSelector('#levels');
await page.screenshot({ path: join(OUT, 'e2e-2-settings-1920.png'), fullPage: true });
await page.fill('#smHost', '127.0.0.1'); await page.fill('#smPort', '1025'); await page.selectOption('#smSec', 'none'); await page.fill('#smFrom', 'kaizen@factory.test');
await page.fill('#dtMin', '1'); await page.fill('#dfMax', '8');
await page.fill('#every', '0.5'); await page.click('#spread');
// make level 3 carry two people to prove several people per level
await page.click('[data-addp="2"]');
const lastPerson = page.locator('#levels .level').nth(2).locator('.person').last();
await lastPerson.locator('.pn').fill('Second Manager'); await lastPerson.locator('.pr').fill('Deputy'); await lastPerson.locator('.pe').fill('deputy.production@evernu.example');
await page.click('#save'); await page.waitForSelector('.toast');
const settingsSaved = await (await fetch(BASE + '/api/settings', { headers: { cookie: (await desk.cookies()).map(c => `${c.name}=${c.value}`).join('; ') } })).json();
ok('ladder edits are saved (3 people-levels, level 2 at 0.5 min)', settingsSaved.settings.ladder[1].afterMin === 0.5 && settingsSaved.settings.ladder[2].people.length === 2);
for (const n of ['Thandi Mokoena', 'Sipho Dlamini']) { await page.fill('#opName', n); await page.click('#opAdd'); await page.waitForTimeout(300); }
ok('operators added to the name list', (await page.locator('#ops .rowline').count()) === 2);
await page.fill('#testTo', 'tester@factory.test'); await page.click('#testBtn');
await page.waitForFunction(() => document.querySelector('#testOut')?.textContent.includes('Sent'), null, { timeout: 15000 });
ok('test email reaches the local mail sink', (await sinkMsgs()).some(m => m.envelopeTo.includes('tester@factory.test')));
const cookieHeader = (await desk.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
const aget = (p) => fetch(BASE + p, { headers: { cookie: cookieHeader } });

// ---------- 3. the QR page on a phone
const qrTarget = (await aget('/api/qr?m=MA1')).headers.get('x-qr-target').replace(/^http:\/\/[^/]+/, BASE);
const qrTarget2 = (await aget('/api/qr?m=MA2')).headers.get('x-qr-target').replace(/^http:\/\/[^/]+/, BASE);
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await phone.newPage(); watch(p, 'phone');
await p.goto(qrTarget); await p.waitForSelector('.act');
ok('MA1 running: only Log defects (no downtime button)', (await p.locator('.act.dt').count()) === 0 && (await p.locator('.act.df').count()) === 1, await p.locator('.statebar .big').innerText());
await p.screenshot({ path: join(OUT, 'e2e-3-qr-running.png') });
await p.click('.name >> text=Thandi Mokoena');
await p.click('.act.df');
await p.click('[data-add="5"]'); await p.click('[data-type="short_shot"]');
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
writeFileSync(join(OUT, 'photo.jpg'), jpg);
await p.setInputFiles('#pfile', join(OUT, 'photo.jpg'));
await p.waitForSelector('.photo img');
await p.fill('#note', 'cavity 3 only');
await p.screenshot({ path: join(OUT, 'e2e-3-qr-defects-form.png') });
await p.click('#send'); await p.waitForSelector('.done');
ok('defects saved from the phone', (await p.locator('.done h1').innerText()).includes('Defects saved'), await p.locator('.done p').first().innerText());
await p.screenshot({ path: join(OUT, 'e2e-3-qr-saved.png') });
let rows = (await (await aget('/api/logs/defects')).json()).rows;
ok('defect row has name, type, quantity, shift, photo', rows.length === 1 && rows[0].operator === 'Thandi Mokoena' && rows[0].qty === 6 && rows[0].type_label === 'Short shot' && /^[AB]$/.test(rows[0].shift) && Boolean(rows[0].photo));
ok('photo is served to signed-in staff', (await aget('/photos/' + rows[0].photo)).status === 200);

// over the shift limit (8) -> an escalation by itself
await p.click('#again'); await p.waitForSelector('.act.df'); await p.click('.act.df');
await p.click('[data-add="5"]'); await p.click('[data-type="flash"]'); await p.click('#send'); await p.waitForSelector('.done');
await sleep(1500);
let issues = (await (await aget('/api/issues')).json()).issues;
ok('10 defects (limit 8) raised a defects issue', issues.some(i => i.kind === 'defects' && i.machine_id === 'MA1'));

// there is no way to start an escalation from the phone: no button, and the route is gone
await p.click('#again'); await p.waitForSelector('.act.df');
ok('no Call a manager button on the QR page', (await p.locator('text=Call a manager').count()) === 0 && (await p.locator('[data-go="escalate"]').count()) === 0);
const qs = qrTarget.split('?')[1];
const noRoute = await fetch(`${BASE}/api/log/escalate?${qs}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'x' }) });
const noRouteBody = await noRoute.text();
ok('the manual escalate route no longer exists', (noRoute.status === 404 || noRoute.status === 401 || noRoute.status === 403) && !noRouteBody.includes('"ok":true'), String(noRoute.status));

// ---------- 4. MA2 goes down: the page changes, the ladder climbs by email
// a real sensor must have learned the stroke before it can tell a stop from a start-up
for (let i = 0; i < 60; i++) {
  const lv = await (await aget('/api/live')).json();
  const m2 = lv.machines.find(m => m.machine_id === 'MA2');
  if (m2 && !m2.offline && m2.status === 'RUNNING' && m2.shots > 0) break;
  await sleep(5000);
}
const stopRes = await fetch(BASE + '/api/demo/stop', { method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: JSON.stringify({ machine: 'MA2', seconds: 900 }) });
ok('demo stop accepted', stopRes.status === 200, String(stopRes.status));
console.log('MA2 stopped, waiting for the downtime event and the ladder (about 3 minutes)...');
const t0 = Date.now();
let down = false;
while (Date.now() - t0 < 240000) {
  const c = await (await fetch(`${BASE}/api/log/context?${qrTarget2.split('?')[1]}`)).json();
  if (c.state === 'down') { down = true; break; }
  await sleep(5000);
}
ok('MA2 page switches to DOWN from the live sensor state', down, `${Math.round((Date.now() - t0) / 1000)} s`);
const p2 = await phone.newPage(); watch(p2, 'phone2');
await p2.goto(qrTarget2); await p2.waitForSelector('.act');
ok('MA2 down: Log downtime is offered', (await p2.locator('.act.dt').count()) === 1);
await p2.screenshot({ path: join(OUT, 'e2e-4-qr-down.png') });

// wait for the downtime issue and the first mails
let mails = [];
const t1 = Date.now();
while (Date.now() - t1 < 200000) {
  issues = (await (await aget('/api/issues')).json()).issues;
  mails = await sinkMsgs();
  if (issues.some(i => i.kind === 'downtime' && i.machine_id === 'MA2') && mails.filter(m => /MA2/.test(m.subject) && /Level/.test(m.subject)).length >= 3) break;
  await sleep(5000);
}
const ma2 = mails.filter(m => /MA2/.test(m.subject) && /Level \d/.test(m.subject));
ok('sensor stop became an issue and level 1 to 3 emails reached the sink', ma2.length >= 3, ma2.map(m => m.subject.replace('[Digital Kaizen] ', '') + ' -> ' + m.to.join('/')).join(' | '));
const l1 = ma2.find(m => /Level 1/.test(m.subject));
ok('email says machine, issue, since when and who it has gone to', l1 && ['Machine:', 'Haitian MA2', 'Since:', 'Already told', 'Next:'].every(w => l1.text.includes(w)));
ok('level 3 went to both people at that level', mails.filter(m => /Level 3/.test(m.subject) && /MA2/.test(m.subject)).length === 2);

// explain the live stop from the phone, then acknowledge from the email link
await p2.click('.name >> text=Sipho Dlamini'); await p2.click('.act.dt'); await p2.click('[data-reason="material_issue"]'); await p2.fill('#note', 'resin dryer tripped'); await p2.click('#send'); await p2.waitForSelector('.done');
ok('downtime reason saved against the live stop', (await p2.locator('.done h1').innerText()).includes('Downtime saved'));

const ackLink = (ma2.at(-1).text.match(/http\S+\/ack\?t=\w+/) || [])[0];
ok('email carries an acknowledge link', Boolean(ackLink));
const before = (await sinkMsgs()).filter(m => /Level/.test(m.subject) && /MA2/.test(m.subject)).length;
const ap = await desk.newPage(); watch(ap, 'ack');
await ap.goto(ackLink.replace(/^http:\/\/[^/]+/, BASE)); await ap.waitForSelector('#ack');
await ap.screenshot({ path: join(OUT, 'e2e-5-acknowledge-page.png') });
await ap.fill('#who', 'Maintenance Manager'); await ap.click('#ack'); await ap.waitForSelector('text=Nobody else will be emailed');
await sleep(75000);   // longer than two further levels at 0.5 min spacing
const after = (await sinkMsgs()).filter(m => /Level/.test(m.subject) && /MA2/.test(m.subject)).length;
ok('acknowledging stopped the ladder (no more level mails)', after === before, `before ${before}, after ${after}`);
ok('the people already told got an acknowledged note', (await sinkMsgs()).some(m => /Acknowledged/.test(m.subject)));

// the machine restarts: the stop closes and the explained stop joins the downtime log
await fetch(BASE + '/api/demo/start', { method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: JSON.stringify({ machine: 'MA2' }) });
await sleep(20000);
const dlRows = (await (await aget('/api/logs/downtime?from=2020-01-01&to=2099-01-01')).json()).rows;
ok('explained stop is in the downtime log once the machine restarts', dlRows.some(r => r.machine_id === 'MA2' && r.reason_label === 'Material issue' && r.operator === 'Sipho Dlamini' && r.source === 'sensor'), JSON.stringify(dlRows.map(r => [r.reason_label, r.minutes])));
issues = (await (await aget('/api/issues')).json()).issues;
ok('the downtime issue resolved by itself when the machine ran again', issues.some(i => i.kind === 'downtime' && i.state === 'RESOLVED'));

// ---------- 5. every page, both sizes, no console errors
const nav = ['/', '/quality.html', '/escalations.html', '/history.html', '/sensors.html', '/qr.html', '/settings.html', '/users.html', '/account.html', '/about.html'];
for (const [w, h, tag, ctxx] of [[1920, 1080, '1920', desk], [390, 844, '390', null]]) {
  const c = ctxx || await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  if (!ctxx) await c.addCookies(await desk.cookies());
  const pg = await c.newPage(); watch(pg, `page-${tag}`);
  for (const path of nav) {
    await pg.goto(BASE + path); await pg.waitForLoadState('networkidle'); await pg.waitForTimeout(700);
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (tag === '390') ok(`no sideways scroll on ${path} at 390`, !overflow);
    await pg.screenshot({ path: join(OUT, `page${path === '/' ? '-live' : path.replace('.html', '').replace('/', '-')}-${tag}.png`), fullPage: true });
  }
  if (!ctxx) await c.close();
}

// ---------- 6. exports
const csvDf = await (await aget('/api/logs/defects.csv?from=2020-01-01&to=2099-01-01')).text();
const csvDt = await (await aget('/api/logs/downtime.csv?from=2020-01-01&to=2099-01-01')).text();
ok('defects CSV has the names, types and shift', /Thandi Mokoena/.test(csvDf) && /Short shot/.test(csvDf));
ok('downtime CSV has the reason, name and note', /Material issue/.test(csvDt) && /Sipho Dlamini/.test(csvDt) && /resin dryer tripped/.test(csvDt));
const iss = await (await aget('/api/issues.csv')).text();
ok('escalations CSV exports', /acknowledged_by/.test(iss) && /Maintenance Manager/.test(iss));

ok('no console or page errors anywhere', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter(r => !r.pass);
writeFileSync(join(OUT, 'e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${failed.length ? failed.length + ' FAILED' : 'ALL PASSED'}: ${results.length - failed.length} of ${results.length}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
