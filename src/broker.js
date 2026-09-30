// ============================================================
// The MQTT broker, in-process.
//
// This is the ONE endpoint the real hardware has to reach. A real
// AtomS3 flashed with the existing program, pointed at this
// machine's LAN IP on port 1883, joins the running system with no
// code change at all — the simulated devices and the real ones sit
// on the same topics and the dashboard cannot tell them apart.
// ============================================================

import Aedes from 'aedes';
import { createServer } from 'node:net';
import { MQTT } from './config.js';
import { checkDevice, isLocked } from './auth.js';

export function startBroker({ onLog = () => {} } = {}) {
  const aedes = new Aedes();

  // Without this the broker accepts anyone. On a LAN that is a
  // reasonable default; on a public IP it means a stranger can inject
  // production figures into the client's database.
  aedes.authenticate = (client, username, password, cb) => {
    const ok = checkDevice(username, password?.toString());
    if (!ok) {
      onLog(`REJECTED device "${client?.id}" — bad credentials`);
      const err = new Error('bad username or password');
      err.returnCode = 4;
      return cb(err, false);
    }
    cb(null, true);
  };

  const server = createServer(aedes.handle);

  aedes.on('client', (c) => onLog(`connected: ${c.id}`));
  aedes.on('clientDisconnect', (c) => onLog(`disconnected: ${c.id}`));
  aedes.on('clientError', (c, e) => onLog(`error ${c?.id}: ${e.message}`));

  return new Promise((resolve) => {
    server.listen(MQTT.port, MQTT.host, () => {
      onLog(`broker listening on ${MQTT.host}:${MQTT.port}${isLocked() ? ' (credentials required)' : ' (OPEN — no credentials)'}`);
      resolve({ aedes, server });
    });
  });
}
