// ============================================================
// A virtual AtomS3 + TOF4M bolted to a virtual machine.
//
//   VirtualMachine  ->  sensor noise/dropouts  ->  DeviceFirmware
//
// Run it at real speed for the live dashboard, or at 500x to
// generate a week of history in a few seconds. The firmware never
// knows the difference — it only ever sees (distance, timestamp).
// ============================================================

import { VirtualMachine } from './machine.js';
import { DeviceFirmware } from './firmware.js';
import { SENSOR } from '../config.js';

export class VirtualDevice {
  constructor(spec, { startMs = 0, tunables = {} } = {}) {
    this.spec = spec;
    this.tunables = tunables;
    this.machine = new VirtualMachine(spec, startMs);
    this.firmware = new DeviceFirmware({
      machineId: spec.id,
      machineName: spec.name,
      nowMs: startMs,
      tunables,
    });
    this.t = startMs;
    this.sampleMs = 1000 / SENSOR.sampleHz;
    this.dropouts = 0;
  }

  // Advance one sensor sample. Returns a payload or null.
  sample() {
    const trueMm = this.machine.step(this.sampleMs);
    this.t = this.machine.t;

    if (Math.random() < SENSOR.dropoutChance) {
      this.dropouts++;
      return this.firmware.tick(0, this.t);          // invalid: firmware rejects it
    }
    const noisy = trueMm + (Math.random() * 2 - 1) * SENSOR.noiseMm;
    return this.firmware.tick(noisy, this.t);
  }

  // The device loses power. Its shot counter lives in RAM, so it
  // restarts at zero and has to learn the stroke all over again —
  // exactly what happens after a plant power dip.
  reboot() {
    this.firmware = new DeviceFirmware({
      machineId: this.spec.id,
      machineName: this.spec.name,
      nowMs: this.t,
      tunables: this.tunables,
    });
    this.reboots = (this.reboots || 0) + 1;
  }

  get truth() {
    return {
      shotsProduced: this.machine.shotsProduced,
      shotsCounted: this.firmware.shotCount,
      phase: this.machine.phase,
      stoppedReason: this.machine.stoppedReason,
      trueDistance: Math.round(this.machine._distance()),
    };
  }
}
