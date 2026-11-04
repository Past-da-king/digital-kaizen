# Digital Kaizen 1.3.1: update handover note

**1.3.1:** the "Call a manager" button and its route are removed from the QR page. Escalations now start only from the automatic limits (machine down too long, too many defects in a shift). Nothing on the phone page can email the ladder.

What is new, and how to put it on the factory PC (`192.120.0.7`). Read this top to bottom once.

## What you get

| New | In one line |
|---|---|
| **QR log page** | Scan the code on a machine, pick your name, log **defects** (number, type, shift, note, photo) or **downtime** (reason, how long, note). No login, and no way to trigger an escalation from the phone. If the machine is running only *Log defects* shows; if it is down *Log downtime* shows too. |
| **Escalation emails** | A machine down too long, or too many defects in one shift, emails up a ladder (Supervisor, Toolroom, Production, Operations, General Manager) until someone presses **Acknowledge**. |
| **OEE** | Availability x Performance x Quality per machine, per shift, today and the last 14 days. |
| **Redesigned dashboard** | Running / idle / down at a glance, readable across the floor, light and dark. All the old figures are still there. |
| **Accounts with two-step sign-in** | Admins, managers and viewers sign in with a password and an authenticator app. No public sign-up. |
| **Settings screen** | The ladder (people, roles, levels, minutes), limits, mail account, reasons, defect types, moulds, operator names. |
| **CSV export** | Defect log, downtime log, escalations and emails (Quality and Escalations pages). |

Everything stays on the factory PC. The only thing that ever leaves is an email, and only through the mail account **you** enter.

## 1. Install the update

Back up first: copy the `data` folder and `.env` somewhere safe.

**With internet:** in the app folder `git pull`, then `npm install --omit=dev`.
**Without internet:** unzip `digital-kaizen-1.3.1-offline.zip` over the old folder. `data` and `.env` are kept.

Restart the app (Task Scheduler > Digital Kaizen > End, then Run; or `sudo systemctl restart digital-kaizen`).
The database upgrades itself on the first start. Nothing in the sensor data is changed.

## 2. Make the first admin

On the PC, in the app folder:

```
npm run admin -- "Your Name" you@evernu.co.za
```

It prints a one-time link. Open it, choose a password (10+ characters), scan the QR into an authenticator app
(Microsoft or Google Authenticator), type the 6 digits, and **save the 10 recovery codes**. From now on the
dashboard needs a sign-in. Add more people on the **People** page (each gets their own one-time link).
The old shared dashboard password is retired once the first account exists.

Roles: **admin** everything; **manager** sees everything, acknowledges issues, exports; **viewer** sees the dashboard
(good for the wall screen; stays signed in 30 days).

## 3. Set up email (Settings > Email)

Use the factory's own mail server, or a Gmail address with an **app password** (not the normal password).
Fill in server, port, security, login, password and the From address, then **Save and send test**.

- If the factory network cannot reach the mail server, nothing is lost: emails wait in a queue (shown on the
  dashboard and on **Escalations**) and are retried after 1, 2, 5, 10 then every 15 minutes, for up to 48 hours.
- The password is stored in `data/kaizen.db` on this PC. Keep `data` private like the rest of the machine.

## 4. Check the ladder (Settings > Escalation ladder)

It starts with the five Evernu addresses as an **example**; change anything: add or remove people and levels,
rename roles, change the minutes, reorder levels. Default timing: level 1 at once, the next level every 30 minutes
until someone acknowledges. Under **When it counts as an issue**: machine down 10 minutes, 25 defects in one shift
on one machine (both editable).

**Nobody is emailed until the mail account is set up.** Before you switch real mail on, you can rehearse safely with
a throw-away mail server on the PC: `npm install` (dev packages), `npm run mail-sink`, then set the mail server to
`127.0.0.1`, port `1025`, security *None*. Read what would have been sent at http://localhost:8025. Nothing leaves the PC.

## 5. Names, reasons, defect types, moulds

Settings page:
- **Operators on the QR page**: add the names people pick. A PIN per name is optional and off by default.
- **Downtime reasons** and **Defect types**: edit freely; the QR page changes at once.
- **Moulds and ideal cycle time**: enter the ideal cycle (seconds) and cavities for the mould in each machine, and
  mark the one running as active. OEE Performance and "parts not made" use it. The starting values are placeholders.

## 6. Print the QR labels

1. Settings > Dashboard address: put `http://192.120.0.7:4310` (how phones reach this PC).
2. Open **Labels**, check the address under each code is right, press **Print labels**.
3. Laminate, stick one on each machine.

A lost or photographed label: **Retire this label** on the Labels page and print the new one. The old code dies at once.
Phones need to be on the factory Wi-Fi. If the Wi-Fi drops while someone is logging, the entry is kept on the phone and
sent when it is back.

## 7. How OEE is worked out

- **Availability** = run time / planned time. Planned time is the shift so far, minus gaps over 8 h, minus planned stops
  logged by operators (scheduled maintenance, mould change, order complete). Unplanned stops are the gaps the sensor saw
  over 60 seconds.
- **Performance** = (shots x ideal cycle) / run time, capped at 100%.
- **Quality** = (parts made - defects logged) / parts made. Parts made = shots x cavities.
- A factor shows a dash when there is nothing to divide. Quality is only as good as the defect logging.

## 8. Ports and firewall

Unchanged: the dashboard is on port 4310. Emails go out on the mail server's own port (587 or 465).

## 9. If something is wrong

| Problem | Check |
|---|---|
| QR code opens "not valid" | The label was retired, or it was printed from `localhost`. Reprint from the Labels page. |
| Phone cannot open the page | Phone is not on the factory Wi-Fi, or the firewall blocks 4310. |
| Emails not arriving | Escalations page shows each email's status and the last error. Check Settings > Email and press *Save and send test*. |
| Locked out | An admin can unlock on the People page. If no admin can sign in: `npm run admin -- "Name" email` makes a new admin link. |
| Lost authenticator phone | Use a recovery code, or an admin presses **Reset** on the People page for a new setup link. |

## 10. Feeding the two months of reports

See `docs/report-extraction.md`. The field list, an AI prompt, a JSON schema and a checking importer are ready.

## Testing that was done (no factory access)

36 automated tests plus the 9 sensor-guard checks (escalation timing, acknowledge, offline mail queue with retry, logging, photos, OEE figures,
accounts, two-step, lockout, roles) and a 41-check browser end-to-end run (phone and desktop, sign-in with two-step, QR logging with photo, a simulated machine stop that climbed the ladder to levels 1 to 3, acknowledge, restart and resolve) against simulated machines with a local test mail server.
Results: `docs/e2e-results.json`.
