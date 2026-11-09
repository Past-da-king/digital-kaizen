# Digital Kaizen

Live shot counting and downtime tracking for injection-moulding machines.
A distance sensor on each machine sends its readings over MQTT; this app turns them into a live dashboard, a history, and downtime events that operators explain by scanning a QR code on the machine. When a machine stays down too long, or too many defects are logged, it emails people up an escalation ladder.

This page is the **install guide for running it on the factory's own server (`192.120.0.7`)**, next to the Mosquitto broker the sensors already send to. Follow it from top to bottom. **Step 6 (the first admin) is required**: until you do it, the dashboard has no personal sign-in.

Already installed and updating? Read **UPDATING.md** (safe upgrade, backup, rollback) and the `UPDATE-v*.md` note for your version.

---

## What this install does, and what it leaves alone

| | |
|---|---|
| **Reads** | The sensor messages on the existing Mosquitto broker (port 1883). It only listens. |
| **Adds** | One program (Node.js) and one folder. The dashboard is served on port **4310**. |
| **Stores** | Its own database file in the `data` folder. No MySQL setup is needed. |
| **Does not touch** | The sensors, the sensor file, Mosquitto, Node-RED, or the MySQL database. Nothing on them changes and nothing is sent to them. |
| **Internet** | Not needed once it is installed. Everything stays inside the factory network. The only thing that leaves is an escalation email, through the configured mail transport. |

When it is running, anyone on the factory network opens **http://192.120.0.7:4310** in a browser.

---

## Before you start

You need four things:

1. **Access to the server `192.120.0.7`** with an administrator account (Windows) or `sudo` (Linux).
2. **Node.js version 22.13 or newer** on that server. Step 1 below installs it.
3. **The MQTT username and password the sensors use.** They are in the sensor file, on the lines `MQTT_USER` and `MQTT_PASS`. If your Mosquitto does not ask for a login, you do not need them.
4. **A phone with an authenticator app** (Microsoft Authenticator, Google Authenticator or Authy) for the person who will be the first admin. Step 6 uses it.

The whole install takes about 20 minutes.

---

## Step 1. Install Node.js

Check whether it is already there. Open **PowerShell** (Windows) or a **terminal** (Linux) on the server and type:

```
node -v
```

If it prints `v22.13` or higher, go to Step 2. If not:

**Windows.** Download the **LTS Windows Installer (.msi)** from https://nodejs.org and run it with the default options. Then close PowerShell and open a new one.

**Linux (Ubuntu or Debian).**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

If the server has **no internet**, download the Node.js installer on another computer, copy it over on a USB stick, and run it on the server.

---

## Step 2. Get the app onto the server

Pick the one that fits.

### Option A. The server has internet

**Windows (PowerShell):**

```powershell
cd C:\
git clone https://github.com/Past-da-king/digital-kaizen.git
cd C:\digital-kaizen
npm install --omit=dev
```

**Linux:**

```bash
sudo mkdir -p /opt/digital-kaizen && sudo chown $(whoami) /opt/digital-kaizen
git clone https://github.com/Past-da-king/digital-kaizen.git /opt/digital-kaizen
cd /opt/digital-kaizen
npm install --omit=dev
```

No `git`? On the GitHub page press **Code → Download ZIP**, unzip it to `C:\digital-kaizen` (or `/opt/digital-kaizen`), open a terminal in that folder and run `npm install --omit=dev`.

### Option B. The server has no internet

1. On any computer with internet, open https://github.com/Past-da-king/digital-kaizen/releases, open the newest release (**Digital Kaizen 1.4.0** or later) and download **`digital-kaizen-offline.zip`**. It already contains everything `npm install` would fetch. (A release the owner has not published yet is not visible to you. If the newest one is older than 1.4.0, ask the owner to publish it.)
2. Copy it to the server on a USB stick.
3. Unzip it. Inside is one folder called `digital-kaizen`. Move that folder so it becomes `C:\digital-kaizen` (Windows) or `/opt/digital-kaizen` (Linux). Check that `C:\digital-kaizen\package.json` exists, not `C:\digital-kaizen\digital-kaizen\package.json`.
4. Open a terminal in that folder. Do **not** run `npm install`.

---

## Step 3. Set it up

In the app folder, run:

```
npm run setup
```

It asks four questions. Press Enter to accept the answer in brackets.

| Question | Answer on the factory server |
|---|---|
| Broker address | `127.0.0.1` (Mosquitto is on this same machine) |
| Broker port | `1883` |
| Broker username | The `MQTT_USER` from the sensor file |
| Broker password | The `MQTT_PASS` from the sensor file |

A line saying `.env not found. Continuing without it.` on the first run is normal.

At the end it prints a **temporary dashboard password**. Write it down. It is only used from now until you make the first admin in Step 6; after that it stops working. Running `npm run setup` again shows it again and never changes it.

Your answers are saved in a file called `.env` in the app folder. To change one later, open `.env` in Notepad, edit it, save, and restart the app. The topic (`DK_TOPIC_ROOT` in `.env`) must match the sensor file: open the sensor file, look at `MQTT_TOPIC`, and make the part before the first `/` identical.

---

## Step 4. Check that the sensors are heard

Make sure at least one sensor is switched on, then run:

```
npm run check
```

It listens for 20 seconds. You want to see this:

```
  heard sensor a1b2c3d4e5f6  (factory-demo-9f7c2a61/devices/a1b2c3d4e5f6/data)

  WORKING: 1 sensor heard.
```

If it says **NOT WORKING**, it tells you why. The usual causes are in [If something is wrong](#if-something-is-wrong).

---

## Step 5. Start it and open the dashboard

```
npm start
```

Leave that window open (Step 8 makes it start by itself later). On any computer on the factory network, open:

**http://192.120.0.7:4310**

The page asks for the **temporary dashboard password** from Step 3. Enter it. You see the Live floor.

> **Do Step 6 now.** Until the first admin exists, the only protection is that one shared password. If you started with `npm run demo` instead of `npm start`, there is **no** protection at all and anyone on the network can open the dashboard. Nobody is asked to make an account by themselves: it only happens in Step 6. When the app starts it prints one plain line saying whether anyone on the network can open the dashboard, and which address it puts in links (see Step 6).

If the page does not open from another computer but does open on the server itself (`http://localhost:4310`), the server's firewall is blocking port 4310. Step 8 opens it on Windows. On Linux: `sudo ufw allow 4310/tcp`.

---

## Step 6. Make the first admin (required)

Do this right after the first start, while you are at the server. **Leave `npm start` running** and open a **second** PowerShell or terminal window in the app folder. Then:

```
npm run admin -- "Your Name" you@evernu.co.za
```

Use the real name and email address of the person who will manage the dashboard. (If the command complains about the extra dashes, run `node --env-file-if-exists=.env scripts/create-admin.js "Your Name" you@evernu.co.za` instead.)

It prints a one-time link:

```
  Account made for Your Name (admin).
  Open this link to finish setting it up (works once, 72 hours):

  http://192.120.0.7:4310/invite.html?t=...
```

The command also prints which address it used and why. It prefers this PC's ordinary network address over a Tailscale, VPN, Docker or WSL one. If it is still not the one people use, keep everything from `/invite.html` and put the right address in front of it, for example `http://192.120.0.7:4310/invite.html?t=...`, or set it once for good: add `DK_BASE_URL=http://192.120.0.7:4310` to `.env` (or fill **Settings > Dashboard address**, which wins) and restart.

**Prefer a page to a command?** After you have entered the temporary password in Step 5, open `http://192.120.0.7:4310/setup`. It asks for the name and email of the first admin and goes straight on to the same four screens below. (On a brand-new install that has no shared password at all, the dashboard stays closed and the app prints a one-time setup link when it starts: open that instead. It works once and a new one is made at every start.)

Open it in a browser, with the person's phone at hand. You will see four things in turn:

1. **Choose a password.** At least 10 characters, typed twice. A few words together is best. It must not contain the part of the email before the `@`.
2. **Scan the QR code.** Open the authenticator app on the phone, add an account, and scan the square on the screen. If it cannot scan, type the key printed under it instead.
3. **Type the 6 digits** the app now shows, then press **Check and finish**. If it says the code did not match, wait for the next code and try again (and check the phone's clock is set to automatic).
4. **Save the 10 recovery codes.** They appear **only once**. Press **Print**, or write them down, and keep them somewhere safe. Each code signs the person in one time if the phone is lost. Then press **I have saved them, open the dashboard**.

The person is now signed in. From this moment the temporary password from Step 3 is retired, and **everyone who opens the dashboard must sign in** with their email, password and the 6-digit code. This is true for admins, managers and viewers: two-step is compulsory for all of them. The link works only once. If it was lost before step 4 was finished, run the same command again with a different email address, finish that link, and press **Reset** on the unfinished account (People page).

Operators standing at the machines do not sign in: they scan the QR code on the machine, pick their name, and log. See Step 9.

---

## Step 7. Tell it which sensor is on which machine

Every sensor runs the same file and only knows its own serial number (its MAC address). You choose the machine here.

1. Sign in, then in the dashboard open **Sensors**.
2. Each sensor that is switched on appears under **New sensors seen**, shown by its serial number.
3. Pick its machine from the dropdown next to it (**MA1** or **MA2**).

The serial number is the one `npm run check` printed in Step 4 (the part of the topic after `devices/`). From that moment the **Live floor** page shows the machine running and starts counting shots.

A sensor needs to see the mould open and close five times before it starts counting. Until then it shows `LEARNING`. That is normal.

---

## Step 8. Keep it running after a restart

So far the app stops when you close the window. Do this once so it starts with the server and restarts itself if it ever stops. First stop the running app with **Ctrl + C**.

**Windows.** Open PowerShell with **Run as administrator**, then:

```powershell
cd C:\digital-kaizen
powershell -ExecutionPolicy Bypass -File deploy\install-windows-service.ps1
```

This creates a Windows scheduled task called **Digital Kaizen** and opens port 4310 in the Windows firewall. The log is `data\digital-kaizen.log`.

**Linux.**

```bash
cd /opt/digital-kaizen
sudo bash deploy/install-linux-service.sh
```

This creates a service called `digital-kaizen`. See the log with `sudo journalctl -u digital-kaizen -f`.

Open http://192.120.0.7:4310 again to confirm it is running and asks you to sign in, then restart the server once to prove it comes back by itself.

---

## Step 9. Email, the ladder and the QR labels

**Two-step sign-in uses an authenticator app (TOTP). It needs no email and no email keys.**

To send escalation emails through Resend:

1. Create a Resend account at https://resend.com. In **Domains > Add domain**, add a subdomain such as `alerts.evernu.co.za`. This keeps the existing Microsoft 365 mail on the main domain separate.
2. At the domain's DNS host, add the exact records Resend shows: the MX and SPF TXT for its `send` host and the DKIM TXT. Press **Verify** in Resend and wait for sending to be verified. Follow the values and host names shown for your own domain.
3. In **API Keys > Create**, choose **Sending access** only and copy the key. Restrict it to the domain if offered.
4. On the server, open `.env` in the app folder with a text editor. Add the following, replacing the examples with your own verified domain and key:

```
RESEND_API_KEY=re_your_key
DK_MAIL_FROM=alerts@alerts.evernu.co.za
DK_MAIL_FROM_NAME=Digital Kaizen
```

5. Save the file and restart the service from Step 8. On Windows, open Task Scheduler, select **Digital Kaizen**, choose **End**, then **Run**. On Linux run `sudo systemctl restart digital-kaizen`.
6. Sign in as admin. Open **Settings > Email**, type your own email address under **send a test to this address**, then press **Save and send test**. Only that address receives the test. Check its inbox and the on-screen result.
7. Under **Settings > Dashboard address**, enter the dashboard address phones can reach. Under **Escalation ladder**, replace the example names and addresses with the real ones and set the issue thresholds.
8. Set the real **Moulds and ideal cycle time**, add **Operators on the QR page**, then print and laminate a QR label for each machine.

If no Resend key is set, previously configured SMTP remains the fallback. The app queues messages during a network outage and retries them.

Resend's guides: [domain verification](https://resend.com/docs/dashboard/domains/introduction) and [sending-only API keys](https://resend.com/changelog/new-api-key-permissions). Details and safe testing are in **UPDATING.md** section 3.

---

## People: add more, change a role, reset someone

Open **People** in the left menu (admins only).

- **Add a person.** Enter name, email and role, then add. The page shows a one-time link (valid 72 hours, works once). Give it to the person; they do the same four screens as in Step 6. Tick the email box to have it emailed, which works once the Step 9 email is set up.
- **Roles.** **admin**: everything, including settings, people and sensors. **manager**: sees everything, acknowledges and resolves issues, exports, retries mail. **viewer**: sees the dashboard and exports; good for a wall screen (stays signed in 30 days). Change a role with the dropdown on the row. The last working admin cannot be demoted or disabled.
- **Reset someone's sign-in** (lost phone, or forgotten password). Press **Reset** on their row and confirm. Their old password and authenticator stop working at once and they are signed out. A new one-time link appears: give it to them, and they pick a new password and scan a new QR code. That is also how a person's 2-step is re-enrolled.
- **Disable / Enable** switches a person off without deleting them. **Unlock** frees someone locked out after 5 wrong passwords (it also frees itself after 15 minutes).
- **A person with a recovery code** can sign in with it instead of the 6 digits, one use per code, and should then ask for a Reset.
- **The only admin lost the phone and the recovery codes.** On the server run `npm run reset-account -- admin@evernu.co.za` (their own email). It ends their sessions, makes the old password and authenticator useless, writes the reset to the sign-in log and prints a new one-time link (72 hours). Nothing else is touched. It refuses an email that has no account. The same command works for anyone who lost a phone.
- **Operators** are not accounts. They are names added under **Settings > Operators on the QR page**.
- Every person can change their password and make new recovery codes under **Password and two-step** in the menu at the bottom of the left bar. The **People** page also shows the recent sign-in activity.

---

## Day to day

| To do this | Do this |
|---|---|
| **See the temporary password again** | `npm run setup`. It only matters until the first admin is made (Step 6). After that, sign in with your account. |
| **Restart the app (Windows)** | Task Scheduler → **Digital Kaizen** → End, then Run |
| **Restart the app (Linux)** | `sudo systemctl restart digital-kaizen` |
| **Back up the data** | Stop the app first, then copy the whole `data` folder **and** the `.env` file. The `data` folder holds the database, the key file (`keystore.key`) that seals every 2-step secret and makes the QR codes work, and the secrets file. Losing `keystore.key` means everyone must re-enrol and every label must be reprinted. |
| **Move to a new server** | Install as above (Steps 1 to 3), then copy the old `data` folder and `.env` file across **before** the first start. Everyone keeps their account and the printed labels keep working. |
| **Update to a new version** | Read **UPDATING.md**. In short: copy `data` and `.env` aside, `git pull` and `npm install --omit=dev` (or unzip the offline zip over the old folder), `node scripts/upgrade.js --check` (a dry run on a copy that must say OK), then restart. The app backs up the database by itself before upgrading it; `node scripts/rollback.js latest` undoes an upgrade. |
| **Remove it (Windows)** | In admin PowerShell: `Unregister-ScheduledTask -TaskName "Digital Kaizen" -Confirm:$false`, then delete the folder. |
| **Remove it (Linux)** | `sudo systemctl disable --now digital-kaizen`, then delete the folder. |

**Never run `npm run reset` or `npm run seed` on the factory install.** `reset` wipes the shot history, events, downtime, logs and escalations. `seed` fills the database with invented history. They exist only for the demo. Since 1.4.1 they cannot run by accident: `reset` refuses unless you type `DELETE EVERYTHING` in a terminal (or pass `--yes-delete-everything`), and takes a backup first; `seed` refuses on a database that already holds shots unless you pass `--yes-add-demo-data`, and also backs up first.

---

## If something is wrong

**`npm run check` says the broker refused the login.**
The username or password in `.env` is not the one Mosquitto expects. Copy `MQTT_USER` and `MQTT_PASS` exactly from the sensor file into `DK_BROKER_USER` and `DK_BROKER_PASS`.

**`npm run check` says nothing is answering.**
Mosquitto is not running on this machine, or it is on another one. If Mosquitto is on a different computer, put that computer's address in `DK_BROKER_URL`, for example `mqtt://192.120.0.7:1883`.

**`npm run check` says something answers but it is not an MQTT broker.**
The address or port in `DK_BROKER_URL` belongs to another program. Check them against the sensor file.

**`npm run check` connects but hears no sensor.**
- Check that a sensor is switched on and its screen shows a reading.
- Open the sensor file and look at `MQTT_TOPIC`. The first part (before the first `/`) must be the same as `DK_TOPIC_ROOT` in `.env`. One wrong character is enough to hear nothing.

**The dashboard says a machine is OFFLINE.**
- No message has arrived from its sensor in the last 10 seconds. Run `npm run check` to see which sensors are being heard.
- If the sensor is heard but the machine is still offline, the sensor is not paired. Do Step 7.

**"Port 4310 is already used".**
Another program has that port. Change `DK_WEB_PORT` in `.env` to `4311`, restart, and use `:4311` in the address (and in Settings > Dashboard address).

**`npm start` stops with `bad option: --env-file-if-exists`, or says `node:sqlite` cannot be found.**
Node.js is too old. Install version 22.13 or newer (Step 1).

**The page opens on the server but not from other computers.**
The firewall on the server is blocking port 4310. See the end of Step 5.

**The dashboard asks for a password and mine is not accepted.**
If an admin has been made (Step 6), the temporary password no longer works: sign in with your email, password and 6-digit code. If you lost the phone, see "People".

**The one-time link says it has expired or was already used.**
It works once and for 72 hours. Ask an admin to press **Reset** on that person (People page) for a new one.

**The 6-digit code is refused.**
The phone's clock is wrong (switch it to automatic) or the code just changed: type the next one. Five wrong passwords lock the account for 15 minutes; an admin can press **Unlock**.

---

## Settings

Most settings are on the **Settings** screen of the dashboard. The file `.env` in the app folder holds the few that are needed before the dashboard is up:

| Setting | What it is | Default |
|---|---|---|
| `DK_BROKER_URL` | The MQTT broker the sensors publish to | `mqtt://127.0.0.1:1883` |
| `DK_BROKER_USER` | Login for that broker | empty |
| `DK_BROKER_PASS` | Password for that broker | empty |
| `DK_TOPIC_ROOT` | First part of the sensors' topic | `factory-demo-9f7c2a61` |
| `DK_WEB_PORT` | Port the dashboard is served on | `4310` |
| `DK_BASE_URL` | Starting value for the dashboard address in emails, invite links and QR codes, for example `http://192.120.0.7:4310` (**Settings > Dashboard address** wins) | this PC's ordinary LAN address (192.168, 10, 172.16 to 31 first; Tailscale 100.x and virtual adapters last) and the port |
| RESEND_API_KEY | Resend sending-only key, stored in .env | empty |
| DK_MAIL_FROM | Verified From address for Resend | empty |
| DK_MAIL_FROM_NAME | Sender display name for Resend | empty |
| SMTP fallback | Previously saved SMTP settings, or legacy DK_SMTP_* defaults if none saved; used without a Resend key | off |

Escalation people and timings, limits, stop reasons, defect types, moulds and operator names are on the **Settings** screen. Machine names, shift hours and downtime rules are in `src/config.js`.

---

## Try it without a factory

To see the dashboard with two simulated machines, on your own computer or on any copy of the folder that is **not** the factory install, skip `npm run setup` and run:

```
npm install
npm run demo
```

Then open http://localhost:4310. Things to know:

- This mode starts its own small MQTT broker on port 1883, so **do not use it on the factory server**, where Mosquitto already has that port. It also writes simulated data into the `data` folder of the folder you run it in, so never run it in the live install folder.
- **The demo dashboard is open: nobody is asked to sign in** until you make an admin with `npm run admin -- "Your Name" you@example.com`. The demo is the mode with the simulated machines, and /setup is off there. The start-up window says so in plain words. A real install is different: a brand-new one starts closed and needs the setup link (Step 6); an existing one is never closed by an update.
- It ignores `.env`. To use another port: `DK_WEB_PORT=4311 npm run demo` (Linux), or `$env:DK_WEB_PORT=4311; npm run demo` (PowerShell).
- To rehearse escalation emails without sending any, run `npm run mail-sink` in a second window (needs the `npm install` above), then start a separate test copy with no Resend key and no saved SMTP settings, setting DK_SMTP_HOST=127.0.0.1, DK_SMTP_PORT=1025 and DK_MAIL_FROM=test@factory.example in its environment. Read the messages at http://localhost:8025.

---

## How it fits together

```
 sensor (AtomS3 + ToF)  ──MQTT──►  Mosquitto on 192.120.0.7  ──►  Node-RED + MySQL   (existing, unchanged)
                                            │
                                            └──────────────►  Digital Kaizen       (this app, listens only)
                                                                 │
                                                                 ├─ database file in  data/
                                                                 └─ dashboard on      http://192.120.0.7:4310
```

Requires Node.js 22.13 or newer. No other software, no build step, no native modules.

For people and AI agents changing the code: **AGENTS.md** (rules) and **UPDATING.md** (data safety and release).
