# 🔌 dMarch Relay Pro

![Firmware](https://img.shields.io/badge/Firmware-v2.1.0-blue)
![Platform](https://img.shields.io/badge/Platform-ESP32%20%7C%20ESP8266-green)
![Protocol](https://img.shields.io/badge/Protocol-MQTT%20WSS-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

Secure, cloud-connected 5-channel relay controller with automatic WiFi fallback, offline configuration portal, and real-time MQTT management. Built for ESP32/ESP8266 with a modern, responsive web dashboard.

---

## ✨ Features

### 🌐 Smart Connectivity
- **MQTT over WSS** – Secure cloud communication via HiveMQ Cloud (`wss://...:8884`)
- **Auto WiFi Fallback** – Automatically switches to SoftAP mode (`192.168.4.1`) if WiFi fails or credentials are empty
- **Local Network Portal** – Built-in WebServer in AP mode for offline SSID/Password configuration
- **Remote Network Management** – Update or reset WiFi credentials directly via MQTT commands
- **Smart MQTT Toggle** – MQTT client automatically disables in AP mode to prevent interference

### ⚡ Relay Control & Safety
- **5-Channel Independent Control** – Toggle relays individually or globally (`ALL ON` / `ALL OFF`)
- **Sequential Startup Delay** – `500ms` staggered activation to prevent inrush current
- **4-Hour Auto-Off Safety Timer** – Prevents relay burnout & accidental long-running loads
- **State Persistence** – Relay states saved to EEPROM & restored after reboot

### 🛠️ System Configuration & OTA
- **Over-The-Air (OTA) Updates** – Seamless firmware upgrades via GitHub raw links
- **Dynamic GPIO Remapping** – Change pin assignments remotely without reflashing
- **NTP & Timezone Sync** – Accurate real-time clock with configurable timezone & NTP servers
- **EEPROM Management** – Safe, isolated storage for WiFi, GPIO, NTP, timezone & boot counter

### 🖥️ Modern Web Dashboard
- **Responsive Dark UI** – Mobile-friendly, card-based layout with real-time status indicators
- **Connection-Aware Interface** – Control cards automatically hide/show based on MQTT connection state
- **Pre-configured Auth** – Broker, port, username & password pre-filled for quick deployment
- **Live Terminal Log** – Streamed system events & MQTT messages directly in the browser

### 🔒 Reliability & Diagnostics
- **Bootloop Protection** – Automatic detection & recovery after `5` consecutive failed boots
- **Hardware Watchdog (WDT)** – ESP32/ESP8266 hardware WDT integration for crash recovery
- **Real-time Health Monitoring** – Live RSSI signal strength, uptime, chip temperature & firmware version
- **Graceful Error Handling** – Clean disconnects, retry logic, and detailed serial logging

---

## 📦 Hardware & Software Requirements

| Component | Details |
|-----------|---------|
| **MCU** | ESP32 (Generic / ESP32-S2 Mini) or ESP8266 (Wemos D1 Mini) |
| **Relay Module** | 5-Channel (Active-Low or Active-High configurable) |
| **Arduino IDE** | 2.x+ with ESP32/ESP8266 board support |
| **Libraries** | `PubSubClient`, `ArduinoJson` (v7), `NTPClient`, `WebServer` / `ESP8266WebServer`, `HTTPClient` / `ESP8266HTTPClient` |

---

## 🛠️ Installation

1. **Install Libraries** via Arduino Library Manager:
   - `PubSubClient`
   - `ArduinoJson`
   - `NTPClient`
2. **Configure Credentials** in `MQTT_RELAY1.ino`:
   ```cpp
   const char* WIFI_SSID_DEF     = ""; // Leave empty to force AP mode on first boot
   const char* WIFI_PASSWORD_DEF = "";
   const char* MQTT_BROKER       = "your-broker.hivemq.cloud";
   const int MQTT_PORT           = 8883;
   const char* MQTT_USER         = "your-username";
   const char* MQTT_PASS         = "your-password";
