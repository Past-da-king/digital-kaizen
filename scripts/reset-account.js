// Lost phone or forgotten password: reset one account on the PC itself.
//
//   npm run reset-account -- name@example.com
//
// The old password and authenticator stop working at once, every session of that
// person is ended, the reset is written to the sign-in log (Users > sign-in log),
// and a new one-time link (72 hours) is printed. The person opens it, chooses a
// password and sets up the authenticator app again. Unknown emails are refused.
import { findByEmail, adminReset } from '../src/users.js';
import { baseUrlInfo } from '../src/escalation.js';

const email = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!email) { console.log('\n  Usage: npm run reset-account -- name@example.com\n'); process.exit(1); }

const u = findByEmail(email);
if (!u || u.role === 'operator') { console.log(`\n  No dashboard account with the email "${email}". Nothing was changed.\n  (Check the spelling on Users, or make the account with: npm run admin -- "Name" email)\n`); process.exit(1); }
if (u.status === 'disabled') { console.log(`\n  ${u.email} is switched off. Switch the account on (Users page) first, then run this again. Nothing was changed.\n`); process.exit(1); }

const r = adminReset(u.id, 'command line (reset-account)');
if (!r.ok) { console.log(`\n  ${r.error}\n`); process.exit(1); }
const b = baseUrlInfo();
console.log(`\n  Reset done for ${u.name} <${u.email}> (${u.role}). Their old password, authenticator and sessions no longer work.\n  Give them this link (works once, 72 hours):\n\n  ${b.url}/invite.html?t=${r.inviteToken}\n\n  Link address: ${b.url} (from ${b.source}). If it is wrong for their phone, keep the part from /invite.html and\n  put the right address in front, or set DK_BASE_URL in .env.\n`);
