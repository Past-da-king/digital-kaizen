// ============================================================
// The virtual injection-moulding machine.
//
// This models the MACHINE, not the sensor and not the firmware.
// Its only output is the one thing a ToF laser can actually see:
// the distance in mm from the fixed platen to the moving platen,
// sampled over time. Everything downstream — learning, shot
// counting, status — has to work it out from this, exactly as it
// does on the real floor.
// ============================================================

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = ([a, b]) => rnd(a, b);

// Smooth S-curve so platen travel accelerates and decelerates
// like real hydraulics rather than teleporting between positions.
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class VirtualMachine {
  constructor(spec, startMs = 0) {
    this.spec = spec;
    this.t = startMs;                 // virtual clock, ms
    this.phase = 'CLOSED_DWELL';      // CLOSED_DWELL | OPENING | OPEN_DWELL | CLOSING | STOPPED
    this.phaseStart = startMs;
    this.events = [];                 // [{at, kind, seconds}] — must exist before _closedDwell()
    this.phaseLen = this._closedDwell();
    this.stoppedReason = null;
    this.shotsProduced = 0;           // ground truth, for scoring the firmware
  }

  // How long the mould stays shut: total cycle minus the moving parts.
  _closedDwell() {
    const s = this.spec;
    const jitter = 1 + rnd(-s.cycleJitterPct, s.cycleJitterPct);
    let cycle = s.cycleSec * jitter;
    if (Math.random() < s.slowCycleChance) {
      const extra = pick(s.slowCycleExtraSec);
      cycle += extra;
      this.events.push({ at: this.t, kind: 'slow-cycle', seconds: extra });
    }
    const moving = s.openTravelSec + s.ejectDwellSec + s.closeTravelSec;
    return Math.max(2, cycle - moving) * 1000;
  }

  _maybeStop() {
    const s = this.spec;
    if (Math.random() < s.downtimeChance) {
      this._enterStop('downtime', pick(s.downtimeSec));
      return true;
    }
    if (Math.random() < s.smallStopChance) {
      this._enterStop('small-stop', pick(s.smallStopSec));
      return true;
    }
    return false;
  }

  _enterStop(kind, seconds) {
    this.phase = 'STOPPED';
    this.stoppedReason = kind;
    this.phaseStart = this.t;
    this.phaseLen = seconds * 1000;
    this.events.push({ at: this.t, kind, seconds: Math.round(seconds) });
  }

  // Advance the machine by dtMs and return the true platen distance.
  step(dtMs) {
    this.t += dtMs;
    const s = this.spec;

    // A single step can be longer than a whole phase when the history
    // seeder runs at speed, so drain phases in a loop rather than one
    // per call — otherwise fast-forward silently loses shots.
    let guard = 0;
    while (this.t - this.phaseStart >= this.phaseLen && guard++ < 10000) {
      const overrun = this.t - this.phaseStart - this.phaseLen;
      switch (this.phase) {
        case 'CLOSED_DWELL':
          // Cooling finished. A stop lands here — mould shut, nothing moving.
          if (!this._maybeStop()) this._advance('OPENING', s.openTravelSec * 1000);
          break;
        case 'OPENING':
          this._advance('OPEN_DWELL', s.ejectDwellSec * 1000);
          break;
        case 'OPEN_DWELL':
          this._advance('CLOSING', s.closeTravelSec * 1000);
          break;
        case 'CLOSING':
          // Mould has just shut again: that is one completed shot.
          this.shotsProduced++;
          this._advance('CLOSED_DWELL', this._closedDwell());
          break;
        case 'STOPPED':
          this.stoppedReason = null;
          this._advance('OPENING', s.openTravelSec * 1000);
          break;
      }
      this.phaseStart = this.t - overrun;
    }
    return this._distance();
  }

  _advance(phase, len) {
    this.phase = phase;
    this.phaseStart = this.t;
    this.phaseLen = len;
  }

  _distance() {
    const s = this.spec;
    const p = Math.min(1, (this.t - this.phaseStart) / this.phaseLen);
    switch (this.phase) {
      case 'OPENING': return s.closedMm + (s.openMm - s.closedMm) * ease(p);
      case 'CLOSING': return s.openMm - (s.openMm - s.closedMm) * ease(p);
      case 'OPEN_DWELL': return s.openMm;
      default: return s.closedMm;   // CLOSED_DWELL and STOPPED
    }
  }

  get isStopped() { return this.phase === 'STOPPED'; }

  // Demo control: stop this machine on command, so a downtime event
  // and its whole escalation ladder can be shown in a meeting rather
  // than waited for.
  forceStop(seconds) { this._enterStop('demo-stop', seconds); }
  forceStart() { if (this.phase === 'STOPPED') { this.stoppedReason = null; this._advance('OPENING', this.spec.openTravelSec * 1000); } }
}
