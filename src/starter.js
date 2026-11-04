// ============================================================
// STARTING EXAMPLE ONLY. These rows are copied into the database the
// first time the app runs, so the Settings screen has something to
// edit. Nothing reads this file after that: add, change, reorder or
// remove people and levels on the Settings screen. Leaving the
// ladder empty on a new install would mean nobody is ever told.
// ============================================================

// afterMin = minutes after the issue opens: level 1 at once, then the
// next level every 30 minutes until somebody acknowledges.
export const STARTER_LADDER = [
  { level: 1, afterMin: 0,   people: [{ name: '', role: 'Supervisor',                     email: 'evproductionfloor@gmail.com', enabled: true }] },
  { level: 2, afterMin: 30,  people: [{ name: '', role: 'Toolroom / Maintenance Manager', email: 'mechanical@evernu.co.za',     enabled: true }] },
  { level: 3, afterMin: 60,  people: [{ name: '', role: 'Production Manager',             email: 'production@evernu.co.za',     enabled: true }] },
  { level: 4, afterMin: 90,  people: [{ name: '', role: 'Operations Manager',             email: 'ops@evernu.co.za',            enabled: true }] },
  { level: 5, afterMin: 120, people: [{ name: '', role: 'General Manager',                email: 'gm@evernu.co.za',             enabled: true }] },
];
