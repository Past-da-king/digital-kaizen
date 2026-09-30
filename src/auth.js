// ============================================================
// Access control — needed the moment this stops being a laptop on
// a factory LAN and gets a public address.
//
// Three different audiences, three different answers:
//
//   DEVICES     the sensors. Username + password on the MQTT
//               broker. Without this anyone on the internet can
//               publish fake production numbers into the database.
//
//   MANAGEMENT  the dashboard and its API. One shared password,
//               exchanged for a signed session cookie.
//
//   OPERATORS   the QR attribution page. Deliberately NOT a login —
//               a person standing at a machine with oily hands is
//               not going to type a password, and if you make them,
//               they simply stop attributing and the data dies.
//               Instead the printed QR carries a per-machine key.
//               Whoever holds the label can answer for that machine
//               and nothing else. Lose a label, rotate one key.
//
// With no secrets configured everything stays open, which is right
// for a laptop on a closed factory network and wrong for anything
// with a public IP — so the server refuses to bind publicly without
// them. See requireSecretsForPublic().
// ============================================================

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MACHINES } from './config.js';

const SECRETS_FILE = process.env.DK_SECRETS || fileURLToPath(new URL('../data/secrets.json', import.meta.url));

function loadOrCreateSecrets() {
  // Environment wins, so a container can be configured without a file.
  if (process.env.DK_MQTT_USER && process.env.DK_MQTT_PASS && process.env.DK_DASH_PASS) {
    return {
      mqttUser: process.env.DK_MQTT_USER,
      mqttPass: process.env.DK_MQTT_PASS,
      dashPass: process.env.DK_DASH_PASS,
      sessionKey: process.env.DK_SESSION_KEY || randomBytes(32).toString('hex'),
      machineKeys: JSON.parse(process.env.DK_MACHINE_KEYS || 'null') || deriveMachineKeys(process.env.DK_SESSION_KEY || 'dev'),
      source: 'environment',
    };
  }

  if (existsSync(SECRETS_FILE)) {
    return { ...JSON.parse(readFileSync(SECRETS_FILE, 'utf8')), source: 'data/secrets.json' };
  }

  return null;
}

function deriveMachineKeys(seed) {
  const keys = {};
  for (const m of MACHINES) {
    keys[m.id] = createHmac('sha256', seed).update('machine:' + m.id).digest('hex').slice(0, 12);
  }
  return keys;
}

// Called explicitly by an install step, never silently at boot — a
// system that invents its own credentials on every restart locks out
// every sensor that was configured with the old ones.
export function generateSecrets() {
  const sessionKey = randomBytes(32).toString('hex');
  const secrets = {
    mqttUser: 'sensors',
    mqttPass: randomBytes(12).toString('base64url'),
    dashPass: randomBytes(9).toString('base64url'),
    sessionKey,
    machineKeys: deriveMachineKeys(sessionKey),
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(SECRETS_FILE), { recursive: true });
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

const secrets = loadOrCreateSecrets();

export function isLocked() { return secrets !== null; }
export function secretsSource() { return secrets?.source || 'none — running open'; }
export function machineKey(id) { return secrets?.machineKeys?.[id] || null; }

// The app's own MQTT clients (ingest, and the simulated devices) have
// to authenticate against the broker like anything else. Reading the
// credentials from here rather than from env means they still work
// when the secrets came from the file instead.
export function deviceCredentials() {
  if (!secrets) return {};
  return { username: secrets.mqttUser, password: secrets.mqttPass };
}

// --- devices -------------------------------------------------
export function checkDevice(username, password) {
  if (!secrets) return true;                       // open mode
  return safeEqual(username, secrets.mqttUser) && safeEqual(password, secrets.mqttPass);
}

// --- management ----------------------------------------------
export function checkDashPassword(pw) {
  if (!secrets) return true;
  return safeEqual(pw, secrets.dashPass);
}

export function mintSession() {
  if (!secrets) return '';
  const payload = `${Date.now() + 30 * 86400000}`;   // 30 days
  const sig = createHmac('sha256', secrets.sessionKey).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}

export function validSession(cookieHeader) {
  if (!secrets) return true;
  const raw = /(?:^|;\s*)dk_session=([^;]+)/.exec(cookieHeader || '')?.[1];
  if (!raw) return false;
  const [payload, sig] = decodeURIComponent(raw).split('.');
  if (!payload || !sig) return false;
  const want = createHmac('sha256', secrets.sessionKey).update(payload).digest('hex').slice(0, 32);
  if (!safeEqual(sig, want)) return false;
  return Number(payload) > Date.now();
}

// --- operators -----------------------------------------------
export function checkMachineKey(machineId, key) {
  if (!secrets) return true;
  const want = secrets.machineKeys?.[machineId];
  return Boolean(want) && safeEqual(key, want);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
