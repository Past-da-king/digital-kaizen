// Makes the first dashboard admin (or any later account) from the command line,
// on the PC itself, so there is never an open sign-up page.
//
//   npm run admin -- "Full Name" name@example.com [admin|manager|viewer]
//
// It prints a one-time link (valid 72 hours). Open it in a browser, choose a
// password, scan the QR into an authenticator app and save the recovery codes.
import { createUser } from '../src/users.js';
import { baseUrlInfo } from '../src/escalation.js';

const [name, email, role = 'admin'] = process.argv.slice(2);
if (!name || !email) {
  console.log('\n  Usage: npm run admin -- "Full Name" name@example.com [admin|manager|viewer]\n');
  process.exit(1);
}
const r = await createUser({ name, email, role }, 'command line');
if (!r.ok) { console.log(`\n  ${r.error}\n`); process.exit(1); }
console.log(`\n  Account made for ${name} (${role}).\n  Open this link to finish setting it up (works once, 72 hours):\n\n  ${baseUrlInfo().url}/invite.html?t=${r.inviteToken}\n\n  Link address: ${baseUrlInfo().url} (from ${baseUrlInfo().source}). Wrong for their phone? Set DK_BASE_URL in .env, or keep the part from /invite.html.\n`);
