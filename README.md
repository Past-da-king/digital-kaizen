# Digital Kaizen

Live shot counting and downtime tracking for injection-moulding machines.
A distance sensor on each machine sends its readings over MQTT; this app turns them into a live dashboard, a history, and downtime events that operators explain by scanning a QR code on the machine.

This page is the **install guide for running it on the factory's own server (`192.120.0.7`)**, next to the Mosquitto broker the sensors already send to.

---

## What this install does, and what it leaves alone

| | |
|---|---|
| **Reads** | The sensor messages on the existing Mosquitto broker (port 1883). It only listens. |
| **Adds** | One program (Node.js) and one folder. The dashboard is served on port **4310**. |
| **Stores** | Its own database file in the `data` folder. No MySQL setup is needed. |
| **Does not touch** | The sensors, the sensor file, Mosquitto, Node-RED, or the MySQL database. Nothing on them changes and nothing is sent to them. |
| **Internet** | Not needed once it is installed. Everything stays inside the factory network. |

When it is running, anyone on the factory network opens **http://192.120.0.7:4310** in a browser.

---

## Before you start

You need three things:

1. **Access to the server `192.120.0.7`** with an administrator account (Windows) or `sudo` (Linux).
2. **Node.js version 22 or newer** on that server. Step 1 below installs it.
3. **The MQTT username and password the sensors use.** They are in the sensor file, on the lines `MQTT_USER` and `MQTT_PASS`. If your Mosquitto does not ask for a login, you do not need them.

The whole install takes about 15 minutes.

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
sudo mkdir -p /opt/digital-kaizen && sudo chown $USER /opt/digital-kaizen
git clone https://github.com/Past-da-king/digital-kaizen.git /opt/digital-kaizen
cd /opt/digital-kaizen
npm install --omit=dev
```

No `git`? On the GitHub page press **Code → Download ZIP**, unzip it to `C:\digital-kaizen` (or `/opt/digital-kaizen`), open a terminal in that folder and run `npm install --omit=dev`.

### Option B. The server has no internet

1. On any computer with internet, open https://github.com/Past-da-king/digital-kaizen/releases/latest and download **`digital-kaizen-offline.zip`**. It already contains everything `npm install` would fetch.
2. Copy it to the server on a USB stick.
3. Unzip it. Inside is one folder called `digital-kaizen`. Move that folder so it becomes `C:\digital-kaizen` (Windows) or `/opt/digital-kaizen` (Linux).
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

At the end it prints the **dashboard password**. Write it down. Running `npm run setup` again shows it again and never changes it.

Your answers are saved in a file called `.env` in the app folder. To change one later, open `.env` in Notepad, edit it, save, and restart the app.

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

Leave that window open. On any computer on the factory network, open:

**http://192.120.0.7:4310**

Sign in with the dashboard password from Step 3.

If the page does not open from another computer but does open on the server itself (`http://localhost:4310`), the server's firewall is blocking port 4310. Step 7 opens it on Windows. On Linux: `sudo ufw allow 4310/tcp`.

---

## Step 6. Tell it which sensor is on which machine

Every sensor runs the same file and only knows its own serial number (its MAC address). You choose the machine here.

1. In the dashboard, open **Sensors**.
2. Each sensor that is switched on appears under **New sensors seen**, shown by its serial number.
3. Pick its machine from the dropdown next to it (**MA1** or **MA2**).

The serial number is the one `npm run check` printed in Step 4 (the part of the topic after `devices/`). From that moment the **Live floor** page shows the machine running and starts counting shots.

A sensor needs to see the mould open and close five times before it starts counting. Until then it shows `LEARNING`. That is normal.

---

## Step 7. Keep it running after a restart

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

This creates a service called `digital-kaizen`. See the log with `journalctl -u digital-kaizen -f`.

Open http://192.120.0.7:4310 again to confirm it is running, then restart the server once to prove it comes back by itself.

---

## Step 8. Print the machine labels (optional)

Open **Labels** in the dashboard and print the page. Each label has a QR code for one machine. When a machine stops, the operator scans it with a phone and taps the reason. No login is needed on the phone, but the phone must be on the factory network.

Open the Labels page using the address **http://192.120.0.7:4310**, not `localhost`, because the address you use is the one printed into the QR codes.

---

## Day to day

| To do this | Do this |
|---|---|
| **See the password again** | `npm run setup` |
| **Restart the app (Windows)** | Task Scheduler → **Digital Kaizen** → End, then Run |
| **Restart the app (Linux)** | `sudo systemctl restart digital-kaizen` |
| **Back up the data** | Copy the `data` folder. It holds the database and the password. |
| **Move to a new server** | Install as above, then copy the old `data` folder and `.env` file across before starting. |
| **Update to a new version** | In the app folder: `git pull`, then `npm install --omit=dev`, then restart the app. Without internet: unzip the new offline zip over the old folder. The `data` folder and `.env` are kept. |
| **Remove it (Windows)** | In admin PowerShell: `Unregister-ScheduledTask -TaskName "Digital Kaizen" -Confirm:$false`, then delete the folder. |
| **Remove it (Linux)** | `sudo systemctl disable --now digital-kaizen`, then delete the folder. |

---

## If something is wrong

**`npm run check` says the broker refused the login.**
The username or password in `.env` is not the one Mosquitto expects. Copy `MQTT_USER` and `MQTT_PASS` exactly from the sensor file into `DK_BROKER_USER` and `DK_BROKER_PASS`.

**`npm run check` says nothing is answering.**
Mosquitto is not running on this machine, or it is on another one. If Mosquitto is on a different computer, put that computer's address in `DK_BROKER_URL`, for example `mqtt://192.120.0.7:1883`.

**`npm run check` connects but hears no sensor.**
- Check that a sensor is switched on and its screen shows a reading.
- Open the sensor file and look at `MQTT_TOPIC`. The first part (before the first `/`) must be the same as `DK_TOPIC_ROOT` in `.env`. One wrong character is enough to hear nothing.

**The dashboard says a machine is OFFLINE.**
- No message has arrived from its sensor in the last 10 seconds. Run `npm run check` to see which sensors are being heard.
- If the sensor is heard but the machine is still offline, the sensor is not paired. Do Step 6.

**"Port 4310 is already used".**
Another program has that port. Change `DK_WEB_PORT` in `.env` to `4311`, restart, and use `:4311` in the address.

**`npm start` stops with `bad option: --env-file-if-exists`, or says `node:sqlite` cannot be found.**
Node.js is too old. Install version 22.13 or newer (Step 1).

**The page opens on the server but not from other computers.**
The firewall on the server is blocking port 4310. See the end of Step 5.

---

## Settings

All settings live in the `.env` file in the app folder.

| Setting | What it is | Default |
|---|---|---|
| `DK_BROKER_URL` | The MQTT broker the sensors publish to | `mqtt://127.0.0.1:1883` |
| `DK_BROKER_USER` | Login for that broker | empty |
| `DK_BROKER_PASS` | Password for that broker | empty |
| `DK_TOPIC_ROOT` | First part of the sensors' topic | `factory-demo-9f7c2a61` |
| `DK_WEB_PORT` | Port the dashboard is served on | `4310` |
| `DK_SMTP_HOST`, `DK_SMTP_PORT`, `DK_SMTP_USER`, `DK_SMTP_PASS`, `DK_MAIL_FROM`, `DK_MAIL_TO` | Email alerts when a machine stays stopped. Leave them out to switch alerts off. Sending email needs the server to reach a mail server. | off |

Machine names, cycle times, downtime limits, shift hours and the list of stop reasons are in `src/config.js`.

---

## Try it without a factory

To see the dashboard with two simulated machines on your own computer, skip `npm run setup` and run:

```
npm install
npm run demo
```

Then open http://localhost:4310. This mode starts its own small MQTT broker on port 1883, so do not use it on the factory server, where Mosquitto already has that port.

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
