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
| Settings | `.env` (app folder) | Sensor broker settings and, if used, the Resend API key and From address. Legacy SMTP settings are in the database |
| Backups | `data/backups/<time>-before-v<version>/` | Taken automatically before any upgrade |
| Rolled-back data | `data/rolled-back/<time>/` | What was in place when a rollback happened |
| Log | `data/digital-kaizen.log` | Windows scheduled task output (on Linux: `sudo journalctl -u digital-kaizen`) |

`data/` and `.env` are never in git and an update never overwrites them. **To copy the data by hand, stop the app first** (the database also has `-wal` and `-shm` files while it runs, and a copy of only `kaizen.db` can miss the latest rows). Copy the whole `data` folder, including `keystore.key`, and `.env`.

**Never run `npm run reset` or `npm run seed` against the factory data.** `reset` (`scripts/reset-db.js`) deletes shots, events, downtime, logs, issues and the mail queue. They are demo tools. Since 1.4.1 `reset` refuses unless the person types `DELETE EVERYTHING` in a terminal or passes `--yes-delete-everything`, and it takes a backup first (`data/backups/<time>-before-reset/`, undo with `node scripts/rollback.js latest`); `seed` refuses on a database that already has shots unless `--yes-add-demo-data` is given (also with a backup first). Nothing run from a script, a pipe or a scheduled task can wipe data without the flag.

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

**If the update applied no migration** (`upgrade.js --check` said `migrations applied: none`, as for 1.5.1), the restart took no backup and the database is unchanged: roll back the **code only** (step 4 below) and do **not** run `rollback.js latest`, which would put back the backup of an earlier upgrade and with it older data. Use the `data/` copy from section 2 step 2 if the data itself is damaged.

1. **Stop the app** (Task Scheduler > Digital Kaizen > End; or `sudo systemctl stop digital-kaizen`).
2. `node scripts/upgrade.js --backups` lists the backups, with the version each came from. Then `node scripts/rollback.js latest` (or `node scripts/rollback.js <backup folder name>`).
3. It moves the current database to `data/rolled-back/<time>/` (nothing is deleted, so work logged since the upgrade is kept), copies the backup into place, and prints the row counts. It must end with `OK`.
4. Start the **previous version** of the app against it: `git checkout <the version you were on, for example v1.3.1>` and `npm install --omit=dev`, or unzip the old release zip. The backup is exactly the pre-upgrade file, so the old version opens it as it always did. Then restart the app. (`git checkout main` and `npm install --omit=dev` returns to the newest code.)
5. Everything that was entered **after** the upgrade is not in the restored database: shots, logs, and also any people made on the People page since. Make those people again (README Step 6 and the People section) and, if it matters, read the old rows from `data/rolled-back/<time>/kaizen.db`.
6. To go forward again later, upgrade again from section 2.

## 3. CONFIGURATION: every setting, key and credential

**Rule: no secret is ever in code or in git.** Secrets live in the Settings screen (stored in the database) or in `.env` / `data/`, which are not committed.

### Email (escalation mail)

Follow README Step 9 to create a Resend account, verify a sending subdomain and add its sending-only API key, From address and display name to `.env`. Restart the Windows scheduled task (Task Scheduler > Digital Kaizen > End, then Run) or Linux service (`sudo systemctl restart digital-kaizen`). **Settings > Email** displays whether the key is set, the From address and the test button; the key is never displayed or stored in SQLite. The key takes precedence over SMTP even if the From address is missing.

With no Resend key, the previously saved SMTP configuration remains the fallback. On an installation with no saved SMTP settings, legacy `DK_SMTP_HOST`, `DK_SMTP_PORT`, `DK_SMTP_USER`, `DK_SMTP_PASS` and `DK_MAIL_FROM` environment defaults still work. These SMTP values are read at startup; restart after editing `.env`. Existing saved SMTP credentials are retained during the upgrade.

A message is queued before sending. Resend 429 and 5xx responses are retried with backoff; the queue also retries outages. A 401 means the key was refused; 403 means access was refused; 422 can mean the sender or message is not allowed. Check the verified domain and From address in Resend. Never paste a key into a support message or log.

Two-step sign-in uses an authenticator app (TOTP) and needs no email or email keys.

### The escalation ladder: Settings > Escalation ladder
People, roles, emails and minutes per level, in the database. The five Evernu addresses are only a starting example (`src/starter.js`). **Never edit the addresses in code.**

### Other settings in the database (Settings screen)
Limits (machine down minutes, defects per shift), downtime reasons, defect types, moulds and ideal cycle times, operator names and optional PINs, the dashboard address (`baseUrl`), machine QR epochs.

### `.env` (app folder; read at start, restart after editing)

| Key | Meaning |
|---|---|
| `RESEND_API_KEY`, `DK_MAIL_FROM`, `DK_MAIL_FROM_NAME` | Resend sending-only key, verified From address and display name; restart after editing |
| `DK_BROKER_URL`, `DK_BROKER_USER`, `DK_BROKER_PASS` | The sensors' MQTT broker (the factory's Mosquitto) and its login. These are the sensors' credentials, copy from the sensor file |
| `DK_TOPIC_ROOT` | First part of the sensors' topic |
| `DK_WEB_PORT` | Dashboard port, default 4310 |
| `DK_BASE_URL` | Optional starting value for the address in emails and QR codes (the Settings screen wins) |
| `DK_DB`, `DK_PHOTOS`, `DK_KEYFILE`, `DK_SECRETS` | Move the data files (tests use these) |
| `DK_QUIET=1` | Silence migration log lines |
| `DK_ALERT_SCALE`, `DK_NETFAIL`, `DK_SPEED`, `DK_NO_SIM`, `DK_MQTT_HOST`, `DK_MQTT_PORT`, `DK_FIRMWARE` | Demo and simulation only. Never on the factory server |

`npm start`, `npm run setup`, `npm run check`, `npm run admin`, `npm run reset-account` and `npm run reset` read `.env`. **`npm run demo` does not**, and neither does a plain `node scripts/upgrade.js` or `node scripts/rollback.js` (they find the database from the folder, or from `DK_DB`).

### Accounts and 2-step
- **Until the first account exists the dashboard has no personal sign-in.** With `data/secrets.json` (made by `npm run setup`) it asks for the one shared password; without that file (the demo) it is open. Making the first admin switches accounts on at once, with no restart, and retires the shared password. An update never makes the dashboard demand an account by itself, on purpose, so a factory that upgrades is never locked out.
- First admin: `npm run admin -- "Name" email` (README Step 6). It prints a one-time link (72 hours, works once). The person chooses a password (10+ characters), scans a QR code into an authenticator app, types the 6 digits (since 1.5.1 the key stays the same for that link until the first code is accepted, even after a refresh or going back; **Scan a new code** replaces it), and saves 10 recovery codes shown once. The command prints the address it used and where that came from. The address comes from, in this order: **Settings > Dashboard address**, `DK_BASE_URL` in `.env`, then the PC's own best address (ordinary LAN ranges 192.168, 10 and 172.16 to 31 first, then other real addresses, then Tailscale/carrier 100.64/10 and virtual adapters such as Docker, WSL and VirtualBox, link-local last). If it is wrong, set `DK_BASE_URL` in `.env` (it is used for invite links, the People page, invite emails, the acknowledge link in escalation emails and QR codes). The start-up window prints the chosen address too.
- **First-run setup page (1.4.1):** `/setup` makes the first admin and goes on into the same invite flow. A **brand-new install** (its database file did not exist at start, no shared password, no account) is CLOSED: every dashboard page goes to `/setup`, and the app prints a one-time setup link in its window and log at every start (it works once, then a new one is made at the next start; ten wrong codes lock it for 15 minutes). The QR operator page, sensor ingest (HTTP and MQTT) and the acknowledge link stay open. An **existing install** is never closed by an update: with data and no password it stays open as before (the start-up window says in plain words that anyone on the network can open it), with the shared password it keeps asking for it; `/setup` is offered only after the shared password is entered (no token needed then) or by command. The demo (simulated machines) stays open and has no `/setup`. Setup refuses once any account exists.
- Two-step (6-digit code or a recovery code) is compulsory for admin, manager and viewer. Operators (names on the QR page) have no account.
- More people: People page, **Add a person**, role admin, manager or viewer; the one-time link is shown (and emailed if you tick the box and mail is set up). More admins from the command line: `npm run admin -- "Name" email admin` (the third word picks admin, manager or viewer; default admin).
- Passwords are stored as scrypt hashes; 2-step secrets are encrypted with `data/keystore.key`. 5 wrong passwords lock an account for 15 minutes (People > Unlock); 20 bad attempts from one address in 15 minutes are refused.
- **Rotate a person's password or lost phone (reset their 2-step):** People > Reset (new one-time link; the old password and authenticator stop working at once and they are signed out). The same link makes them pick a new password and scan a new QR code.
- **The only admin lost phone and recovery codes:** on the PC run `npm run reset-account -- admin@email`. It does what People > Reset does (old password, authenticator and sessions end), writes `user-reset` with who `command line (reset-account)` in the sign-in log, and prints a new one-time link (72 hours). It refuses an unknown email, an operator name and a switched-off account.
- **Rotate a machine's QR code** (a sticker was lost or photographed): Labels > Retire this label, print the new one.
- **Rotate `keystore.key`** is not a routine job. Deleting it invalidates all 2-step enrolments and all QR labels. If it must be done: stop the app, move the file away, start, then reset every person on the People page and reprint the labels.

### How to test email WITHOUT spamming managers

1. **Test the account only:** Settings > Email > type your OWN address in "send a test to" > Save and send test. This sends one message to that address and nothing else. It never touches the ladder.
2. **Rehearse the whole ladder, sending nothing outside:** on a **separate test copy of the app** (the demo, see README "Try it without a factory"; not the live install, because while the mail server points at the sink, real escalations would be caught there and never reach the managers), run `npm install` (dev packages), `npm run mail-sink`, then remove the Resend key from the test copy and set `DK_SMTP_HOST=127.0.0.1`, `DK_SMTP_PORT=1025`, and `DK_MAIL_FROM=test@factory.example` before starting; use a test copy with no saved SMTP settings. Read what would have been sent at `http://localhost:8025`.
3. **Rehearse with real delivery but only to yourself:** on a test copy, edit the ladder so every level is your own address, and use the demo's "Stop MA2" or a lowered limit. (Never on the live install, so managers never see a test.)
4. Switch the whole ladder off with **Escalation emails on** (Settings) when needed; issues are still recorded.
5. The Escalations page shows every email, its status and the last error.

## 4. Release steps (for the person who ships the next version)

1. Work on a branch; `AGENTS.md` lists the rules. This repo releases from `main`.
2. `npm test` (that is `node --test` then `node scripts/verify-guards.js`) must pass. Run the two commands directly with node if `npm` is not usable in your shell.
3. If you changed the database: add a **new migration at the end of `MIGRATIONS` in `src/migrate.js`** (never edit an old one), and extend `test/migrate.test.js`. Run `node scripts/upgrade.js --check` against a copy of a real database.
4. Run the browser end-to-end against the simulated factory and the mail sink (the header of `scripts/e2e-browser.mjs`, and `AGENTS.md`, say how; it needs a Chrome, Chromium or Edge, found automatically on Windows, macOS and Linux or set with `CHROME`; `playwright-core` is a dev dependency, so `npm install` brings it). All checks must pass; read the screenshots.
5. Bump `version` in `package.json` and `APP_VERSION` in `src/migrate.js`. Write `UPDATE-vX.Y.md` (what is new, how to install **including making the first admin if there is none**, what to check). Keep `README.md`, `UPDATING.md`, `UPDATE-vX.Y.md`, `AGENTS.md` and `CLAUDE.md` agreeing with each other and with the code.
6. Merge to `main`, `git tag -a vX.Y.Z`, push both.
7. Build the offline zip from a clean checkout of that tag: `bash scripts/make-release.sh X.Y.Z` (makes `digital-kaizen-X.Y.Z-offline.zip`; needs `python3`, `tar` and a working `npm prune`, so use a native Node and npm, not a Windows npm over a WSL path).
8. Create the GitHub release as a **draft**: `gh release create vX.Y.Z --draft --notes-file UPDATE-vX.Y.md digital-kaizen-X.Y.Z-offline.zip#digital-kaizen-offline.zip`. The owner publishes it. Until it is published, the README's "newest release" link still shows the previous version.
9. After installing on the factory PC, run the checks in section 2 step 6.
10. Documentation-only fixes after a tag go to `main` as a normal commit; they do not move the tag or the release.
