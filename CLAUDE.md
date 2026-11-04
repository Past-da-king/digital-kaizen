# CLAUDE.md

Follow `AGENTS.md` (rules for working on this repo) and `UPDATING.md` (data safety, rollback, configuration, release). In short: never lose
production data (new versioned additive migration for any schema change), never put a secret in code or git, never send real email while testing,
and look at every UI change at 1920 and 390 in dark and light before calling it done.
