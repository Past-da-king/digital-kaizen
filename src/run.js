// ============================================================
// One command starts the whole factory:
//   broker  ->  virtual devices  ->  ingest  ->  database  ->  dashboard
//
//   npm start                 everything, real time
//   DK_NO_SIM=1 npm start     no virtual devices — real hardware only
//   DK_BROKER_URL=mqtt://127.0.0.1:1883 npm start
//                             on-site mode: listen on a broker that is
//                             already running, start none, simulate nothing
//   DK_SPEED=6 npm start      run the virtual machines 6x faster
//   DK_FIRMWARE=asshipped     use the device's current constants,
//                             which is how you watch it fail to arm
// ============================================================

import mqtt from 'mqtt';
import { startBroker } from './broker.js';
import { startMqttIngest } from './ingest.js';
import { startServer } from './server.js';
import { VirtualDevice } from './sim/device.js';
import { MACHINES, MQTT, WEB, FIRMWARE, NETWORK } from './config.js';
import { registerDevice } from './devices.js';
import { seeDevice, assignDevice, deviceFor } from './db.js';
import { isLocked, secretsSource, deviceCredentials } from './auth.js';

const SPEED = Number(process.env.DK_SPEED || 1);
// On-site mode. The simulators are forced OFF here and that is not a
// preference: they publish on the same topics as the real sensors, so
// on the factory's own broker they would feed invented shots into
// whatever else is listening there.
const EXTERNAL = Boolean(MQTT.externalUrl);
const NO_SIM = EXTERNAL || process.env.DK_NO_SIM === '1';
const log = (m) => console.log(`  ${m}`);

console.log(`\n  DIGITAL KAIZEN — ${NO_SIM ? 'real hardware only' : 'simulated factory'}\n  ` + '-'.repeat(46));

if (EXTERNAL) log(`on-site mode — listening on the existing broker ${MQTT.externalUrl}, starting none`);
else await startBroker({ onLog: log });
startMqttIngest({ onLog: log });
await startServer({ onLog: log });

if (NO_SIM) {
  log('simulators OFF — waiting for real devices');
} else {
  for (const spec of MACHINES) {
    const dev = new VirtualDevice(spec);
    registerDevice(spec.id, dev);

    // A simulated sensor gets a stable fake MAC, exactly like a real one
    // has a real MAC, and publishes on the DEVICE topic. It does not know
    // which machine it is on — the server resolves that from the
    // assignment table, which is the whole point of the new firmware.
    const mac = `aacf12${spec.id.toLowerCase().padStart(6, '0')}`;
    seeDevice(mac);
    if (!deviceFor(mac)?.machine_id) {
      // Simulators represent sensors somebody already paired. A REAL new
      // sensor is never auto-assigned — it waits on the Sensors page.
      assignDevice(mac, spec.id, 'simulated sensor, auto-paired at startup');
      log(`${spec.id} simulated sensor ${mac} auto-paired`);
    }

    const topic = MQTT.deviceTopicFor(mac);
    const client = mqtt.connect(`mqtt://127.0.0.1:${MQTT.port}`, {
      clientId: `AtomS3-${mac}`,
      ...deviceCredentials(),
    });

    // Network reality, per device: it drops off Wi-Fi and it reboots.
    // The machine keeps producing through both, and the device keeps
    // counting in RAM through the first — which is exactly the case
    // the ingest guards exist for.
    let offlineUntil = 0;

    client.on('connect', () => {
      log(`${spec.id} publishing to ${topic}`);
      // The device's own loop is a 100ms sleep; match it.
      setInterval(() => {
        const now = Date.now();

        if (NETWORK.enabled && now > offlineUntil) {
          // chance-per-second, evaluated 10x a second
          if (Math.random() < NETWORK.dropoutChance / 10) {
            const secs = NETWORK.dropoutSec[0] + Math.random() * (NETWORK.dropoutSec[1] - NETWORK.dropoutSec[0]);
            offlineUntil = now + secs * 1000;
            log(`${spec.id} lost the network for ${Math.round(secs)}s (still counting)`);
          } else if (Math.random() < NETWORK.rebootChance / 10) {
            dev.reboot();
            offlineUntil = now + 8000;
            log(`${spec.id} power-cycled — counter back to zero, relearning`);
          }
        }

        for (let i = 0; i < SPEED; i++) {
          const payload = dev.sample();
          // While offline the device still runs and still counts; it
          // simply cannot publish. Nothing is queued — the real one
          // does not queue either.
          if (payload && now > offlineUntil) {
            // The new firmware reports WHO IT IS, not what machine it is
            // on. Strip the machine fields so the simulator cannot
            // accidentally prove a path the real device does not use.
            const { machine_id, machine_name, ...rest } = payload;
            client.publish(topic, JSON.stringify({ ...rest, device_id: mac }));
          }
        }
      }, 100);
    });
  }
  log(`firmware: MOVE_DELTA_MM=${FIRMWARE.MOVE_DELTA_MM}  CYCLE_DELAY=${FIRMWARE.CYCLE_DELAY_SECONDS}s  DOWNTIME=${FIRMWARE.DOWNTIME_SECONDS}s`);
  if (SPEED > 1) log(`speed x${SPEED}`);
}

log(`security: ${isLocked() ? 'credentials required (' + secretsSource() + ')' : 'OPEN — fine on a private LAN, never on a public IP'}`);
console.log('  ' + '-'.repeat(46));
console.log(`\n  Dashboard   http://localhost:${WEB.port}`);
console.log(`  Broker      ${EXTERNAL ? MQTT.externalUrl + '  (existing, not ours)' : 'mqtt://<this-machine-ip>:' + MQTT.port}`);
console.log(`  Topic       ${MQTT.deviceWildcard}\n`);
