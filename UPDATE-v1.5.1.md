# Digital Kaizen v1.5.1

## What changed

Fix for two-step sign-in setup. Before 1.5.1 the authenticator key was made again every time a person pressed Next on the invite page or refreshed it, so the entry already scanned into the phone held a dead key and every code was refused.

- The key now stays the same for that invite link until the first code is accepted. Refreshing, going back, a second tab or a double click all show the same key.
- A **Scan a new code** button makes a fresh key on purpose, keeping the chosen password.
- Clearer messages: a code from an older Digital Kaizen entry in the phone is named as such, with the fix (delete the old entry, scan again).

No database migration. No setting changes. Data, `.env` and `data/keystore.key` are untouched.

## Update safely

1. Stop the app and copy the complete `data/` folder and `.env` somewhere safe.
2. Get the new code: `git pull` (or `git checkout v1.5.1`) then `npm ci --omit=dev`, or unzip `digital-kaizen-1.5.1-offline.zip` and copy the **contents** of its `digital-kaizen` folder over the app folder.
3. Dry run: `node scripts/upgrade.js --check`. It must end with `OK: every existing row is still there`.
4. Restart the Windows scheduled task (Task Scheduler > Digital Kaizen > End, then Run) or `sudo systemctl restart digital-kaizen`.
5. Confirm the version is 1.5.1 (`version` in `package.json`, or the start-up window), sign in, and check the Live floor.
6. Rollback if needed: stop the app, put back the 1.5.0 code (`git checkout v1.5.0` and `npm ci --omit=dev`, or unzip the 1.5.0 zip over the folder), start. The database needs nothing: 1.5.1 changes no table, so the restart takes no new backup. **Do not run `node scripts/rollback.js latest` for this update**: the newest backup is from an earlier upgrade and would put back older data. Only if the data itself is damaged, stop the app and put back the `data/` folder copied in step 1.

## After the update: people whose two-step setup failed

1. Delete the old Digital Kaizen entry in the authenticator app.
2. Open the invite link (if it expired or was used, an admin makes a new one: People > Reset, or `npm run reset-account -- email`; for the very first admin `npm run admin -- "Name" email`).
3. Choose the password, scan the QR code once without refreshing, and type the code the app shows now.
4. Save the 10 recovery codes.

Never run reset or seed against factory data.
