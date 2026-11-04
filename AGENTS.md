# AGENTS.md: rules for a coding agent working on Digital Kaizen

Read `UPDATING.md` first (data, backups, rollback, configuration, release). This file is the short version of what you may and may not do.

## What this is
Live shot counting, downtime and defect logging, OEE and an escalation ladder for injection-moulding machines at Evernu. A plain Node app
(Node 22.13 or newer, no build step): `src/` server, `public/` pages, `scripts/` tools, `test/` tests. SQLite via `node:sqlite`. It runs on the
factory's own PC and may have no internet. The factory is using it **now**.

## The rules that matter most
1. **Never lose production data.** Schema changes are a NEW migration appended to `MIGRATIONS` in `src/migrate.js`: add only, idempotent, tested in `test/migrate.test.js`. Never edit a migration that has shipped. Never drop, rename or rewrite a column or table without copying first. Never delete rows.
2. **Never put a secret in code, tests, docs or git.** SMTP login, broker password, API keys, personal addresses of real people: Settings screen or `.env`/`data/`. Test fixtures use made-up addresses on `.test` or `.example`.
3. **Never send real email while testing.** Use `npm run mail-sink` (a local SMTP catcher) or a test file's sink. Real Evernu addresses (`@evernu.co.za` and the starter ladder) must never receive a test. Only an address the owner gave you for testing may receive real mail.
4. **Nothing is hardcoded that the factory can change.** The ladder, reasons, defect types, moulds, limits and operator names are data edited in Settings. `src/starter.js` and the defaults in `src/settings.js` are only first-run examples.
5. **Escalations start only from automatic limits** (machine down past the limit, defects past the shift limit) or from a signed-in manager acknowledging or resolving on the dashboard. There is deliberately no way to start one from the QR page. Do not add one.
6. **The QR page needs no login**: it is guarded by the per-machine token in the QR, a light rate limit and, optionally, a PIN per name. Do not add friction for operators. Dashboard access needs an account with 2-step.
7. **Everything works offline.** No CDN, no web fonts, no outside service in the path of the data, not even for notifications. Email goes only through the SMTP account in Settings and is queued and retried when the network is down.
8. **Look at what you build.** For any UI change run the app, open it at 1920 and 390 wide, in dark and light, and look. `scripts/e2e-browser.mjs` takes screenshots of every page; read them. A passing test is not a look.

## How to work
- Run all tests: `node --test` then `node scripts/verify-guards.js`. Test files set up their own temp database through `test/_env.js`; never point a test at `data/`.
- Change a behaviour: write or change the test first, watch it fail, then make it pass.
- Run the simulated factory: `npm run demo` (own broker on port 1883, simulated machines) or see the header of `scripts/e2e-browser.mjs` for the full end-to-end with the mail sink.
- Design system: `public/style.css` (tokens in `:root`, dark default, light via `data-theme`), shared shell and charts in `public/ui.js`. Status colours mean the same everywhere: green running, amber idle, red down, blue planned, grey no data. Do not introduce new colours for status.
- Commits: small, on a branch, with the repo's own git identity (do not override author). Push before you finish. Never commit `data/`, `.env`, keys.
- Do not run an installer or restart a production service on the factory PC yourself. Hand the owner the release and the steps in `UPDATING.md`.

## Map
- `src/migrate.js` versioned schema, backup, verify, restore. `src/db.js` opens the database through it.
- `src/ingest.js`, `src/events.js` sensor readings to shots, stops and downtime events.
- `src/escalation.js` issues, the ladder, acknowledge. `src/mail.js` the queue and SMTP. `src/settings.js` all settings.
- `src/users.js` accounts, 2-step, sessions, QR tokens. `src/oee.js` OEE and the state timeline. `src/store.js` logs and quality queries.
- `src/server.js` all HTTP routes and who may call them.
- `public/` pages: `index.html` + `live.js` + `dashboard.js` (floor), `machine.js`, `quality.js`, `log.js` (QR page), `settings.js`, and so on.
