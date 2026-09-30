// ============================================================
// One-time setup for an on-site install.
//
//   npm run setup
//
// Does two things and both are safe to repeat:
//   1. Creates the dashboard password (data/secrets.json) if there
//      is none yet. It is never regenerated on a second run — a new
//      password every time would lock out everybody who had the old
//      one, and would change the key printed into every QR label.
//   2. Writes the .env settings file if there is none yet, asking
//      for the address and login of the MQTT broker the sensors
//      already publish to.
//
// Skip the questions by passing the answers:
//   npm run setup -- --broker-url mqtt://127.0.0.1:1883 \
//                    --broker-user NAME --broker-pass PASSWORD --port 4310
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENV_FILE = ROOT + '.env';
const SECRETS_FILE = process.env.DK_SECRETS || ROOT + 'data/secrets.json';

const flag = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

// ---- 1. the dashboard password
let secrets;
if (existsSync(SECRETS_FILE)) {
  secrets = JSON.parse(readFileSync(SECRETS_FILE, 'utf8'));
  console.log('\n  Dashboard password already exists — kept as it is.');
} else {
  const { generateSecrets } = await import('../src/auth.js');
  secrets = generateSecrets();
  console.log('\n  Dashboard password created.');
}

// ---- 2. the settings file
if (existsSync(ENV_FILE)) {
  console.log('  Settings file .env already exists — kept as it is.');
} else {
  let url = flag('broker-url');
  let user = flag('broker-user');
  let pass = flag('broker-pass');
  const port = flag('port') || '4310';

  // Ask only when a person is actually there to answer.
  if (process.stdin.isTTY && url === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n  The sensors already send their data to an MQTT broker (Mosquitto).');
    console.log('  This app listens on that same broker. Press Enter to accept [the default].\n');
    try {
      const host = (await rl.question('  Broker address [127.0.0.1]: ')).trim() || '127.0.0.1';
      const bport = (await rl.question('  Broker port [1883]: ')).trim() || '1883';
      url = `mqtt://${host}:${bport}`;
      user = (await rl.question('  Broker username (the one in the sensor file, blank if none): ')).trim();
      pass = user ? (await rl.question('  Broker password: ')).trim() : '';
    } catch {
      // Ctrl+C / Ctrl+D half way through: write nothing rather than a
      // half-answered settings file.
      console.log('\n\n  Stopped. Nothing was saved — run "npm run setup" again when ready.\n');
      process.exit(1);
    }
    rl.close();
  }

  url ||= 'mqtt://127.0.0.1:1883';
  const lines = [
    '# Digital Kaizen settings. Edit with any text editor, then restart the app.',
    '',
    '# The MQTT broker the sensors already publish to. This app only listens on it.',
    `DK_BROKER_URL=${url}`,
    `DK_BROKER_USER=${user || ''}`,
    `DK_BROKER_PASS=${pass || ''}`,
    '',
    '# The first part of the topic the sensors publish on. Must match the sensor file.',
    'DK_TOPIC_ROOT=factory-demo-9f7c2a61',
    '',
    '# The port the dashboard is served on.',
    `DK_WEB_PORT=${port}`,
    '',
  ];
  writeFileSync(ENV_FILE, lines.join('\n'));
  console.log(`  Settings written to .env  (broker ${url}${user ? ', user ' + user : ', no login'})`);
}

console.log('\n  ' + '-'.repeat(52));
console.log(`  DASHBOARD PASSWORD:  ${secrets.dashPass}`);
console.log('  ' + '-'.repeat(52));
console.log('  Write it down. Run "npm run setup" again to see it again.');
console.log('\n  Next:  npm run check    (are the sensors being heard?)');
console.log('         npm start        (start the dashboard)\n');
