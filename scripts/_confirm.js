// Shared guard for commands that destroy or overwrite data (reset, seed).
//
// A command may continue only if the person
//   - passes the explicit flag on the command line, or
//   - types the phrase themselves in a real terminal.
// Anything else (a script, a pipe, a scheduled task, a stray npm run) is refused.
import { createInterface } from 'node:readline/promises';
import { takeBackup, APP_VERSION } from '../src/migrate.js';
import { countTables } from '../src/migrate.js';

export const PHRASE = 'DELETE EVERYTHING';

export async function confirmDestructive({ what, flag, phrase = PHRASE, argv = process.argv, tty = process.stdin.isTTY && process.stdout.isTTY, ask }) {
  if (argv.includes(flag)) return { ok: true, how: 'flag' };
  if (!tty && !ask) {
    return { ok: false, why: `${what}\n  Refused: this is not an interactive terminal and ${flag} was not given.` };
  }
  console.log(`\n  ${what}\n`);
  const typed = ask ? await ask(phrase) : await (async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(`  Type  ${phrase}  and press Enter to continue (anything else cancels): `); } finally { rl.close(); }
  })();
  return String(typed).trim() === phrase ? { ok: true, how: 'typed' } : { ok: false, why: 'Cancelled. Nothing was changed.' };
}

// A full safety copy first, so even a confirmed mistake can be undone with scripts/rollback.js.
export function backupFirst(db, file, label) {
  const counts = countTables(db);
  const b = takeBackup(db, file, { appVersion: APP_VERSION, from: 'before ' + label, to: 'after ' + label, counts, label });
  console.log(`  Backup written to ${b.dir}\n  (undo with: node scripts/rollback.js latest)`);
  return b;
}
