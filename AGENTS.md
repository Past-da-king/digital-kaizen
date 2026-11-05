# AGENTS.md: rules for a coding agent working on Digital Kaizen

Read `UPDATING.md` first (data, backups, rollback, configuration, release). This file is the short version of what you may and may not do. `CLAUDE.md` points here.

## What this is
Live shot counting, downtime and defect logging, OEE and an escalation ladder for injection-moulding machines at Evernu (client: Productivity SA). A plain Node app
(Node 22.13 or newer, no build step): `src/` server, `public/` pages, `scripts/` tools, `test/` tests. SQLite via `node:sqlite`. It runs on the
factory's own PC and may have no internet. The factory is using it **now**.

## The rules that matter most
1. **Never lose production data.** Schema changes are a NEW migration appended to `MIGRATIONS` in `src/migrate.js`: add only, idempotent, tested in `test/migrate.test.js`. Never edit a migration that has shipped. Never drop, rename or rewrite a column or table without copying first. Never delete rows.
2. **Never touch real data while working.** Never point anything at the live `data/` folder of a factory install, and never run `npm run reset` (it wipes shots, events, downtime, logs, issues and the mail queue with no question) or `npm run seed` there (since 1.4.1 they refuse without a typed phrase or `--yes-delete-everything` / `--yes-add-demo-data`, and back up first; do not pass the flag against real data). Test with a temp database (see "How to test"). Try an upgrade on a COPY with `node scripts/upgrade.js --check`.
3. **Never put a secret in code, tests, docs or git.** SMTP login, broker password, API keys, personal addresses of real people: Settings screen or `.env`/`data/`. Test fixtures use made-up addresses on `.test` or `.example`.
4. **Never send real email while testing.** Use `npm run mail-sink` (a local SMTP catcher, see below) or a test file's sink. Real Evernu addresses (`@evernu.co.za` and the starter ladder in `src/starter.js`) must never receive a test. Only an address the owner gave you for testing may receive real mail.
5. **Nothing is hardcoded that the factory can change.** The ladder, reasons, defect types, moulds, limits and operator names are data edited in Settings. `src/starter.js` and the defaults in `src/settings.js` are only first-run examples.
6. **Escalations start only from automatic limits** (machine down past the limit, defects past the shift limit) or from a signed-in manager acknowledging or resolving on the dashboard. There is deliberately no way to start one from the QR page. Do not add one.
7. **The QR page needs no login**: it is guarded by the per-machine token in the QR, a light rate limit and, optionally, a PIN per name. Do not add friction for operators. Dashboard access needs an account with 2-step.
8. **Accounts are switched on only by creating the first admin.** While no account exists an EXISTING install stays as it was (open if it has data and no password, behind the old shared password if `npm run setup` made `data/secrets.json`), so an upgrade can never lock a factory out. Do not change this without a plan for existing installs. Since 1.4.1 a BRAND-NEW install (database file did not exist at start, no shared password) is closed until `/setup` is used with the one-time token printed at start (`src/setup.js`; the `setupGate` row in `settings` is written only when the database is created and is never added to an existing one). The demo (simulators on) stays open. The QR page, ingest and MQTT are never behind it. The README makes the first admin a required step (`npm run admin`, or `/setup`). `npm run reset-account -- email` is the lost-phone command.
9. **Everything works offline.** No CDN, no web fonts, no outside service in the path of the data, not even for notifications. Email goes only through the SMTP account in Settings and is queued and retried when the network is down.
10. **Look at what you build.** For any UI change run the app, open it at 1920 and 390 wide, in dark and light, and look. `scripts/e2e-browser.mjs` takes screenshots of every page; read them. A passing test is not a look.

## Where things live
- `src/migrate.js` versioned schema, backup, verify, restore (`APP_VERSION` is here). `src/db.js` opens the database through it.
- `src/run.js` the one entry point (`npm start`, `npm run demo`). `src/config.js` machines, shifts, downtime rules, firmware constants. `src/broker.js` the demo's own MQTT broker, `src/sim/` the simulated machines.
- `src/ingest.js`, `src/events.js` sensor readings to shots, stops and downtime events. `src/devices.js` sensor pairing.
- `src/escalation.js` issues, the ladder, acknowledge, `baseUrl()`. `src/net.js` which address goes into links (Settings, then `DK_BASE_URL`, then the best LAN address). `src/setup.js` first-run setup (token, gate, who may use `/setup`). `src/mail.js` the queue and SMTP. `src/settings.js` all settings and their defaults.
- `src/users.js` accounts, 2-step (TOTP and recovery codes), sessions, QR tokens, invitations. `src/auth.js` the old shared password and the MQTT credentials (`data/secrets.json`).
- `src/oee.js` OEE and the state timeline. `src/store.js` logs and quality queries.
- `src/server.js` all HTTP routes and who may call them (`OPEN_PATHS`, `QR_PATHS`, `roleNeeded`).
- `public/` pages: `index.html` + `live.js` + `dashboard.js` (floor), `machine.js`, `quality.js`, `log.js` (QR page), `settings.js`, `users.js`, `invite.js`, `login.js`, and so on. Design system: `public/style.css` (tokens in `:root`, dark default, light via `data-theme`), shared shell and charts in `public/ui.js`. Status colours mean the same everywhere: green running, amber idle, red down, blue planned, grey no data. Do not introduce new colours for status.
- `scripts/` tools: `setup.js`, `check.js`, `create-admin.js`, `reset-account.js`, `_confirm.js` (the guard `reset` and `seed` share), `upgrade.js`, `rollback.js`, `smtp-sink.js`, `verify-guards.js`, `e2e-browser.mjs`, `make-release.sh`, `import-reports.js`, plus the demo-only `seed-history.js` and `reset-db.js`.
- `deploy/` the Windows scheduled task and Linux systemd installers. `docs/` proofs and the report-extraction notes.
- Docs that must agree with each other and with the code: `README.md` (install, top to bottom, for a non-developer), `UPDATING.md` (update, backup, rollback, configuration, release), `UPDATE-vX.Y.md` (handover note per release), `AGENTS.md`, `CLAUDE.md`. If you change a command, a default, a port, an environment name, a menu label or a step, fix every one of them in the same commit.

## How to test
- **Everything:** `npm test`, which is `node --test` then `node scripts/verify-guards.js`. If `npm` is not usable in your shell (for example the Windows npm over a WSL path), run the two commands directly with node. Expect 72 tests and 9 guard checks, all green. Test files that are about an install that already existed call `asExistingInstall(db)` from `test/_env.js`, because a temp database is by definition a brand-new install (closed until `/setup`). Dev packages (`npm install`, not `--omit=dev`) are needed for the mail tests.
- Test files import `test/_env.js` first: it points the app at a private temp database, key file, secrets file and photo folder and port 0. Never point a test at `data/`. `verify-guards.js` drives the ingest guards (reconnect, reboot, a bogus jump in the counter) against its own temp database.
- Change a behaviour: write or change the test first, watch it fail, then make it pass.
- **The simulated factory** (does not touch real data if you give it its own files):
  ```
  export DK_DB=/tmp/dk-e2e/kaizen.db DK_KEYFILE=/tmp/dk-e2e/keystore.key DK_PHOTOS=/tmp/dk-e2e/photos DK_SECRETS=/tmp/dk-e2e/secrets.json DK_WEB_PORT=4410
  npm run demo        # own broker on 1883, two simulated machines, dashboard OPEN until an admin exists
  npm run mail-sink   # second window: SMTP on 1025, read mail at http://localhost:8025
  npm run admin -- "Test Admin" a@factory.test      # third window; prints the setup link (the demo is open and has no /setup)
  ```
  Open the link (replace its host with `localhost:4410`) to try the real sign-in: password, QR, 6-digit code, recovery codes. `DK_SPEED=6` runs the machines faster. Port 1883 must be free.
- **Browser end-to-end** (`scripts/e2e-browser.mjs`, about 5 minutes: it waits for a simulated machine to stop and for the ladder to climb). It needs a Chrome, Chromium or Edge (found automatically on Windows, macOS and Linux, including Playwright's own download in `~/.cache/ms-playwright`; set `CHROME` to its path otherwise). `playwright-core` is a dev dependency (`npm install`); `PW` can point at another copy's `index.mjs`. With the demo and sink running as above:
  ```
  E2E_BASE=http://localhost:4410 E2E_INVITE='http://localhost:4410/invite.html?t=...' CHROME=... PW=... node scripts/e2e-browser.mjs ./e2e-shots
  ```
  It signs in with 2-step, logs by QR with a photo, stops a machine, checks the level 1 to 3 emails in the sink, and screenshots every page at 1920 and 390 in dark and light into the folder you give it, with `e2e-results.json`. Do not commit that folder. Read the screenshots.
- **Safe email testing:** the mail sink only. Point Settings > Email at `127.0.0.1`, port 1025, security None. In tests, `mailparser` and `smtp-server` (dev packages) give a throwaway SMTP server. A real "send a test" goes only to the address typed in the box, never the ladder.
- **An upgrade or a migration:** `node scripts/upgrade.js --check` on a COPY of a real database must end with `OK: every existing row is still there`. `node scripts/rollback.js latest` and `node scripts/upgrade.js --backups` are the way back (see `UPDATING.md`).

## Release steps (short; full list in `UPDATING.md` section 4)
1. Tests green, e2e green, screenshots read. Migration tested on a copy of real data if the schema changed.
2. Bump `version` in `package.json` and `APP_VERSION` in `src/migrate.js`. Write `UPDATE-vX.Y.md`. Update README, UPDATING, AGENTS, CLAUDE so they agree.
3. Merge to `main`, `git tag -a vX.Y.Z`, push both. This repo releases from `main`.
4. `bash scripts/make-release.sh X.Y.Z`, then `gh release create vX.Y.Z --draft ...`. The owner publishes the release; you never do.
5. Never move a tag that has been pushed. A documentation fix after a release is a normal commit on `main`.

## How to work
- Commits: small, on a branch (or on `main` for docs only, which is how this repo releases), with the repo's own git identity (do not override author). Push before you finish. Never commit `data/`, `.env`, keys, screenshots or `p*tmp.py` scratch files.
- Do not run an installer or restart a production service on the factory PC yourself. Hand the owner the release and the steps in `UPDATING.md`.
- Stop every process you start (demo, sink, browsers, test servers) when you finish, by your own process ids, and delete temp folders.
