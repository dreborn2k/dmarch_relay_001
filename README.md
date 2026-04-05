# 🔌 dMarch Relay Pro

![Firmware](https://img.shields.io/badge/Firmware-v3.1.0-blue)
![Platform](https://img.shields.io/badge/Platform-ESP32%20%7C%20ESP8266%20%7C%20ESP32--S2%20%7C%20ESP32--C3-green)
![Protocol](https://img.shields.io/badge/Protocol-MQTT%20WSS-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

**Enterprise‑grade, multi‑device IoT relay controller** with cloud backup (GitHub), real‑time MQTT control, automated scheduling, and instant Telegram alerts. Designed for industrial automation, smart homes, and scalable IoT deployments.

---

## ✨ Core Features

### 🚀 Production‑Ready Multi‑Tenant Architecture
- **Single Web Panel for All Devices** – One `index.html` serves unlimited devices.
- **Device‑Isolated Data** – Each device stores its own configuration (`device.json`, `scheduler.json`) in a dedicated GitHub subfolder:  
  `RELAY/data/DmarchFF_<6‑digit MAC>/`
- **Plug‑and‑Play QR Setup** – Scan one QR code to configure MQTT broker, GitHub token, and device ID instantly. No manual typing.

### ☁️ Cloud Sync (GitHub)
- **Automatic Backup** – All relay configurations and schedules are pushed to GitHub on every change.
- **Conflict Handling** – Built‑in retry logic (up to 3 attempts) resolves 409 conflicts gracefully.
- **Pull & Restore** – Restore settings anytime with a single click – perfect for device replacement.

### ⏱️ Advanced Relay Scheduler
- **Per‑Relay Timers** – Set independent ON/OFF schedules for each relay.
- **Flexible Recurrence** – Choose any combination of days (Monday to Sunday).
- **Auto‑Execution** – Scheduler runs every 30 seconds; actions are triggered exactly on time.
- **Cloud‑Synced Schedules** – Schedules are saved to GitHub and survive device restarts.

### 📱 Instant Notifications (Telegram)
- **Real‑time Alerts** – Get notified when any relay is toggled manually, by schedule, or via ALL ON/OFF.
- **Easy Setup** – Configure bot token and chat ID directly from the web panel.
- **Test & Auto‑Detect** – Built‑in test message and automatic Chat ID detection.

### 🔧 Flexible Hardware Configuration
- **Dynamic Relay Count** – Change number of relays (1–16) from the web panel without reflashing.
- **GPIO Remapping** – Assign any available pin to each relay; input validation prevents duplicates.
- **Hardware Detection** – Automatically detects ESP32, ESP32‑S2, ESP32‑C3, and ESP8266; suggests safe default pins.
- **Safety Timer** – Each relay automatically turns off after 4 hours (configurable).

### 🌐 Network & System
- **WiFi Fallback** – Automatically enters SoftAP mode (`dMarch-Pro-Config`) if WiFi credentials fail.
- **OTA Updates** – One‑click firmware upgrade via GitHub raw links (version check + download).
- **NTP & Timezone** – Accurate real‑time clock with custom NTP server and timezone offset.
- **Remote Network Reset** – Reset WiFi credentials or switch back to AP mode via MQTT.

### 🖥️ Professional Web Dashboard
- **Accordion Cards** – Collapsible sections keep the interface clean; only one card expands at a time.
- **Real‑time Health** – Live RSSI signal, uptime, temperature, and firmware version.
- **Live Log Terminal** – Streamed system events and MQTT messages directly in the browser.
- **Responsive Dark UI** – Works on any device (mobile, tablet, desktop).
- **Vibration Feedback** – Tactile response on supported mobile browsers.

---

## 📦 Hardware & Software Requirements

| Component | Details |
|-----------|---------|
| **MCU** | ESP32, ESP32‑S2, ESP32‑C3, ESP8266 (WeMos D1 Mini) |
| **Relay Module** | Up to 16 channels (depending on hardware) |
| **Arduino IDE** | 2.x+ with ESP32/ESP8266 board support |
| **Libraries** | `PubSubClient`, `ArduinoJson` (v6/v7), `NTPClient`, `WebServer` / `ESP8266WebServer`, `HTTPClient` |
| **Cloud Services** | GitHub (free account) + MQTT broker (HiveMQ Cloud recommended) |

---

## 🛠️ Installation & First Run

### 1. Upload Firmware to Your Device
- Open `MQTT_RELAY3.ino` in Arduino IDE.
- Select your board (e.g., `ESP32‑S2 Mini`, `ESP32‑C3`, `WeMos D1 Mini`).
- Install required libraries if not already present.
- Flash the firmware.

> **Note:** On first boot, the device will start in **SoftAP mode** (WiFi network `dMarch-Pro-Config`, password `12345678`). Connect to it and open `192.168.4.1` to set your WiFi credentials.

### 2. Prepare the Web Panel on GitHub
1. Fork or clone the repository `dreborn2k/dmarchFF`.
2. Ensure the following structure exists:
3. Enable **GitHub Pages** on the `main` branch, root folder `/RELAY`.  
Your web panel will be accessible at:  
`https://<your-username>.github.io/dmarchFF/RELAY/`

### 3. Create a QR Code for Easy Setup
Generate a QR code containing the following JSON structure (replace with your actual credentials):
```json
{
"broker": "your-broker.s1.eu.hivemq.cloud",
"port": 8884,
"user": "your_mqtt_username",
"pass": "your_mqtt_password",
"device": "DmarchFF_EBCF08",    ← replace with your device's 6‑digit MAC (uppercase)
"ghOwner": "your_github_username",
"ghRepo": "dmarchFF",
"ghBasePath": "RELAY/data",
"ghToken": "github_pat_xxxxxxxx"
}

## 4. Connect and Configure

1. Open the web panel URL (from step 2.3) on your phone/computer.
2. Click **Scan QR / Upload Image** and scan the QR code you created.
3. The page will automatically:
   - Hide the setup card.
   - Connect to MQTT.
   - Enable GitHub Cloud Sync.
   - Load your device's saved configuration (if any).
4. You can now control relays, set schedules, adjust GPIO pins, and receive Telegram alerts.

---

## 📡 MQTT Topics & Commands

All topics are prefixed with your `DEVICE_ID` (e.g., `DmarchFF_A1B2C3`).

| Topic                     | Payload                                      | Description                                          |
|---------------------------|----------------------------------------------|------------------------------------------------------|
| `relay/<1..n>/cmd`        | `0` / `1`                                    | Turn relay OFF / ON                                  |
| `all/on`                  | `1`                                          | Turn ALL relays ON (sequential delay)                |
| `all/off`                 | `1`                                          | Turn ALL relays OFF (sequential delay)               |
| `system/restart`          | `1`                                          | Restart the device                                   |
| `system/ota`              | `1`                                          | Start OTA update (checks version from GitHub)        |
| `gpio/update`             | `pin1,pin2,...`                              | Remap GPIO pins (restart required)                   |
| `config/relayCount`       | `<count>`                                    | Change number of active relays (restart required)    |
| `ntp/set`                 | `pool.ntp.org`                               | Change NTP server                                    |
| `timezone/set`            | `7`                                          | Set timezone offset in hours                         |
| `network/update`          | `{"ssid":"...","pass":"..."}`                | Update WiFi credentials (restart required)           |
| `network/reset`           | `1`                                          | Clear WiFi credentials and enter AP mode             |

**The device publishes:**

- `relay/<n>/state` – current relay state (`0`/`1`)
- `status` – JSON with RSSI, uptime, temperature, firmware version, relay count, and pin mapping
- `terminal` – real‑time log messages

---

## 🔐 Security & Privacy

- **MQTT over WSS** – All communication is encrypted via WebSocket Secure.
- **GitHub Token** – Stored locally in your browser's `localStorage`; never exposed on the network.
- **Device‑Isolated Data** – Each device’s configuration lives in its own subfolder, preventing cross‑device interference.
- **No Hardcoded Secrets** – All credentials are entered via QR code or web panel; firmware contains no sensitive defaults.

---

## 🧪 Testing & Debugging

- **Web Terminal** – Open the **Event Log** card to see real‑time MQTT messages and system events.
- **Browser Console** – Press `F12` to view detailed JavaScript logs (API calls, errors, sync status).
- **Serial Monitor** – Connect to the device over USB (115200 baud) to monitor low‑level firmware logs.

---

## 📝 Changelog

### v3.1.0 (Current)
- Added multi‑tenant support (dynamic Device ID based on MAC)
- Full GitHub Cloud Sync for both device config and schedules
- Relay scheduler with weekday selection
- Telegram notifications (HTML format, avoids markdown errors)
- Dynamic relay count (1–16, hardware‑dependent)
- GPIO pin validation and duplicate detection
- Auto‑refresh throttling (10 seconds) to prevent race conditions
- Professional web dashboard with accordion cards and vibration feedback
- QR‑based one‑click setup

### v2.1.0 (Legacy)
- 5‑channel fixed relay control
- Basic MQTT with HiveMQ Cloud
- OTA updates and GPIO remapping

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a feature branch:  
   `git checkout -b feature/amazing-improvement`
3. Commit your changes:  
   `git commit -m 'Add some amazing feature'`
4. Push to the branch:  
   `git push origin feature/amazing-improvement`
5. Open a Pull Request.

For major changes, please open an issue first to discuss what you would like to change.

---

## 📄 License

This project is licensed under the **MIT License** – see the [LICENSE](LICENSE) file for details.

---

## 📞 Support & Contact

- **WhatsApp Business**: [Click to chat](https://wa.me/628551291055)
- **GitHub Issues**: [Open an issue](https://github.com/dreborn2k/dmarchFF/issues)
- **Email**: digital.reborn2k@gmail.com
