// ============================================================
// Install-day check: can this machine hear the sensors?
//
//   npm run check
//
// Connects to the broker named in .env, listens for 20 seconds and
// lists every sensor it hears. It only listens — nothing is
// published, nothing is stored, and the app does not need to be
// running.
// ============================================================

import mqtt from 'mqtt';
import { randomBytes } from 'node:crypto';
import { MQTT } from '../src/config.js';

const LISTEN_SEC = Number(process.argv[2] || 20);
const url = MQTT.externalUrl || `mqtt://127.0.0.1:${MQTT.port}`;

if (!MQTT.externalUrl) {
  console.log('\n  No DK_BROKER_URL is set (no .env file yet?). Run "npm run setup" first.');
  console.log(`  Trying ${url} anyway.`);
}

console.log(`\n  Connecting to ${url}${MQTT.externalUser ? ' as "' + MQTT.externalUser + '"' : ' with no login'} ...`);

const client = mqtt.connect(url, {
  clientId: `digital-kaizen-check-${randomBytes(3).toString('hex')}`,
  connectTimeout: 8000,
  reconnectPeriod: 0,
  ...(MQTT.externalUser ? { username: MQTT.externalUser, password: MQTT.externalPass } : {}),
});

const heard = new Map();   // sensor id -> { count, last }
const fail = (msg) => { console.log(`\n  NOT WORKING: ${msg}\n`); process.exit(1); };

client.on('error', (e) => {
  const m = String(e.message || e);
  if (/not authorized|bad user ?name or password/i.test(m)) {
    fail('the broker refused the login. Check DK_BROKER_USER and DK_BROKER_PASS in .env —\n  they must be the same username and password that are in the sensor file.');
  }
  if (e.code === 'ECONNREFUSED') {
    fail(`nothing is answering at ${url}. Is Mosquitto running, and is the address in .env right?`);
  }
  if (/connack timeout/i.test(m)) {
    fail(`something answers at ${url} but it does not behave like an MQTT broker.\n  Check the address and port in DK_BROKER_URL in .env.`);
  }
  fail(m);
});

client.on('close', () => { if (!client.connectedOnce) fail(`could not connect to ${url} within 8 seconds.`); });

client.on('connect', () => {
  client.connectedOnce = true;
  console.log('  Connected. Listening for sensors for ' + LISTEN_SEC + ' seconds ...\n');
  client.subscribe([MQTT.deviceWildcard, MQTT.wildcard]);
  setTimeout(() => {
    client.end(true);
    if (!heard.size) {
      console.log('  The broker is fine, but NO SENSOR was heard.');
      console.log('  - Is a sensor powered on and showing a reading?');
      console.log(`  - Does the sensor file publish under "${MQTT.deviceWildcard.split('/')[0]}"?`);
      console.log('    If its MQTT_TOPIC starts with something else, put that in DK_TOPIC_ROOT in .env.\n');
      process.exit(2);
    }
    console.log(`\n  WORKING: ${heard.size} sensor${heard.size > 1 ? 's' : ''} heard.`);
    for (const [id, h] of heard) {
      console.log(`    ${id}   ${h.count} messages   status ${h.last.status ?? '?'}   shots ${h.last.shots ?? '?'}   reading ${h.last.distance_mm ?? '?'} mm`);
    }
    console.log('\n  Start the app with "npm start" and pair each sensor on the Sensors page.\n');
    process.exit(0);
  }, LISTEN_SEC * 1000);
});

client.on('message', (topic, buf) => {
  let p = {};
  try { p = JSON.parse(buf.toString()); } catch { /* count it anyway */ }
  const id = p.device_id || p.machine_id || topic.split('/').slice(-2, -1)[0];
  if (!heard.has(id)) console.log(`  heard sensor ${id}  (${topic})`);
  const h = heard.get(id) || { count: 0, last: {} };
  heard.set(id, { count: h.count + 1, last: p });
});
