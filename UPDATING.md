# Updating Digital Kaizen safely

This app is **running a factory**. The database holds months of sensor history, the operators' logs, the escalation ladder,
the mail account and the user accounts. An update must never lose any of it. This page is for whoever updates it next:
a person, or a coding agent (Claude or another). Read it fully before touching a live install. `AGENTS.md` has the rules for changing the code.

## 1. Where everything lives

On the factory PC (`192.120.0.7`), in the app folder (for example `C:\digital-kaizen`):

| What | Where | Matters because |
|---|---|---|
| Database | `data/kaizen.db` (plus `-wal` and `-shm` files while running) | Everything: shots, stops, logs, issues, mail queue, settings, accounts |
| Photos | `data/photos/` | Defect photos from the QR page |
| Dashboard secrets | `data/secrets.json` | Made by `npm run setup`: broker password for the built-in broker, old shared password |
| Key file | `data/keystore.key` | Seals every 2-step secret and makes each machine's QR token. **Lose it and every authenticator enrolment and every printed QR label stops working.** Back it up |
| Settings | `.env` (app folder) | Sensor broker address and login, topic, port. Mail is NOT here, it is in the database (Settings screen) |
| Backups | `data/backups/<time>-before-v<version>/` | Taken automatically before any upgrade |
| Rolled-back data | `data/rolled-back/<time>/` | What was in place when a rollback happened |
| Log | `data/digital-kaizen.log` | Windows scheduled task output |

`data/` and `.env` are never in git and an update never overwrites them.

## 2. The upgrade, step by step

1. **Tell the factory** (a minute of downtime for the restart; sensors keep counting on their own and the app reconstructs shots after).
2. **Copy `data/` and `.env`** somewhere else (USB stick). This is your own insurance on top of the automatic backup.
3. **Get the new code**: `git pull` then `npm install --omit=dev`, or unzip the offline release over the old folder (it keeps `data/` and `.env`).
4. **Dry run on a copy**: `node scripts/upgrade.js --check`. It copies the database to a temp file, upgrades the copy, and prints the row count of every table before and after. It must end with `OK: every existing row is still there`. If it does not, stop and ask for help.
5. **Restart the app** (Task Scheduler > Digital Kaizen > End, then Run; or `sudo systemctl restart digital-kaizen`). On start it takes the safety backup, migrates, checks nothing was lost, then serves.
6. **Check**: open the dashboard, `node scripts/upgrade.js --backups` shows the backup that was made, and the Live floor shows the machines.

### What the upgrade does for you (and the rules it follows)

- **Migrations only add** (new tables, new columns). Nothing is dropped or renamed. Each runs in a transaction and is safe to run twice. They are listed in `src/migrate.js` with a version number.
- **A full backup is taken first** (`VACUUM INTO`, safe while the database is live), with the key and secrets files and a manifest of row counts. If the backup cannot be made the app **refuses to start** and changes nothing.
- **A row-count check runs afterwards.** If any table has fewer rows the app stops with a loud message.
- A failing migration is rolled back completely.

### Rollback

1. **Stop the app.**
2. `node scripts/rollback.js latest` (or `node scripts/rollback.js <backup folder name>`).
3. It moves the current database to `data/rolled-back/<time>/` (nothing is deleted, so work logged since the upgrade is kept), copies the backup into place, and prints the row counts.
4. Start the **previous version** of the app (`git checkout v1.2.0`, or the old release zip) against it. The backup is exactly the pre-upgrade file, so the old version opens it as it always did.
5. To go forward again later, upgrade again. Rows logged between the upgrade and the rollback are in `data/rolled-back/<time>/kaizen.db` if anyone needs them.

## 3. CONFIGURATION: every setting, key and credential

**Rule: no secret is ever in code or in git.** Secrets live in the Settings screen (stored in the database) or in `.env` / `data/`, which are not committed.

### Email (escalation mail): Settings > Email

| Field | Meaning |
|---|---|
| Mail server, Port, Security | The factory's mail server, or `smtp.gmail.com`, 587, STARTTLS (or 465, SSL). Internal server without encryption: Security = None |
| Login, Password | The mailbox. For Gmail this is an **app password** (Google Account > Security > 2-Step Verification > App passwords), never the account password |
| Send from | The From address. Gmail only sends as the account or its aliases |
| Accept a self-signed certificate | For an internal server with its own certificate |

Stored in the `settings` table (key `smtp`). The password is never sent back to the browser (the screen shows "saved, leave blank to keep"). Old installs that set `DK_SMTP_HOST`, `DK_SMTP_PORT`, `DK_SMTP_USER`, `DK_SMTP_PASS`, `DK_MAIL_FROM` in `.env` still work: they are used **only** while nothing has been saved on the screen.

**Rotate the mail password:** make a new app password (or reset the mailbox password) > Settings > Email > type it in the Password box > **Save and send test** > revoke the old one at the provider. Takes effect immediately, no restart.

### The escalation ladder: Settings > Escalation ladder
People, roles, emails and minutes per level, in the database. The five Evernu addresses are only a starting example (`src/starter.js`). **Never edit the addresses in code.**

### Other settings in the database (Settings screen)
Limits (machine down minutes, defects per shift), downtime reasons, defect types, moulds and ideal cycle times, operator names and optional PINs, the dashboard address (`baseUrl`), machine QR epochs.

### `.env` (app folder; read at start, restart after editing)

| Key | Meaning |
|---|---|
| `DK_BROKER_URL`, `DK_BROKER_USER`, `DK_BROKER_PASS` | The sensors' MQTT broker (the factory's Mosquitto) and its login. These are the sensors' credentials, copy from the sensor file |
| `DK_TOPIC_ROOT` | First part of the sensors' topic |
| `DK_WEB_PORT` | Dashboard port, default 4310 |
| `DK_BASE_URL` | Optional starting value for the address in emails and QR codes (the Settings screen wins) |
| `DK_DB`, `DK_PHOTOS`, `DK_KEYFILE`, `DK_SECRETS` | Move the data files (tests use these) |
| `DK_QUIET=1` | Silence migration log lines |
| `DK_ALERT_SCALE`, `DK_NETFAIL`, `DK_SPEED`, `DK_NO_SIM` | Demo and simulation only. Never on the factory server |

### Accounts and 2-step
- First admin: `npm run admin -- "Name" email`. More people: People page (one-time link, 72 hours).
- Passwords are stored as scrypt hashes; 2-step secrets are encrypted with `data/keystore.key`.
- **Rotate a person's password or lost phone:** People > Reset (new one-time link; the old password and authenticator stop working at once).
- **Rotate a machine's QR code** (a sticker was lost or photographed): Labels > Retire this label, print the new one.
- **Rotate `keystore.key`** is not a routine job. Deleting it invalidates all 2-step enrolments and all QR labels. If it must be done: stop the app, move the file away, start, then reset every person on the People page and reprint the labels.

### How to test email WITHOUT spamming managers

1. **Test the account only:** Settings > Email > type your OWN address in "send a test to" > Save and send test. This sends one message to that address and nothing else. It never touches the ladder.
2. **Rehearse the whole ladder on the PC, sending nothing outside:** `npm install` (dev packages), `npm run mail-sink`, then set the mail server to `127.0.0.1`, port `1025`, Security None. Read what would have been sent at `http://localhost:8025`. Put the settings back afterwards.
3. **Rehearse with real delivery but only to yourself:** temporarily edit the ladder so every level is your own address, and use the demo's "Stop MA2" or a lowered limit. Then restore the real ladder. (Do this on a test copy of the app, not on the live install, so managers never see a test.)
4. Switch the whole ladder off with **Escalation emails on** (Settings) when needed; issues are still recorded.
5. The Escalations page shows every email, its status and the last error.

## 4. Release steps (for the person who ships the next version)

1. Work on a branch; `AGENTS.md` lists the rules.
2. `node --test` (all tests) and `node scripts/verify-guards.js` must pass.
3. If you changed the database: add a **new migration at the end of `MIGRATIONS` in `src/migrate.js`** (never edit an old one), and extend `test/migrate.test.js`. Run `node scripts/upgrade.js --check` against a copy of a real database.
4. Run the browser end-to-end against the simulated factory and the mail sink (the header of `scripts/e2e-browser.mjs` says how). All checks must pass; read the screenshots.
5. Bump `version` in `package.json` and `APP_VERSION` in `src/migrate.js`. Write `UPDATE-vX.Y.md` (what is new, how to install, what to check).
6. Merge to `main`, `git tag -a vX.Y.Z`, push both.
7. Build the offline zip: `bash scripts/make-release.sh X.Y.Z` (makes `digital-kaizen-X.Y.Z-offline.zip`).
8. Create the GitHub release as a **draft**: `gh release create vX.Y.Z --draft --notes-file UPDATE-vX.Y.md digital-kaizen-X.Y.Z-offline.zip#digital-kaizen-offline.zip`. The owner publishes it.
9. After installing on the factory PC, run the checks in section 2 step 6.
