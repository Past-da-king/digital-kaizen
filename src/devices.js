// A tiny registry so the demo controls on the dashboard can reach
// the running virtual machines. Empty when DK_NO_SIM=1 — the demo
// buttons simply do nothing against real hardware, which is correct.
const devices = new Map();
export function registerDevice(id, dev) { devices.set(id, dev); }
export function getDevice(id) { return devices.get(id) || null; }
export function hasDevices() { return devices.size > 0; }
