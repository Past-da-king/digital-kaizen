// ============================================================
// Ingest — the Node-RED half, rewritten so it can be reasoned
// about and tested.
//
// Accepts machine payloads two ways, exactly like the client's flow:
//   1. MQTT on factory-demo-9f7c2a61/machines/+/data   (the device)
//   2. HTTP POST /machine-data                          (the fallback)
//
// And does what their "function 5" node does — write a row only
// when the shot count changes — plus the two things it does not:
// record status intervals, and keep a live snapshot for the UI.
// ============================================================

import mqtt from 'mqtt';
import { randomBytes } from 'node:crypto';
import { MQTT, MACHINES } from './config.js';
import { recordShot, recordStatus, beat, seeDevice, deviceFor } from './db.js';
import { observe, onEvent } from './events.js';
import { deviceCredentials } from './auth.js';

const live = new Map();        // machine_id -> latest payload (+ derived)
const lastShots = new Map();   // machine_id -> last shot count seen
const lastSeenAt = new Map();  // machine_id -> when we last heard from it
const subscribers = new Set(); // SSE listeners

for (const m of MACHINES) {
  live.set(m.id, {
    machine_id: m.id, machine_name: m.name, part: m.part,
    status: 'OFFLINE', position: '—', shots: 0, distance_mm: 0,
    last_cycle_sec: 0, downtime_minutes: 0, offline: true,
  });
}

let onGap = null;
let onLog = null;
export function onShotGap(fn) { onGap = fn; }
export function onIngestLog(fn) { onLog = fn; }

// `now` is injectable so the guards can be tested against a simulated
// outage instead of a real one — without it, test payloads arrive
// microseconds apart and every reconstruction looks implausible.
// A sensor that reports a MAC instead of a machine name. Resolve it
// through the assignment table; an unassigned one is remembered and
// shown on the Sensors page, but its data is NOT recorded — we have no
// idea what machine it came from and inventing one would be worse than
// dropping it.
export function handleDevicePayload(payload, source = 'mqtt', now = new Date()) {
  const deviceId = String(payload?.device_id || '').toLowerCase();
  if (!deviceId) return;

  const row = seeDevice(deviceId, now);
  unassigned.set(deviceId, { ...payload, seen_at: now.toISOString() });

  if (!row?.machine_id) {
    broadcast({ type: 'device-unassigned', device_id: deviceId });
    return;
  }

  const spec = MACHINES.find(m => m.id === row.machine_id);
  handlePayload(
    { ...payload, machine_id: row.machine_id, machine_name: spec?.name || row.machine_id },
    source, now
  );
}

export function unassignedDevices() {
  return [...unassigned.entries()]
    .filter(([id]) => !deviceFor(id)?.machine_id)
    .map(([device_id, p]) => ({
      device_id,
      seen_at: p.seen_at,
      status: p.status,
      distance_mm: p.distance_mm,
      shots: p.shots,
      device_ip: p.device_ip,
    }));
}

const unassigned = new Map();   // device_id -> last payload seen

export function handlePayload(payload, source = 'mqtt', now = new Date()) {
  if (!payload || !payload.machine_id) return;
  const id = payload.machine_id;
  const spec = MACHINES.find(m => m.id === id);

  const prev = lastShots.get(id);
  const seenAt = lastSeenAt.get(id);
  const gapMs = seenAt ? now.getTime() - seenAt : 0;
  lastSeenAt.set(id, now.getTime());

  // ---- the client's "function 5" writes one row per change in
  // payload.shots and nothing else. That is faithful to their flow and
  // it is also wrong in two ways on a real floor, so both are guarded
  // here. The device counts in RAM; the network is what is unreliable.
  if (typeof payload.shots === 'number' && prev !== undefined) {
    const delta = payload.shots - prev;

    if (delta < 0) {
      // GUARD 1 — the counter went BACKWARDS, so the device rebooted
      // (shot_count lives in RAM and starts at 0). Unguarded this reads
      // as "a part came off": it writes a production row and tells the
      // downtime engine the machine recovered, while the machine may
      // still be stopped. Re-baseline and record it instead.
      recordStatus({ machineId: id, status: 'DEVICE RESTART', at: now });
      payload = { ...payload, sim_counter_reset: true };

    } else if (delta === 1) {
      recordShot({ machineId: id, cycletime: payload.last_cycle_sec, downtime: payload.downtime_minutes, at: now });

    } else if (delta > 1) {
      // GUARD 2 — the count jumped by N, so N-1 shots were made while
      // we could not hear the device. Unguarded those parts are lost
      // for ever and the one row that IS written carries a cycle time
      // spanning the whole outage. Reconstruct the run at its average
      // rate so the COUNT stays true, and log that it was reconstructed
      // so nobody mistakes it for measured data.
      const spanSec = gapMs > 0 ? gapMs / 1000 : delta * (payload.last_cycle_sec || 0);
      const each = Math.round((spanSec / delta) * 10) / 10;

      // SANITY CAP. Reconstructing a run assumes the jump is real. A
      // device cannot make a part faster than about a second, so an
      // implied cycle below that is not a missed run — it is a garbled
      // payload, a misconfigured device, or someone publishing junk on
      // the topic. Found by publishing shots:4242 as a connectivity
      // test and watching it manufacture thousands of production rows.
      if (each < 1) {
        recordStatus({ machineId: id, status: `COUNTER ANOMALY +${delta}`, at: now });
        onLog?.(`${id}: ignoring implausible jump of ${delta} shots in ${Math.round(spanSec)}s`);
        lastShots.set(id, payload.shots);
        live.set(id, { ...payload, part: spec?.part, offline: false, source, received_at: now.toISOString() });
        return;
      }

      for (let i = delta; i >= 1; i--) {
        recordShot({
          machineId: id,
          cycletime: each,
          downtime: payload.downtime_minutes,
          at: new Date(now.getTime() - Math.round((i - 1) * (spanSec / delta) * 1000)),
        });
      }
      recordStatus({ machineId: id, status: `RECONNECT +${delta} shots`, at: now });
      onGap?.(id, delta, spanSec);
    }
  }
  if (typeof payload.shots === 'number') lastShots.set(id, payload.shots);

  if (payload.status) recordStatus({ machineId: id, status: payload.status, at: now });
  beat(id, source, now);

  const snapshot = {
    ...payload,
    part: spec?.part,
    offline: false,
    source,
    received_at: now.toISOString(),
  };
  live.set(id, snapshot);
  broadcast({ type: 'live', machine: snapshot });

  // The downtime engine sees every payload — it is what decides
  // whether a gap is a micro-stop, an event, or an escalation.
  observe(payload, now);
}

export function getLive() {
  const now = Date.now();
  return MACHINES.map(m => {
    const s = live.get(m.id);
    // No payload for 10s means the device is gone, whatever it last said.
    const age = s.received_at ? now - Date.parse(s.received_at) : Infinity;
    return age > 10000 ? { ...s, offline: true, status: 'OFFLINE' } : s;
  });
}

// Anything the downtime engine emits goes straight out to the UI.
onEvent((msg) => broadcast({ type: 'engine', ...msg }));

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
function broadcast(msg) {
  for (const fn of subscribers) { try { fn(msg); } catch { /* dead listener */ } }
}

export function startMqttIngest({ onLog = () => {} } = {}) {
  // On-site mode connects to the factory's broker with the login that
  // broker expects, which is not ours to generate. The client id gets a
  // random tail because a broker drops the older of two clients that
  // share an id, and a second copy of this app must not silence the first.
  const external = Boolean(MQTT.externalUrl);
  const client = external
    ? mqtt.connect(MQTT.externalUrl, {
        clientId: `digital-kaizen-${randomBytes(3).toString('hex')}`,
        ...(MQTT.externalUser ? { username: MQTT.externalUser, password: MQTT.externalPass } : {}),
      })
    : mqtt.connect(`mqtt://127.0.0.1:${MQTT.port}`, {
        clientId: 'dk-ingest',
        ...deviceCredentials(),
      });
  const heard = new Set();
  client.on('connect', () => {
    client.subscribe([MQTT.deviceWildcard, MQTT.wildcard], () =>
      onLog(`ingest subscribed to ${MQTT.deviceWildcard} (and the legacy ${MQTT.wildcard})`));
  });
  client.on('error', (e) => onLog(`ingest mqtt error: ${e.message}`));
  client.on('offline', () => onLog('ingest lost the broker — retrying'));
  client.on('reconnect', () => onLog('ingest reconnecting to the broker'));
  client.on('message', (topic, buf) => {
    try {
      const payload = JSON.parse(buf.toString());
      // Say so once per topic: on install day this line is the proof
      // that a sensor's data is actually arriving.
      if (!heard.has(topic)) { heard.add(topic); onLog(`receiving data on ${topic}`); }
      // Route on the TOPIC, not the payload — a device payload has no
      // machine_id at all, which is the entire point of the change.
      if (topic.includes('/devices/')) handleDevicePayload(payload, 'mqtt');
      else handlePayload(payload, 'mqtt');
    } catch (e) {
      onLog(`bad payload on ${topic}: ${e.message}`);
    }
  });
  return client;
}
