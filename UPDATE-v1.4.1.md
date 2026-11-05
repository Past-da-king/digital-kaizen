# Digital Kaizen 1.4.1: update handover note

For the factory PC (`192.120.0.7`), which is **already in use**. This is a small safety release: no new screens, **no database change**, no data touched. Developers and agents: read `UPDATING.md` and `AGENTS.md` as well.

## What changed

| Change | In one line |
|---|---|
| **`npm run reset` and `npm run seed` cannot run by accident** | `reset` refuses unless you type `DELETE EVERYTHING` in a terminal or pass `--yes-delete-everything`. Either way a backup is made first and its folder is printed. `seed` refuses on a database that already has shots unless you pass `--yes-add-demo-data` (also with a backup). |
| **First-run setup page** | `/setup` makes the first admin and goes straight into the same four screens (password, QR, 6 digits, recovery codes). A brand-new install is closed until it is used, with a one-time setup link printed when the app starts. |
| **Lost phone command** | `npm run reset-account -- name@evernu.co.za` resets one account, ends their sessions, writes it to the sign-in log and prints a new one-time link. |
| **Right address in links** | The invite link used a Tailscale `100.x` address. Now: Settings > Dashboard address, then `DK_BASE_URL` in `.env`, then an ordinary LAN address (192.168, 10, 172.16 to 31 first). The start-up window prints which one it chose and how to change it. |
| **Tidy** | Three old scratch scripts removed, `package-lock.json` fixed so a clean install changes nothing, `playwright-core` declared for the browser test, and the browser test finds Chrome on Windows and Linux by itself. |

## 1. Nothing at the factory is locked out

- **No database change.** There is no new migration, so no backup is needed or made by this update. Your data is not touched.
- **An existing install behaves exactly as before.** With the shared password it still asks for the shared password. With data and no password it stays open, as it was, and the start-up window now says in plain words that anyone on the network can open the dashboard and what to run (`npm run admin`).
- Only a **brand-new** install (a database file that did not exist when the app started, no shared password, no account) starts closed. The factory PC is not that.
- The QR page for operators, sensor readings (MQTT and HTTP) and the acknowledge link in emails are never closed.
- On an existing install `/setup` is offered only after the shared password is entered, or you use `npm run admin` as before.
- Proof on copies only: a v1.4.0 data store with data and no accounts, and one with the shared password, were started on 1.4.1. Dashboard open as before in the first, shared password still asked for in the second, QR page and sensor posting open in both, row counts identical.

## 2. Install

1. Copy the `data` folder and the `.env` file somewhere safe (USB stick).
2. **With internet:** `git pull` then `npm install --omit=dev`. **Without internet:** unzip `digital-kaizen-offline.zip` for 1.4.1 over the old folder (`data` and `.env` are kept).
3. Optional, harmless: `node scripts/upgrade.js --check` (it says OK and that nothing is pending).
4. Restart the app (Task Scheduler > Digital Kaizen > End, then Run; or `sudo systemctl restart digital-kaizen`).
5. Look at the start-up window or `data/digital-kaizen.log`. Check the line starting `links in emails, QR codes and invites use`. If the address is wrong, add `DK_BASE_URL=http://192.120.0.7:4310` to `.env` and restart.

### If anything looks wrong: roll back

There is no schema change, so going back is just the previous version: `git checkout v1.4.0` and `npm install --omit=dev`, restart. The data is as it was. (`node scripts/rollback.js latest` is only for a database restore and is not needed here.)

## 3. The new commands

```
npm run reset-account -- name@evernu.co.za     lost phone or forgotten password
npm run admin -- "Name" name@evernu.co.za      first admin, or another one (as before)
npm run reset                                  demo only; asks you to type DELETE EVERYTHING
```

`reset-account` refuses an email that has no account, an operator name and a switched-off account, and changes nothing in those cases. The old password, authenticator and sessions of the person stop working at once.

## 4. Set the link address once

Add one line to `.env` on the factory PC and restart:

```
DK_BASE_URL=http://192.120.0.7:4310
```

It is used for invite links (command line, People page, invite email), the acknowledge link in escalation emails and the QR codes. **Settings > Dashboard address**, if filled, wins over it.

## 5. For developers

- `npm test` runs 72 tests and 9 guard checks. New: first-run states, the reset and seed guards, `reset-account`, address choice and where `DK_BASE_URL` is honoured.
- Test files about an install that already existed call `asExistingInstall(db)` (`test/_env.js`): a temp database is a brand-new install and is closed until `/setup`.
- `playwright-core` is a dev dependency; `scripts/e2e-browser.mjs` looks for Chrome, Chromium or Edge on Windows, macOS and Linux (and in `~/.cache/ms-playwright`), or uses `CHROME`.
