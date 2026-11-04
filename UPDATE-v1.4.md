# Digital Kaizen 1.4.0: update handover note

For the factory PC (`192.120.0.7`), which is **already in use**. Nothing in your data is lost by this update: see section 1.
Developers and agents: read `UPDATING.md` and `AGENTS.md` in the repo as well.

## What is new

| New | In one line |
|---|---|
| **A new look** | Left sidebar (a tab bar on a phone). The top of the Live floor is one big tile per machine, filled with its status colour: RUNNING, IDLE, DOWN, in very large type, how long, and who has been told. OEE is the hero number. Light and dark. Readable across the floor. |
| **Machines page** | One machine in depth: state timeline for the shift (running, idle, down, planned), last 60 cycles against the ideal, shots per hour, OEE with Availability, Performance and Quality, mould position, shifts and recent stops. |
| **State timeline** | A strip per machine showing what it did across the shift, built from the sensor records the app already kept. |
| **"Where the time went"** | OEE as a loss waterfall: stops, slow cycles, defects, fully productive. |
| **Safe upgrades** | Versioned migrations that only add, an automatic backup before every upgrade, a row-count check afterwards, a dry run (`node scripts/upgrade.js --check`) and a rollback (`node scripts/rollback.js latest`). |
| Everything from 1.3 | QR defect and downtime logging with names, escalation emails up the ladder, OEE, accounts with 2-step. The "Call a manager" button stays removed: escalations start only from the automatic limits. |

All the content and data of the old pages is still there (shots, cycles, availability, mould position, shifts, stops, history, sensors, labels, logs, exports).

## 1. Your data is safe (and how to prove it on your own PC first)

- The database upgrades by **adding** tables and columns only. Nothing is dropped, renamed or rewritten.
- **Before** anything changes, the app writes a full backup to `data/backups/<time>-before-v1.4.0/` (the database, the secrets and key files, and a count of every table). If the backup cannot be written, the app **does not start** and changes nothing.
- **After** the upgrade it checks no table lost rows. If one did, it stops with a clear message.
- A real v1.2.0 data store (13,180 shots, status events, a downtime event, alerts, paired sensors) was upgraded in testing: every old row identical, the sensors still paired, the history and OEE trend drawn from it, then rolled back and opened by the old v1.2.0 app. The output is in `docs/upgrade-proof.md`.

**Before you install**, see it work on a copy of YOUR data (touches nothing real):

```
node scripts/upgrade.js --check
```

It prints the row count of every table before and after and ends with `OK: every existing row is still there`.

## 2. Install

1. Copy the `data` folder and the `.env` file somewhere safe (USB stick). Your own insurance.
2. **With internet:** in the app folder `git pull` then `npm install --omit=dev`. **Without internet:** unzip `digital-kaizen-1.4.0-offline.zip` over the old folder (`data` and `.env` are kept).
3. Run `node scripts/upgrade.js --check` (above). It must say OK.
4. Restart the app (Task Scheduler > Digital Kaizen > End, then Run; or `sudo systemctl restart digital-kaizen`). The upgrade and the backup happen on this start.
5. Open the dashboard. `node scripts/upgrade.js --backups` lists the backup that was made.

### If anything looks wrong: roll back (about 2 minutes)

1. Stop the app.
2. `node scripts/rollback.js latest`
3. Start the previous version (`git checkout v1.2.0`, or the old release zip). Your old data is back exactly as it was; anything logged since the upgrade is kept in `data/rolled-back/`.

## 3. Email and the other settings

Unchanged from 1.3: **Settings > Email** (the factory's own mail server, or a Gmail address with an app password), **Settings > Escalation ladder** (people, levels, minutes; the five Evernu addresses are only a starting example), and the limits, reasons, defect types, moulds and operator names. The full list of every setting, key and credential, where each is kept, how to rotate them, and how to test email without messaging managers is in `UPDATING.md` section 3.

**Nobody is emailed until the mail account is set up.** To rehearse safely: `npm run mail-sink`, point the mail server at `127.0.0.1` port `1025` with Security None, and read what would have been sent at `http://localhost:8025`.

## 4. First start checklist

- Live floor shows both machines as tiles; a stopped machine shows DOWN and, once past the limit, which level has been told.
- Machines page: the state timeline fills across the shift.
- Quality and OEE: the 14-day OEE comes from the existing shot history.
- Labels: the QR codes are unchanged (printed stickers keep working).
- Settings > Moulds: enter the real ideal cycle time and cavities (the starting values are placeholders, so OEE Performance is only indicative until you do).

## 5. How it was tested (no factory access)

Unit tests (44, including the upgrade, backup, rollback and failure cases), the 9 sensor-guard checks, and a browser end-to-end run against simulated machines with a local test mail server: sign-in with 2-step, QR logging with a photo, a simulated stop that climbed the escalation ladder, acknowledge, and a screenshot of every page at 1920 and 390 in dark and light, compared with the approved mock-ups. Results: `docs/e2e-results.json`.
