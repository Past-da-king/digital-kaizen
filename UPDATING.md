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
| Log | `data/digital-kaizen.log` | Windows scheduled task output (on Linux: `sudo journalctl -u digital-kaizen`) |

`data/` and `.env` are never in git and an update never overwrites them. **To copy the data by hand, stop the app first** (the database also has `-wal` and `-shm` files while it runs, and a copy of only `kaizen.db` can miss the latest rows). Copy the whole `data` folder, including `keystore.key`, and `.env`.

**Never run `npm run reset` or `npm run seed` against the factory data.** `reset` (`scripts/reset-db.js`) deletes shots, events, downtime, logs, issues and the mail queue at once, with no question. They are demo tools.

## 2. The upgrade, step by step

1. **Tell the factory** (a minute of downtime for the restart; sensors keep counting on their own and the app reconstructs shots after).
2. **Copy `data/` and `.env`** somewhere else (USB stick), with the app stopped (see section 1). This is your own insurance on top of the automatic backup. Note which version you are on now (`version` in `package.json`, or `git describe --tags`): a rollback needs it.
3. **Get the new code** (the app can stay running for this step; the new code only takes effect at the restart): `git pull` then `npm install --omit=dev`, or unzip the offline release over the old folder (it keeps `data/` and `.env`; the zip holds one folder called `digital-kaizen`, so its **contents** go over the app folder, not a second folder inside it).
4. **Dry run on a copy**: `node scripts/upgrade.js --check`. It copies the database to a temp file, upgrades the copy, and prints the row count of every table before and after. It must end with `OK: every existing row is still there`. If it does not, stop and ask for help. (Run it from the app folder, with `.env` there; it reads the real database but only writes to a temporary copy.)
5. **Restart the app** (Task Scheduler > Digital Kaizen > End, then Run; or `sudo systemctl restart digital-kaizen`). On start it takes the safety backup, migrates, checks nothing was lost, then serves.
6. **Check**: open the dashboard and sign in, `node scripts/upgrade.js --backups` shows the backup that was made, and the Live floor shows the machines. **If nobody has made an admin yet** (the page asks for the old shared password, or opens without asking), do README Step 6 now: `npm run admin -- "Name" email`. Until then the dashboard has no personal sign-in.

### What the upgrade does for you (and the rules it follows)

- **Migrations only add** (new tables, new columns). Nothing is dropped or renamed. Each runs in a transaction and is safe to run twice. They are listed in `src/migrate.js` with a version number.
- **A full backup is taken first** (`VACUUM INTO`, safe while the database is live), with the key and secrets files and a manifest of row counts. If the backup cannot be made the app **refuses to start** and changes nothing.
- **A row-count check runs afterwards.** If any table has fewer rows the app stops with a loud message.
- A failing migration is rolled back completely.

### Rollback

1. **Stop the app** (Task Scheduler > Digital Kaizen > End; or `sudo systemctl stop digital-kaizen`).
2. `node scripts/upgrade.js --backups` lists the backups, with the version each came from. Then `node scripts/rollback.js latest` (or `node scripts/rollback.js <backup folder name>`).
3. It moves the current database to `data/rolled-back/<time>/` (nothing is deleted, so work logged since the upgrade is kept), copies the backup into place, and prints the row counts. It must end with `OK`.
4. Start the **previous version** of the app against it: `git checkout <the version you were on, for example v1.3.1>` and `npm install --omit=dev`, or unzip the old release zip. The backup is exactly the pre-upgrade file, so the old version opens it as it always did. Then restart the app. (`git checkout main` and `npm install --omit=dev` returns to the newest code.)
5. Everything that was entered **after** the upgrade is not in the restored database: shots, logs, and also any people made on the People page since. Make those people again (README Step 6 and the People section) and, if it matters, read the old rows from `data/rolled-back/<time>/kaizen.db`.
6. To go forward again later, upgrade again from section 2.

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
| `DK_ALERT_SCALE`, `DK_NETFAIL`, `DK_SPEED`, `DK_NO_SIM`, `DK_MQTT_HOST`, `DK_MQTT_PORT`, `DK_FIRMWARE` | Demo and simulation only. Never on the factory server |

`npm start`, `npm run setup`, `npm run check`, `npm run admin` and `npm run reset` read `.env`. **`npm run demo` does not**, and neither does a plain `node scripts/upgrade.js` or `node scripts/rollback.js` (they find the database from the folder, or from `DK_DB`).

### Accounts and 2-step
- **Until the first account exists the dashboard has no personal sign-in.** With `data/secrets.json` (made by `npm run setup`) it asks for the one shared password; without that file (the demo) it is open. Making the first admin switches accounts on at once, with no restart, and retires the shared password. An update never makes the dashboard demand an account by itself, on purpose, so a factory that upgrades is never locked out.
- First admin: `npm run admin -- "Name" email` (README Step 6). It prints a one-time link (72 hours, works once). The person chooses a password (10+ characters), scans a QR code into an authenticator app, types the 6 digits, and saves 10 recovery codes shown once. If the printed link has the wrong address (the PC has several network cards), keep the part from `/invite.html` and use the address people really use, or set `DK_BASE_URL` in `.env` first.
- Two-step (6-digit code or a recovery code) is compulsory for admin, manager and viewer. Operators (names on the QR page) have no account.
- More people: People page, **Add a person**, role admin, manager or viewer; the one-time link is shown (and emailed if you tick the box and mail is set up). More admins from the command line: `npm run admin -- "Name" email admin` (the third word picks admin, manager or viewer; default admin).
- Passwords are stored as scrypt hashes; 2-step secrets are encrypted with `data/keystore.key`. 5 wrong passwords lock an account for 15 minutes (People > Unlock); 20 bad attempts from one address in 15 minutes are refused.
- **Rotate a person's password or lost phone (reset their 2-step):** People > Reset (new one-time link; the old password and authenticator stop working at once and they are signed out). The same link makes them pick a new password and scan a new QR code.
- **The only admin lost phone and recovery codes:** there is no command to reset an existing account. Make a second admin with a different email (`npm run admin -- "Name" other@email`), finish its link, sign in, then People > Reset on the first.
- **Rotate a machine's QR code** (a sticker was lost or photographed): Labels > Retire this label, print the new one.
- **Rotate `keystore.key`** is not a routine job. Deleting it invalidates all 2-step enrolments and all QR labels. If it must be done: stop the app, move the file away, start, then reset every person on the People page and reprint the labels.

### How to test email WITHOUT spamming managers

1. **Test the account only:** Settings > Email > type your OWN address in "send a test to" > Save and send test. This sends one message to that address and nothing else. It never touches the ladder.
2. **Rehearse the whole ladder, sending nothing outside:** on a **separate test copy of the app** (the demo, see README "Try it without a factory"; not the live install, because while the mail server points at the sink, real escalations would be caught there and never reach the managers), run `npm install` (dev packages), `npm run mail-sink`, then set the mail server to `127.0.0.1`, port `1025`, Security None. Read what would have been sent at `http://localhost:8025`.
3. **Rehearse with real delivery but only to yourself:** on a test copy, edit the ladder so every level is your own address, and use the demo's "Stop MA2" or a lowered limit. (Never on the live install, so managers never see a test.)
4. Switch the whole ladder off with **Escalation emails on** (Settings) when needed; issues are still recorded.
5. The Escalations page shows every email, its status and the last error.

## 4. Release steps (for the person who ships the next version)

1. Work on a branch; `AGENTS.md` lists the rules. This repo releases from `main`.
2. `npm test` (that is `node --test` then `node scripts/verify-guards.js`) must pass. Run the two commands directly with node if `npm` is not usable in your shell.
3. If you changed the database: add a **new migration at the end of `MIGRATIONS` in `src/migrate.js`** (never edit an old one), and extend `test/migrate.test.js`. Run `node scripts/upgrade.js --check` against a copy of a real database.
4. Run the browser end-to-end against the simulated factory and the mail sink (the header of `scripts/e2e-browser.mjs`, and `AGENTS.md`, say how; it needs a Chrome or Edge and `playwright-core`, which are not in `package.json`). All checks must pass; read the screenshots.
5. Bump `version` in `package.json` and `APP_VERSION` in `src/migrate.js`. Write `UPDATE-vX.Y.md` (what is new, how to install **including making the first admin if there is none**, what to check). Keep `README.md`, `UPDATING.md`, `UPDATE-vX.Y.md`, `AGENTS.md` and `CLAUDE.md` agreeing with each other and with the code.
6. Merge to `main`, `git tag -a vX.Y.Z`, push both.
7. Build the offline zip from a clean checkout of that tag: `bash scripts/make-release.sh X.Y.Z` (makes `digital-kaizen-X.Y.Z-offline.zip`; needs `python3`, `tar` and a working `npm prune`, so use a native Node and npm, not a Windows npm over a WSL path).
8. Create the GitHub release as a **draft**: `gh release create vX.Y.Z --draft --notes-file UPDATE-vX.Y.md digital-kaizen-X.Y.Z-offline.zip#digital-kaizen-offline.zip`. The owner publishes it. Until it is published, the README's "newest release" link still shows the previous version.
9. After installing on the factory PC, run the checks in section 2 step 6.
10. Documentation-only fixes after a tag go to `main` as a normal commit; they do not move the tag or the release.
