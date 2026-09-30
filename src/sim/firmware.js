// ============================================================
// Faithful JavaScript port of the AtomS3 program.
//
// Line for line the same algorithm as the MicroPython in
// Updated_program.m5f2 — the learning phase, the CLOSED->OPEN->
// CLOSED shot state machine, the status rules and the exact JSON
// payload. Nothing is "improved" here on purpose: if this port
// miscounts, the real device miscounts, and that is what makes the
// simulator worth running.
//
// The one deliberate difference is that time is INJECTED rather
// than read from a clock, so a week of production can be run
// through it in seconds.
// ============================================================

import { FIRMWARE } from '../config.js';

export class DeviceFirmware {
  constructor({ machineId, machineName, nowMs = 0, tunables = {} }) {
    this.MACHINE_ID = machineId;
    this.MACHINE_NAME = machineName;
    this.simIp = `simulated-${String(machineId).toLowerCase()}`;
    this.k = { ...FIRMWARE, ...tunables };

    // --- learning
    this.learningDone = false;
    this.learnMinMm = null;
    this.learnMaxMm = null;
    this.movementCount = 0;
    this.lastDistanceMm = null;
    this.lastTrend = null;
    this.closedThresholdMm = null;
    this.openThresholdMm = null;
    this.learnFailed = null;       // "Move further apart"

    // --- activity
    this.lastActivityDistanceMm = null;
    this.lastMovementMs = nowMs;

    // --- cycles
    this.shotCount = 0;
    this.lastCycleTimeMs = null;
    this.lastShotMs = nowMs;
    this.cycleState = 'WAIT_CLOSED';
    this.openedSeen = false;
    this.machineStatus = 'LEARNING';
    this.position = 'LEARNING';
    this.lastSendMs = -1e9;

    // --- diagnostics the real device does not keep, but we want
    this.cycleTimesSec = [];
  }

  isValidDistance(mm) {
    return mm !== null && mm !== undefined && mm > 0 && mm <= this.k.MAX_VALID_DISTANCE_MM;
  }

  recordMovement(mm, nowMs) {
    if (this.lastActivityDistanceMm === null) {
      this.lastActivityDistanceMm = mm;
      this.lastMovementMs = nowMs;
      return true;
    }
    if (Math.abs(mm - this.lastActivityDistanceMm) >= this.k.MOVEMENT_ACTIVITY_DELTA_MM) {
      this.lastActivityDistanceMm = mm;
      this.lastMovementMs = nowMs;
      return true;
    }
    return false;
  }

  learnFromDistance(mm, nowMs) {
    if (this.learnMinMm === null || mm < this.learnMinMm) this.learnMinMm = mm;
    if (this.learnMaxMm === null || mm > this.learnMaxMm) this.learnMaxMm = mm;

    if (this.lastDistanceMm !== null) {
      const diff = mm - this.lastDistanceMm;
      let trend;
      if (diff > this.k.MOVE_DELTA_MM) trend = 'FARTHER';
      else if (diff < -this.k.MOVE_DELTA_MM) trend = 'CLOSER';
      else trend = this.lastTrend;

      if (this.lastTrend !== null && trend !== null && trend !== this.lastTrend) {
        this.movementCount++;
      }
      if (trend !== null) this.lastTrend = trend;
    }
    this.lastDistanceMm = mm;

    if (this.movementCount >= this.k.MOVEMENTS_TO_LEARN) {
      const stroke = this.learnMaxMm - this.learnMinMm;
      if (stroke >= this.k.MIN_STROKE_RANGE_MM) {
        this.closedThresholdMm = Math.trunc(this.learnMinMm + stroke * this.k.CLOSED_FRACTION);
        this.openThresholdMm = Math.trunc(this.learnMinMm + stroke * this.k.OPEN_FRACTION);
        this.learningDone = true;
        this.learnFailed = null;
        this.machineStatus = 'RUNNING';
        this.lastShotMs = nowMs;
        this.lastMovementMs = nowMs;
      } else {
        // The real device parks here forever showing "Move further apart".
        this.learnFailed = 'Move further apart';
      }
    }
  }

  getPosition(mm) {
    if (mm <= this.closedThresholdMm) return 'CLOSED';
    if (mm >= this.openThresholdMm) return 'OPEN';
    return 'MOVING';
  }

  countCycle(mm, nowMs) {
    const position = this.getPosition(mm);
    if (this.cycleState === 'WAIT_CLOSED') {
      if (position === 'CLOSED') this.cycleState = 'WAIT_OPEN';
    } else if (this.cycleState === 'WAIT_OPEN') {
      if (position === 'OPEN') { this.openedSeen = true; this.cycleState = 'WAIT_CLOSE'; }
    } else if (this.cycleState === 'WAIT_CLOSE') {
      if (position === 'CLOSED' && this.openedSeen) {
        this.shotCount++;
        this.lastCycleTimeMs = nowMs - this.lastShotMs;
        this.cycleTimesSec.push(this.lastCycleTimeMs / 1000);
        this.lastShotMs = nowMs;
        this.openedSeen = false;
        this.cycleState = 'WAIT_OPEN';
      }
    }
    return position;
  }

  updateStatus(nowMs) {
    const sinceMovement = (nowMs - this.lastMovementMs) / 1000;
    const sinceShot = (nowMs - this.lastShotMs) / 1000;
    if (sinceMovement >= this.k.DOWNTIME_SECONDS) this.machineStatus = 'DOWNTIME';
    else if (sinceShot >= this.k.CYCLE_DELAY_SECONDS) this.machineStatus = 'CYCLE DELAY';
    else this.machineStatus = 'RUNNING';
  }

  // Feed one sensor sample. Returns a payload when the device would
  // have published one (every SEND_INTERVAL_MS), otherwise null.
  tick(distanceMm, nowMs) {
    if (!this.isValidDistance(distanceMm)) return null;   // "Sensor fault"
    const mm = Math.round(distanceMm);

    this.recordMovement(mm, nowMs);

    if (!this.learningDone) {
      this.learnFromDistance(mm, nowMs);
      this.position = 'LEARNING';
      // The device publishes during learning too, so Node-RED
      // connectivity can be proven before the machine is armed.
      return this._maybeSend(mm, 'LEARNING', nowMs);
    }

    this.position = this.countCycle(mm, nowMs);
    this.updateStatus(nowMs);
    return this._maybeSend(mm, this.position, nowMs);
  }

  _maybeSend(mm, position, nowMs) {
    if (nowMs - this.lastSendMs < this.k.SEND_INTERVAL_MS) return null;
    this.lastSendMs = nowMs;
    return this.buildData(mm, position, nowMs);
  }

  // The EXACT payload shape the real device publishes.
  buildData(distanceMm, position, nowMs) {
    const cycleSec = this.lastCycleTimeMs !== null
      ? Math.round((this.lastCycleTimeMs / 1000) * 10) / 10
      : 0;

    const noCycleSeconds = Math.trunc((nowMs - this.lastShotMs) / 1000);
    const noMovementSeconds = Math.trunc((nowMs - this.lastMovementMs) / 1000);
    const downtimeSeconds = this.machineStatus === 'DOWNTIME' ? noMovementSeconds : 0;
    // Quantised to 30s so the dashboard number does not flicker.
    const displayDowntime = Math.trunc(downtimeSeconds / 30) * 30;

    return {
      machine_id: this.MACHINE_ID,
      machine_name: this.MACHINE_NAME,
      status: this.machineStatus,
      position,
      distance_mm: distanceMm,
      shots: this.shotCount,
      total_shots: this.shotCount,
      last_cycle_sec: cycleSec,
      no_cycle_minutes: Math.round((noCycleSeconds / 60) * 10) / 10,
      no_movement_seconds: noMovementSeconds,
      no_movement_minutes: Math.round((noMovementSeconds / 60) * 10) / 10,
      downtime_seconds_exact: downtimeSeconds,
      downtime_seconds_display: displayDowntime,
      downtime_minutes: Math.round((displayDowntime / 60) * 10) / 10,
      total_downtime: Math.round((displayDowntime / 60) * 10) / 10,

      // --- these four are FAKE on the real device. Kept in the payload
      // so the wire format matches exactly, but the dashboard ignores
      // them and computes the truth from the database instead.
      hour_interval: 'Live',
      hour_shots: this.shotCount,
      a_shift_shots: this.shotCount,
      b_shift_shots: 0,
      a_shift_downtime: Math.round((displayDowntime / 60) * 10) / 10,
      b_shift_downtime: 0,

      // The real device sends its actual wifi_ip here. A simulated one
      // has no IP, so it sends a per-machine placeholder rather than
      // one shared hardcoded address that reads as real.
      device_ip: this.simIp,

      // --- simulator-only additions, prefixed so they can never be
      // confused with device fields.
      sim_learned_min: this.learnMinMm,
      sim_learned_max: this.learnMaxMm,
      sim_closed_threshold: this.closedThresholdMm,
      sim_open_threshold: this.openThresholdMm,
      sim_learn_progress: this.movementCount,
      sim_learn_failed: this.learnFailed,
    };
  }
}
