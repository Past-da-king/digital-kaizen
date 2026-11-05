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
6. **Make the first admin, if nobody has yet.** If the page still asks for the old shared dashboard password (or opens without asking), there is no account: the dashboard has no personal sign-in until you make one. In the app folder: `npm run admin -- "Your Name" you@evernu.co.za`. It prints a one-time link (works once, 72 hours; if it starts with a wrong address, keep the part from `/invite.html` and use `http://192.120.0.7:4310` in front). Open it and you see, in turn: choose a password (10+ characters); scan a QR code into an authenticator app on a phone; type the 6 digits; save the 10 recovery codes (shown only once). From then on everyone must sign in with email, password and a 6-digit code, and the old shared password stops working at once, with no restart. Add more people on the **People** page (each gets a one-time link); **Reset** there gives a new link to someone who lost their phone. If you already have an admin from 1.3, skip this step. The full walk-through is README Step 6 and the People section.

### If anything looks wrong: roll back (about 2 minutes)

1. Stop the app (Task Scheduler > Digital Kaizen > End; or `sudo systemctl stop digital-kaizen`).
2. `node scripts/rollback.js latest` (it must end with `OK`).
3. Start the previous version: `git checkout <the version you were on, for example v1.2.0>` and `npm install --omit=dev`, or unzip the old release zip, then restart the app. Your old data is back exactly as it was; anything logged since the upgrade is kept in `data/rolled-back/`. People made on the People page since the upgrade are not in the restored data: make them again.

## 3. Email and the other settings

Unchanged from 1.3: **Settings > Email** (the factory's own mail server, or a Gmail address with an app password), **Settings > Escalation ladder** (people, levels, minutes; the five Evernu addresses are only a starting example), and the limits, reasons, defect types, moulds and operator names. The full list of every setting, key and credential, where each is kept, how to rotate them, and how to test email without messaging managers is in `UPDATING.md` section 3.

**Nobody is emailed until the mail account is set up.** To test the account, type your own address in "send a test to this address" and press **Save and send test**: one message to you, nobody else. To rehearse the whole ladder without sending anything, do it on a separate test copy (not the live install): `npm run mail-sink`, point its mail server at `127.0.0.1` port `1025` with Security None, and read what would have been sent at `http://localhost:8025`.

## 4. First start checklist

- The dashboard asks you to sign in with email, password and a 6-digit code (not the old shared password).
- Live floor shows both machines as tiles; a stopped machine shows DOWN and, once past the limit, which level has been told.
- Machines page: the state timeline fills across the shift.
- Quality and OEE: the 14-day OEE comes from the existing shot history.
- Labels: the QR codes are unchanged (printed stickers keep working).
- Settings > Moulds: enter the real ideal cycle time and cavities (the starting values are placeholders, so OEE Performance is only indicative until you do).

## 5. How it was tested (no factory access)

Unit tests (44, including the upgrade, backup, rollback and failure cases), the 9 sensor-guard checks, and a browser end-to-end run against simulated machines with a local test mail server: sign-in with 2-step, QR logging with a photo, a simulated stop that climbed the escalation ladder, acknowledge, and a screenshot of every page at 1920 and 390 in dark and light, compared with the approved mock-ups. Results: `docs/e2e-results.json`.
