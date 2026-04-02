# dmarch_relay_001

✨ Features
🌐 Smart Connectivity & Fallback System
MQTT over WSS – Secure cloud communication via HiveMQ Cloud (wss://...:8884)
Auto WiFi Fallback – Automatically switches to SoftAP mode (192.168.4.1) if WiFi fails or credentials are empty
Local Network Portal – Built-in WebServer in AP mode for offline SSID/Password configuration
Remote Network Management – Update or reset WiFi credentials directly via MQTT commands
Smart MQTT Toggle – MQTT client automatically disables in AP mode to prevent interference & save resources
⚡ Relay Control & Safety
5-Channel Independent Control – Toggle relays individually or globally (ALL ON / ALL OFF)
Sequential Startup Delay – 500ms staggered activation to prevent inrush current & power dips
4-Hour Auto-Off Safety Timer – Prevents relay burnout & accidental long-running loads
State Persistence – Relay states saved to EEPROM & restored after reboot/power loss
🛠️ System Configuration & OTA
Over-The-Air (OTA) Updates – Seamless firmware upgrades via GitHub raw links
Dynamic GPIO Remapping – Change pin assignments remotely without reflashing
NTP & Timezone Sync – Accurate real-time clock with configurable timezone & NTP servers
EEPROM Management – Safe, isolated storage for WiFi, GPIO, NTP, timezone & boot counter
🖥️ Modern Web Dashboard
Responsive Dark UI – Mobile-friendly, card-based layout with real-time status indicators
Connection-Aware Interface – Control cards automatically hide/show based on MQTT connection state
Pre-configured Auth – Broker, port, username & password pre-filled for quick deployment
Live Terminal Log – Streamed system events & MQTT messages directly in the browser
🔒 Reliability & Diagnostics
Bootloop Protection – Automatic detection & recovery after 5 consecutive failed boots
Hardware Watchdog (WDT) – ESP32/ESP8266 hardware WDT integration for crash recovery
Real-time Health Monitoring – Live RSSI signal strength, uptime, chip temperature & firmware version
Graceful Error Handling – Clean disconnects, retry logic, and detailed serial logging
📦 Hardware Support
✅ ESP32 (Generic / ESP32-S2 Mini)
✅ ESP8266 (Wemos D1 Mini / NodeMCU)
✅ Active-Low & Active-High Relay Boards (Software configurable via RELAY_ACTIVE_LOW)
