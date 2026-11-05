# CLAUDE.md

Follow `AGENTS.md` (rules, where things live, how to test, release steps) and `UPDATING.md` (data safety, rollback, configuration, release). `README.md` is the install guide a factory person follows top to bottom. Keep all of them in agreement whenever you change a command, default, port or step.

In short:
- Never lose production data: a new versioned additive migration for any schema change, and never touch the live `data/` folder, `npm run reset` or `npm run seed`.
- Never put a secret in code or git.
- Never send real email while testing: use `npm run mail-sink`.
- Run `npm test` (`node --test` then `node scripts/verify-guards.js`) and, for UI changes, `scripts/e2e-browser.mjs`; look at every UI change at 1920 and 390 in dark and light before calling it done.
- Do not change how the dashboard behaves before the first admin exists without a plan for existing installs (it stays open or behind the old password so an upgrade cannot lock the floor out).
- Releases come from `main`; never move a pushed tag or publish a draft release.
