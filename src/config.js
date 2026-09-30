// ============================================================
// Digital Kaizen — single source of truth for every tunable.
//
// The FIRMWARE block mirrors the constants in the real AtomS3
// program (Updated_program.m5f2) one for one. Tune them here
// against the simulator, then copy the winning numbers into the
// UIFlow2 file. That is the whole point of this project.
// ============================================================

import { fileURLToPath } from 'node:url';

// Everything the sensors publish sits under this one root. It has to
// match the MQTT_TOPIC in the sensor file exactly.
const TOPIC_ROOT = process.env.DK_TOPIC_ROOT || 'factory-demo-9f7c2a61';

export const MQTT = {
  // ON-SITE MODE. When the factory already runs a broker (Mosquitto)
  // that the sensors publish to, set DK_BROKER_URL and this app only
  // LISTENS on it: no broker is started here, no simulator runs, and
  // nothing is ever published. The sensors and the existing flows are
  // left exactly as they are.
  externalUrl: process.env.DK_BROKER_URL || '',
  externalUser: process.env.DK_BROKER_USER || '',
  externalPass: process.env.DK_BROKER_PASS || '',

  // The broker this project runs when DK_BROKER_URL is not set. Point
  // the real AtomS3 at this machine's LAN IP and nothing else in the
  // device changes.
  host: process.env.DK_MQTT_HOST || '0.0.0.0',
  port: Number(process.env.DK_MQTT_PORT || 1883),
  // Exactly the topic the real device publishes on.
  // LEGACY: the machine knows its own name. Still supported so any
  // sensor already flashed with a machine-specific file keeps working.
  topicFor: (id) => `${TOPIC_ROOT}/machines/${id}/data`,
  wildcard: `${TOPIC_ROOT}/machines/+/data`,

  // CURRENT: the sensor only knows its own MAC address. Which machine
  // it is bolted to is decided in the app, so every sensor runs the
  // SAME firmware and moving one is a dropdown, not a USB cable.
  deviceTopicFor: (mac) => `${TOPIC_ROOT}/devices/${mac}/data`,
  deviceWildcard: `${TOPIC_ROOT}/devices/+/data`,
};

export const WEB = {
  port: Number(process.env.DK_WEB_PORT || 4310),
};

export const DB = {
  // fileURLToPath, not .pathname: on Windows .pathname gives "/C:/...",
  // which is not a path the file system accepts.
  file: process.env.DK_DB || fileURLToPath(new URL('../data/kaizen.db', import.meta.url)),
};

// ------------------------------------------------------------
// FIRMWARE CONSTANTS — keep in lockstep with the .m5f2
// ------------------------------------------------------------
const AS_SHIPPED = process.env.DK_FIRMWARE === 'asshipped';

export const FIRMWARE = {
  MOVEMENTS_TO_LEARN: 5,

  // ⚠ THE DEVICE SHIPS 50 AND THAT VALUE DOES NOT WORK ON A REAL MACHINE.
  // Learning counts a "movement" only when two consecutive samples differ
  // by more than this. The platen takes ~1.4s to travel 420mm and the loop
  // samples at 10Hz, so a real sample-to-sample step is only ~30mm — under
  // the 50mm bar, so the trend almost never flips and the device sits in
  // LEARNING. It works on a desk because a hand waved past the sensor jumps
  // hundreds of mm between samples.
  //   Proven by scripts/tune-learning.js:
  //     50mm -> never armed in 20 minutes, on either machine
  //     25mm -> armed in ~85s (MA1) / ~57s (MA2)
  // Run with DK_FIRMWARE=asshipped to reproduce the fault.
  MOVE_DELTA_MM: AS_SHIPPED ? 50 : 25,
  MIN_STROKE_RANGE_MM: 200,
  MOVEMENT_ACTIVITY_DELTA_MM: 10,

  // Fraction of the learned stroke used for the two thresholds.
  CLOSED_FRACTION: 0.35,
  OPEN_FRACTION: 0.55,

  // The device ships with DESK-TEST values (10 / 60). These are the
  // real-machine values. A Haitian running a 30s cycle is late at 45s
  // and genuinely stopped after 3 minutes of no platen movement.
  CYCLE_DELAY_SECONDS: Number(process.env.DK_CYCLE_DELAY || (AS_SHIPPED ? 10 : 45)),
  DOWNTIME_SECONDS: Number(process.env.DK_DOWNTIME || (AS_SHIPPED ? 60 : 180)),

  SEND_INTERVAL_MS: 500,
  MAX_VALID_DISTANCE_MM: 4500,
};

// ------------------------------------------------------------
// KAIZEN CLASSIFICATION — identical boundaries to the client's
// History Data Browser flow ("prep SQL" node).
// ------------------------------------------------------------
export const KAIZEN = {
  CYCLE_MAX_SEC: 60,            // <= 60s ....... a normal cycle
  SMALL_STOP_MAX_SEC: 5 * 60,   // <= 5min ...... a small stop
  DOWNTIME_MAX_SEC: 8 * 3600,   // <= 8h ........ down time
  // anything longer ............................ non-scheduled time
};

// ------------------------------------------------------------
// SHIFTS — the device fakes these (a_shift_shots = total,
// b_shift_shots = 0). Here they are real, computed from the
// timestamp of every shot row.
// ------------------------------------------------------------
export const SHIFTS = [
  { name: 'A', startHour: 6, endHour: 18 },
  { name: 'B', startHour: 18, endHour: 6 },
];

export function shiftForDate(d) {
  const h = d.getHours();
  return h >= 6 && h < 18 ? 'A' : 'B';
}

// ------------------------------------------------------------
// THE VIRTUAL FACTORY — two Haitian moulders, matching MA1/MA2.
// Every number here is a property of the MACHINE, not the sensor.
// ------------------------------------------------------------
export const MACHINES = [
  {
    id: 'MA1',
    name: 'Haitian MA1',
    part: '',              // TODO: what does this machine actually make?
    closedMm: 118,          // platen at its closest to the sensor
    openMm: 534,            // platen fully open  (stroke 416mm)
    cycleSec: 28.5,         // nameplate cycle
    cycleJitterPct: 0.06,
    openTravelSec: 1.4,
    closeTravelSec: 1.6,
    ejectDwellSec: 2.6,
    // Reliability profile — how this machine misbehaves.
    slowCycleChance: 0.05,  // cooling overrun
    slowCycleExtraSec: [4, 14],
    smallStopChance: 0.012, // 1–5 min: jam, short shot, operator check
    smallStopSec: [70, 280],
    downtimeChance: 0.0025, // 5–40 min: material change, mould fault
    downtimeSec: [420, 2400],
  },
  {
    id: 'MA2',
    name: 'Haitian MA2',
    part: '',              // TODO: what does this machine actually make?
    closedMm: 96,
    openMm: 448,            // stroke 352mm
    cycleSec: 19.2,
    cycleJitterPct: 0.09,
    openTravelSec: 1.1,
    closeTravelSec: 1.2,
    ejectDwellSec: 1.9,
    slowCycleChance: 0.09,
    slowCycleExtraSec: [3, 11],
    smallStopChance: 0.02,
    smallStopSec: [80, 300],
    downtimeChance: 0.004,
    downtimeSec: [500, 3000],
  },
];

// ------------------------------------------------------------
// DOWNTIME RULES — per machine, because "stopped" means something
// different on a 19s cycle than on a 28s one. These are what turn a
// pause into a formal, attributable, escalating event.
// ------------------------------------------------------------
// PROVISIONAL until the real cycle times are known — these drive the
// downtime thresholds and the lost-parts estimate, so they are the
// first thing to correct once somebody times the machines.
export const DOWNTIME_RULES = {
  MA1: {
    expectedCycleSec: 28,
    microStopSec: 60,      // 0-60s   recorded, not downtime
    downtimeSec: 120,      // >120s   a real downtime event is opened
    criticalSec: 600,      // >10min  critical
  },
  MA2: {
    expectedCycleSec: 19,
    microStopSec: 45,
    downtimeSec: 90,
    criticalSec: 480,
  },
};

// Who gets told, and when. Minutes from the START of the stoppage.
// One message per rung per event — never a message every 30 seconds.
export const ESCALATION = [
  { afterMin: 2,  level: 'event',      to: 'Line operator',       channel: 'screen' },
  { afterMin: 5,  level: 'operator',   to: 'Line operator',       channel: 'email'  },
  { afterMin: 10, level: 'supervisor', to: 'Shift supervisor',    channel: 'email'  },
  { afterMin: 15, level: 'manager',    to: 'Operations manager',  channel: 'email'  },
  { afterMin: 30, level: 'critical',   to: 'Plant management',    channel: 'email'  },
];

// The reasons an operator can pick when they scan the QR code.
// These live HERE, in the app — the sensor knows nothing about them.
// Changing this list changes the buttons on every machine's QR page
// immediately; no device is reflashed and nothing is redeployed.
// `planned` separates downtime the factory CHOSE from downtime it
// SUFFERED, which is the split that matters on an OEE report.
export const STOP_REASONS = [
  { code: 'sched_maint',    label: 'Scheduled maintenance',    icon: '\u{1F6E0}', planned: true  },
  { code: 'unsched_maint',  label: 'Unscheduled maintenance',  icon: '\u{1F527}', planned: false },
  { code: 'sched_mould',    label: 'Scheduled mould change',   icon: '\u{1F504}', planned: true  },
  { code: 'unsched_mould',  label: 'Unscheduled mould change', icon: '\u26A0',    planned: false },
  { code: 'material',       label: 'Material issue',           icon: '\u{1F4E6}', planned: false },
  { code: 'order_complete', label: 'Order complete',           icon: '\u2705',    planned: true  },
];

// How many parts come off ONE shot. A four-cavity mould makes four
// units every time it closes, so "units that could have been made"
// is cycles missed x cavities.
//
// Left at 1 until somebody says otherwise, which makes the dashboard
// under-state rather than invent. Set the real number per machine and
// the figure corrects itself everywhere.
export const CAVITIES = {
  MA1: 1,
  MA2: 1,
};

// ------------------------------------------------------------
// NETWORK REALITY — the factory Wi-Fi is not perfect and the
// device counts in RAM. Modelling this is the whole reason the
// ingest guards can be tested at all: without it, a simulator can
// never surface the failure that will actually bite on the floor.
// ------------------------------------------------------------
export const NETWORK = {
  enabled: process.env.DK_NETFAIL !== '0',
  // Chance PER SECOND that a connected device drops off the network.
  dropoutChance: Number(process.env.DK_NETFAIL_CHANCE || 0.0015),
  dropoutSec: [20, 180],
  // Chance PER SECOND that a device power-cycles. Its shot counter
  // restarts at zero, which is the case that used to fire a false
  // RECOVERED on a machine that was still standing still.
  rebootChance: Number(process.env.DK_REBOOT_CHANCE || 0.0002),
};

// TOF4M sensor behaviour
export const SENSOR = {
  noiseMm: 3,             // ±3mm jitter, like the real ToF
  dropoutChance: 0.0015,  // occasional invalid reading
  sampleHz: 10,
};
