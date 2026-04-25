// ==========================================
// dMarch Relay Pro - Firmware v6.0 (FULL SECURE)
// HMAC + Nonce + Rate Limiting + QR SoftAP
// Emergency Force AP (tanpa HMAC via MQTT)
// ==========================================

#define FW_VERSION "6.0.0"
#define EEPROM_SIZE 1024
#define EEPROM_SECRET_START 600  // 64 bytes
#define EEPROM_SECRET_FLAG 664   // 1 byte, 0xAA jika sudah ada secret

#include <EEPROM.h>
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>
#include "qrcode_js.h"
#include "offline_web.h"

// ========== DETEKSI HARDWARE ==========
#if defined(ARDUINO_USB_CDC_ON_BOOT) || defined(ARDUINO_ESP32S2_DEV)
#define HW_TYPE "ESP32S2_MINI"
#elif defined(CONFIG_IDF_TARGET_ESP32C3)
#define HW_TYPE "ESP32C3_SUPERMINI"
#elif defined(ESP32)
#define HW_TYPE "ESP32_GENERIC"
#elif defined(ESP8266)
#define HW_TYPE "WEMOS_D1_MINI"
#endif

// ========== KONFIGURASI MQTT (default) ==========
const char* MQTT_BROKER = "ddac82518d464650bbfe8e03922a3ca8.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;
const char* MQTT_USER = "dmarchFF";
const char* MQTT_PASS = "dmarchFF2205";

// ========== KONFIGURASI GITHUB ==========
const char* GH_OWNER = "dreborn2k";
const char* GH_REPO = "dmarchFF";
const char* GH_BASE_PATH = "RELAY/data";
const char* GH_TOKEN = "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";  // GANTI DENGAN TOKEN ASLI ANDA

String DEVICE_ID = "";
String deviceSecret = "";

// ========== RATE LIMITING ==========
struct FailedAttempt {
  unsigned long timestamp;
  int count;
};
FailedAttempt failedHmac = { 0, 0 };
unsigned long blockUntil = 0;
const int MAX_FAILED_ATTEMPTS = 5;
const unsigned long FAILED_WINDOW_MS = 30000;
const unsigned long BLOCK_DURATION_MS = 60000;

// ========== NONCE RING BUFFER ==========
#define NONCE_BUFFER_SIZE 16
String nonceBuffer[NONCE_BUFFER_SIZE];
int nonceIndex = 0;

// ========== TIMEZONE OFFSET ==========
int timezoneOffset = 7 * 3600;  // default UTC+7

// ========== LIBRARY & GLOBAL ==========
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WebServer.h>
#include <esp_mac.h>
WebServer server(80);

// EEPROM addresses
#define EEPROM_STATE_START 0
#define EEPROM_GPIO_START 10
#define EEPROM_TZ_START 24
#define EEPROM_NTP_SERVER 30
#define EEPROM_WIFI_SSID_START 70
#define EEPROM_WIFI_PASS_START 103
#define EEPROM_WIFI_LIST_START 200
#define EEPROM_WIFI_PASS_LIST_START 350
#define EEPROM_OTA_STATUS 510
#define EEPROM_BOOT_COUNT 520
#define EEPROM_RELAY_COUNT 540
#define MAX_SAVED_SSID 3
#define SSID_STORAGE_SIZE 32
#define PASS_STORAGE_SIZE 64

int relayCount = 5;
int* pinRelay = nullptr;
String relayLabels[16];
bool allOnProcessing = false;
unsigned long* relayStartTime = nullptr;
const unsigned long MAX_RUNTIME = 14400000;
const int SEQUENTIAL_DELAY = 500;

bool apModeInitialized = false;
bool isApMode = false;
String savedWifiSsid = "";
String savedWifiPass = "";
String savedWifiList[3];
String savedWifiPassList[3];
int savedWifiCount = 0;

// Untuk reconnect non-blocking saat mode AP
enum WifiReconnectState {
  WIFI_RECONNECT_IDLE,
  WIFI_RECONNECT_SCANNING,
  WIFI_RECONNECT_CONNECTING,
  WIFI_RECONNECT_SUCCESS,
  WIFI_RECONNECT_FAIL
};
WifiReconnectState wifiReconnectState = WIFI_RECONNECT_IDLE;
int currentSsidIndex = 0;
unsigned long reconnectStartTime = 0;
String targetSsid = "";
String targetPass = "";
unsigned long lastApWifiCheck = 0;
const unsigned long AP_WIFI_CHECK_INTERVAL = 30000; // cek setiap 30 detik

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "id.pool.ntp.org", 25200);
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

int internetFailCount = 0;
const int MAX_INTERNET_FAIL = 5;
unsigned long lastInternetCheck = 0;
const unsigned long INTERNET_CHECK_INTERVAL = 30000;
bool isCheckingFallback = false;
unsigned long lastWifiReconnect = 0;
const unsigned long WIFI_RECONNECT_DELAY = 5000;
bool setupComplete = false;

// ========== DEKLARASI FUNGSI ==========
void sendLog(String msg, bool publish = true);
void enterAPMode();
void loadSavedWifiList();
void saveWifiCredentials(const String& s, const String& p);
void resetBootCounter();
void addToSavedWifiList(String ssid, String pass);
void saveRelayCount(int count);
void controlRelay(int rNum, int state, bool save = true);
void publishSystemHealth();
void scanWiFiNetworks();
void performOTA();
void connectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void clearCorruptedWiFiData();
void loadWifiCredentials();
void loadRelayCount();
void checkBootLoop();
void resetSecretAndRestart();
void serveQRPage();
void setupWebServer();
void forceAPMode();

// ========== FUNGSI DASAR ==========
int getMaxRelayForHardware() {
#if defined(ESP8266)
  return 6;
#elif defined(ESP32) && !defined(CONFIG_IDF_TARGET_ESP32S2) && !defined(CONFIG_IDF_TARGET_ESP32C3)
  return 12;
#elif defined(CONFIG_IDF_TARGET_ESP32S2)
  return 16;
#elif defined(CONFIG_IDF_TARGET_ESP32C3)
  return 10;
#else
  return 5;
#endif
}

const int* getDefaultPins() {
  static const int pinsESP8266[] = { 5, 4, 14, 12, 13, 15 };
  static const int pinsESP32[] = { 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25 };
  static const int pinsESP32S2[] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
  static const int pinsESP32C3[] = { 0, 1, 3, 4, 5, 6, 7, 10, 18, 19 };
#if defined(ESP8266)
  return pinsESP8266;
#elif defined(ESP32) && !defined(CONFIG_IDF_TARGET_ESP32S2) && !defined(CONFIG_IDF_TARGET_ESP32C3)
  return pinsESP32;
#elif defined(CONFIG_IDF_TARGET_ESP32S2)
  return pinsESP32S2;
#elif defined(CONFIG_IDF_TARGET_ESP32C3)
  return pinsESP32C3;
#else
  return pinsESP32;
#endif
}

String generateDeviceId() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char macStr[7];
  snprintf(macStr, sizeof(macStr), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  return "DmarchFF_" + String(macStr);
}

// ========== GENERATE SECRET ==========
String generateRandomSecret() {
  char secret[65];
  for (int i = 0; i < 32; i++) {
    byte b = esp_random() & 0xFF;
    sprintf(&secret[i * 2], "%02x", b);
  }
  return String(secret);
}

void checkWifiWhileInApMode() {
  if (!isApMode) return;

  switch (wifiReconnectState) {
    case WIFI_RECONNECT_IDLE:
      if (millis() - lastApWifiCheck >= AP_WIFI_CHECK_INTERVAL) {
        lastApWifiCheck = millis();
        loadSavedWifiList();
        if (savedWifiCount > 0) {
          currentSsidIndex = 0;
          wifiReconnectState = WIFI_RECONNECT_SCANNING;
          // Mode AP+STA agar bisa scan tanpa matikan AP
          WiFi.mode(WIFI_AP_STA);
          // Mulai scan async
          WiFi.scanNetworks(true);
          reconnectStartTime = millis();
        }
      }
      break;

    case WIFI_RECONNECT_SCANNING: {
      int scanResult = WiFi.scanComplete();
      if (scanResult == WIFI_SCAN_RUNNING) {
        if (millis() - reconnectStartTime > 10000) {
          WiFi.scanDelete();
          wifiReconnectState = WIFI_RECONNECT_IDLE;
          WiFi.mode(WIFI_AP);
        }
        break;
      }
      if (scanResult > 0) {
        // Cari SSID yang cocok dengan daftar tersimpan
        int foundIndex = -1;
        for (int i = 0; i < scanResult; i++) {
          String ssid = WiFi.SSID(i);
          for (int j = 0; j < savedWifiCount; j++) {
            if (ssid == savedWifiList[j]) {
              foundIndex = j;
              break;
            }
          }
          if (foundIndex != -1) break;
        }
        WiFi.scanDelete();
        if (foundIndex != -1) {
          targetSsid = savedWifiList[foundIndex];
          targetPass = savedWifiPassList[foundIndex];
          WiFi.mode(WIFI_STA);
          WiFi.begin(targetSsid.c_str(), targetPass.c_str());
          wifiReconnectState = WIFI_RECONNECT_CONNECTING;
          reconnectStartTime = millis();
        } else {
          wifiReconnectState = WIFI_RECONNECT_IDLE;
          WiFi.mode(WIFI_AP);
        }
      } else {
        WiFi.scanDelete();
        wifiReconnectState = WIFI_RECONNECT_IDLE;
        WiFi.mode(WIFI_AP);
      }
      break;
    }

    case WIFI_RECONNECT_CONNECTING:
      if (WiFi.status() == WL_CONNECTED) {
        wifiReconnectState = WIFI_RECONNECT_SUCCESS;
      } else if (millis() - reconnectStartTime > 15000) {
        WiFi.disconnect();
        WiFi.mode(WIFI_AP);
        wifiReconnectState = WIFI_RECONNECT_IDLE;
      }
      break;

    case WIFI_RECONNECT_SUCCESS:
      saveWifiCredentials(targetSsid, targetPass);
      Serial.println("WiFi reconnected from AP mode, restarting...");
      delay(500);
      ESP.restart();
      break;

    case WIFI_RECONNECT_FAIL:
      wifiReconnectState = WIFI_RECONNECT_IDLE;
      break;
  }
}

void loadOrCreateSecret() {
  byte flag = EEPROM.read(EEPROM_SECRET_FLAG);
  if (flag == 0xAA) {
    char stored[65] = { 0 };
    for (int i = 0; i < 64; i++) {
      stored[i] = EEPROM.read(EEPROM_SECRET_START + i);
    }
    deviceSecret = String(stored);
    Serial.println("Secret loaded from EEPROM");
  } else {
    deviceSecret = generateRandomSecret();
    for (int i = 0; i < 64; i++) {
      EEPROM.write(EEPROM_SECRET_START + i, deviceSecret[i]);
    }
    EEPROM.write(EEPROM_SECRET_FLAG, 0xAA);
    EEPROM.commit();
    Serial.println("New secret generated and saved");
  }
}

void resetSecretAndRestart() {
  EEPROM.write(EEPROM_SECRET_FLAG, 0);
  for (int i = 0; i < 64; i++) {
    EEPROM.write(EEPROM_SECRET_START + i, 0);
  }
  EEPROM.commit();
  Serial.println("Secret reset, restarting...");
  delay(500);
  ESP.restart();
}

// ========== FORCE AP MODE (tanpa hapus secret) ==========
void forceAPMode() {
  // Hapus semua kredensial WiFi
  for (int i = 0; i < 32; i++) {
    EEPROM.write(EEPROM_WIFI_SSID_START + i, 0);
    EEPROM.write(EEPROM_WIFI_PASS_START + i, 0);
  }
  for (int idx = 0; idx < MAX_SAVED_SSID; idx++) {
    int offset = EEPROM_WIFI_LIST_START + (idx * SSID_STORAGE_SIZE);
    for (int i = 0; i < SSID_STORAGE_SIZE; i++) EEPROM.write(offset + i, 0);
    int passOffset = EEPROM_WIFI_PASS_LIST_START + (idx * PASS_STORAGE_SIZE);
    for (int i = 0; i < PASS_STORAGE_SIZE; i++) EEPROM.write(passOffset + i, 0);
  }
  // Jangan hapus secret flag, agar tetap bisa pairing setelah restart
  EEPROM.commit();
  sendLog("Force AP mode via MQTT, restarting...");
  delay(500);
  ESP.restart();
}

// ========== HMAC ==========
String hmac_sha256(String message, String secret) {
  byte hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;
  const size_t payloadLength = message.length();
  const size_t keyLength = secret.length();

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)secret.c_str(), keyLength);
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)message.c_str(), payloadLength);
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  char buf[65];
  for (int i = 0; i < 32; i++) {
    sprintf(buf + i * 2, "%02x", hmacResult[i]);
  }
  return String(buf);
}

// ========== NONCE MANAGEMENT ==========
bool isNonceUsed(String nonce) {
  for (int i = 0; i < NONCE_BUFFER_SIZE; i++) {
    if (nonceBuffer[i] == nonce) return true;
  }
  return false;
}

void storeNonce(String nonce) {
  nonceBuffer[nonceIndex] = nonce;
  nonceIndex = (nonceIndex + 1) % NONCE_BUFFER_SIZE;
}

// ========== RATE LIMITING ==========
bool isHmacBlocked() {
  if (millis() < blockUntil) return true;
  if (millis() - failedHmac.timestamp > FAILED_WINDOW_MS) {
    failedHmac.count = 0;
  }
  return false;
}

void recordHmacFailure() {
  if (millis() - failedHmac.timestamp > FAILED_WINDOW_MS) {
    failedHmac.count = 1;
    failedHmac.timestamp = millis();
  } else {
    failedHmac.count++;
    if (failedHmac.count >= MAX_FAILED_ATTEMPTS) {
      blockUntil = millis() + BLOCK_DURATION_MS;
      sendLog("Too many HMAC failures, blocking commands for 60s");
    }
  }
}

// ========== VERIFIKASI COMMAND ==========
bool verifySecureCommand(String message) {
  if (isHmacBlocked()) {
    sendLog("Command blocked due to rate limiting");
    return false;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, message);
  if (error) {
    sendLog("Invalid JSON");
    recordHmacFailure();
    return false;
  }

  String nonce = doc["nonce"].as<String>();
  unsigned long timestamp = doc["timestamp"] | 0;
  String sig = doc["sig"].as<String>();

  if (nonce.length() == 0 || isNonceUsed(nonce)) {
    sendLog("Replay attack detected (nonce reused)");
    recordHmacFailure();
    return false;
  }

  timeClient.update();
  unsigned long nowUTC = timeClient.getEpochTime() - timezoneOffset;
  long diff = (long)(nowUTC - timestamp);

  String diffLog = "Timestamp diff (UTC): " + String(diff) + "s (ESP_UTC=" + String(nowUTC) + ", web=" + String(timestamp) + ")";
  sendLog(diffLog);

  if (abs(diff) > 60) {
    sendLog("Invalid timestamp (skew too large)");
    recordHmacFailure();
    return false;
  }

  JsonDocument cleanDoc;
  for (JsonPair kv : doc.as<JsonObject>()) {
    if (String(kv.key().c_str()) != "sig") {
      cleanDoc[kv.key().c_str()] = kv.value();
    }
  }
  String cleanPayload;
  serializeJson(cleanDoc, cleanPayload);

  String expectedSig = hmac_sha256(cleanPayload, deviceSecret);
  if (expectedSig.equals(sig)) {
    storeNonce(nonce);
    failedHmac.count = 0;
    return true;
  } else {
    sendLog("Invalid HMAC signature");
    recordHmacFailure();
    return false;
  }
}

// ========== CONTROL RELAY ==========
void controlRelay(int rNum, int state, bool save) {
  int idx = rNum - 1;
  if (idx < 0 || idx >= relayCount) return;
  int currentState = EEPROM.read(idx);
  if (currentState == 255) currentState = 0;
  if (state != currentState) {
    bool activeLow = false;
    int phys = activeLow ? (state == 1 ? LOW : HIGH) : (state == 1 ? HIGH : LOW);
    digitalWrite(pinRelay[idx], phys);
    if (state == 1) relayStartTime[idx] = millis();
    if (save) {
      EEPROM.write(idx, state);
      EEPROM.commit();
    }
    if (!isApMode && mqttClient.connected()) {
      mqttClient.publish((DEVICE_ID + "/relay/" + String(rNum) + "/state").c_str(), String(state).c_str(), true);
    }
    Serial.printf("Relay %d changed from %d to %d\n", rNum, currentState, state);
  }
}

// ========== LOG ==========
void sendLog(String msg, bool publish) {
  if (!isApMode) timeClient.update();
  String fMsg = "[" + (isApMode ? "AP" : timeClient.getFormattedTime()) + "] " + msg;
  Serial.println(fMsg);
  if (publish && !isApMode && mqttClient.connected()) {
    mqttClient.publish((DEVICE_ID + "/terminal").c_str(), fMsg.c_str(), true);
  }
}

// ========== SYSTEM HEALTH ==========
String getUptime() {
  unsigned long totalSeconds = millis() / 1000;
  char buf[12];
  sprintf(buf, "%02d:%02d:%02d", totalSeconds / 3600, (totalSeconds % 3600) / 60, totalSeconds % 60);
  return String(buf);
}

void publishSystemHealth() {
  if (isApMode || !mqttClient.connected()) return;

  JsonDocument doc;
  doc["rssi"] = constrain(map(WiFi.RSSI(), -100, -40, 0, 100), 0, 100);
  doc["uptime"] = getUptime();
  doc["temp"] = (int)((temperatureRead() - 32) * 5.0 / 9.0);
  doc["fw_version"] = FW_VERSION;
  doc["hw_type"] = HW_TYPE;
  doc["max_relay"] = getMaxRelayForHardware();
  doc["relay_count"] = relayCount;
  doc["device_id"] = DEVICE_ID;

  if (WiFi.status() == WL_CONNECTED) {
    doc["wifi_status"] = "Online";
    doc["connected_ssid"] = WiFi.SSID();
  } else {
    doc["wifi_status"] = "Offline";
  }

  // --- RELAY PINS (pastikan tidak kosong) ---
  String pinStr = "";
  for (int i = 0; i < relayCount; i++) {
    if (i > 0) pinStr += ",";
    pinStr += String(pinRelay[i]);
  }
  doc["relay_pins"] = pinStr.length() ? pinStr : "--";

  // --- RELAY STATES (baca dari EEPROM, bukan digitalRead agar konsisten) ---
  JsonArray states = doc["relay_states"].to<JsonArray>();
  for (int i = 0; i < relayCount; i++) {
    int state = EEPROM.read(i);          // gunakan state tersimpan
    if (state == 255) state = 0;
    states.add(state);
  }

  String payload;
  serializeJson(doc, payload);
  
  // Tambahkan pengecekan payload sebelum publish
  if (payload.length() == 0 || payload[0] != '{') {
    Serial.println("❌ Invalid JSON payload, abort publish");
    return;
  }
  
  Serial.println("📤 Publishing status: " + payload);
  mqttClient.publish((DEVICE_ID + "/status").c_str(), payload.c_str(), true);
}

// ========== SCAN WIFI ==========
void scanWiFiNetworks() {
  sendLog("Scanning WiFi networks...");
  wifi_mode_t currentMode = WiFi.getMode();
  if (currentMode != WIFI_STA) {
    WiFi.mode(WIFI_STA);
    delay(200);
  }
  int n = WiFi.scanNetworks();
  if (n == 0) {
    sendLog("No WiFi networks found");
    if (!isApMode && mqttClient.connected()) {
      mqttClient.publish((DEVICE_ID + "/wifi/scan_result").c_str(), "[]");
    }
    if (currentMode != WIFI_STA) WiFi.mode(currentMode);
    return;
  }
  int maxNetworks = min(n, 20);
  JsonDocument doc;
  JsonArray networks = doc.to<JsonArray>();
  for (int i = 0; i < maxNetworks; i++) {
    JsonObject net = networks.add<JsonObject>();
    net["ssid"] = WiFi.SSID(i);
    net["rssi"] = WiFi.RSSI(i);
    net["encryption"] = WiFi.encryptionType(i);
  }
  String output;
  serializeJson(doc, output);
  String logMsg = "Found " + String(n) + " networks, sending " + String(maxNetworks);
  sendLog(logMsg);
  if (!isApMode && mqttClient.connected()) {
    mqttClient.publish((DEVICE_ID + "/wifi/scan_result").c_str(), output.c_str(), true);
  }
  WiFi.scanDelete();
  if (currentMode != WIFI_STA) WiFi.mode(currentMode);
}

// ========== INTERNET CHECK & FALLBACK ==========
bool isInternetAvailable() {
  HTTPClient http;
  http.setTimeout(5000);
  http.begin("http://captive.apple.com/hotspot-detect.html");
  int httpCode = http.GET();
  http.end();
  return (httpCode == 200);
}

bool tryConnectToSSID(String ssid, String password) {
  if (ssid.length() < 2) return false;
  sendLog("Trying SSID: " + ssid);
  WiFi.begin(ssid.c_str(), password.c_str());
  unsigned long startTime = millis();
  const unsigned long CONNECTION_TIMEOUT = 7000;
  while (WiFi.status() != WL_CONNECTED && (millis() - startTime) < CONNECTION_TIMEOUT) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    sendLog("Connected to: " + ssid + " | IP: " + WiFi.localIP().toString());
    return true;
  }
  sendLog("Failed to connect: " + ssid);
  return false;
}

void attemptFallbackToSavedSSIDs() {
  if (isCheckingFallback) return;
  isCheckingFallback = true;
  sendLog("Attempting fallback to saved SSIDs...");
  loadSavedWifiList();
  if (savedWifiCount == 0) {
    sendLog("No valid saved SSIDs found. Entering AP mode...");
    isCheckingFallback = false;
    enterAPMode();
    return;
  }
  for (int i = 0; i < savedWifiCount; i++) {
    String ssid = savedWifiList[i];
    String password = savedWifiPassList[i];
    if (ssid.length() < 2) continue;
    if (tryConnectToSSID(ssid, password)) {
      savedWifiSsid = ssid;
      savedWifiPass = password;
      saveWifiCredentials(ssid, password);
      isCheckingFallback = false;
      internetFailCount = 0;
      resetBootCounter();
      return;
    }
  }
  sendLog("All saved SSIDs failed, entering AP mode...");
  isCheckingFallback = false;
  enterAPMode();
}

void checkInternetAndFallback() {
  if (isApMode) return;
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastWifiReconnect >= WIFI_RECONNECT_DELAY) {
      lastWifiReconnect = now;
      sendLog("WiFi disconnected, reconnecting to: " + savedWifiSsid);
      WiFi.reconnect();
      delay(3000);
      if (WiFi.status() != WL_CONNECTED) {
        attemptFallbackToSavedSSIDs();
      }
    }
    return;
  }
  unsigned long now = millis();
  if (now - lastInternetCheck < INTERNET_CHECK_INTERVAL) return;
  lastInternetCheck = now;
  if (isInternetAvailable()) {
    if (internetFailCount > 0) {
      internetFailCount = 0;
      sendLog("Internet connection restored");
    }
  } else {
    internetFailCount++;
    String logMsg = "Internet check failed: " + String(internetFailCount) + "/" + String(MAX_INTERNET_FAIL);
    sendLog(logMsg);
    if (internetFailCount >= MAX_INTERNET_FAIL) {
      sendLog("No internet, trying fallback SSIDs...");
      attemptFallbackToSavedSSIDs();
    }
  }
}

// ========== HALAMAN WIFI SETUP (SoftAP) ==========
const char wifi_setup_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>dMarch WiFi Setup</title>
    <style>
        body { background:#0f172a; color:#e2e8f0; font-family: sans-serif; padding: 20px; }
        .card { background:#1e293b; border-radius: 16px; padding: 20px; max-width: 500px; margin: auto; }
        input, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: none; }
        input { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; }
        button { background: #38bdf8; color: #000; font-weight: bold; cursor: pointer; }
        .wifi-list { margin-top: 15px; max-height: 250px; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; }
        .wifi-item { padding: 10px; border-bottom: 1px solid #334155; cursor: pointer; }
        .wifi-item:hover { background: #334155; }
        .info { font-size: 0.8rem; color: #94a3b8; margin-top: 10px; }
        hr { border-color: #334155; }
    </style>
</head>
<body>
    <div class="card">
        <h2>📡 WiFi Configuration</h2>
        <input type="text" id="ssid" placeholder="WiFi SSID">
        <input type="password" id="password" placeholder="Password">
        <div style="display: flex; gap: 10px;">
            <button id="scanBtn">📡 Scan Networks</button>
            <button id="updateBtn">💾 Update & Restart</button>
        </div>
        <div id="scanResult" class="wifi-list" style="display: none;"></div>
        <div class="info">
            <p>After update, device will restart and connect to selected WiFi.</p>
            <p>Then access QR code at <a href="/qr">/qr</a> for pairing.</p>
        </div>
        <hr>
        <button onclick="location.href='/force_ap'" style="background:#ef4444; color:white; margin-top:10px;">⚠️ Emergency Force AP (Reset All)</button>
    </div>
    <script>
        document.getElementById('scanBtn').onclick = async () => {
            const resultDiv = document.getElementById('scanResult');
            resultDiv.innerHTML = '<div style="text-align:center; padding:10px;">Scanning...</div>';
            resultDiv.style.display = 'block';
            try {
                const res = await fetch('/scan');
                const networks = await res.json();
                if (networks.length === 0) {
                    resultDiv.innerHTML = '<div style="padding:10px;">No networks found</div>';
                    return;
                }
                let html = '';
                networks.forEach(net => {
                    html += `<div class="wifi-item" data-ssid="${net.ssid}">${net.ssid} (${net.rssi} dBm)</div>`;
                });
                resultDiv.innerHTML = html;
                document.querySelectorAll('.wifi-item').forEach(item => {
                    item.onclick = () => {
                        document.getElementById('ssid').value = item.getAttribute('data-ssid');
                        resultDiv.style.display = 'none';
                    };
                });
            } catch(e) {
                resultDiv.innerHTML = '<div style="padding:10px;">Scan failed</div>';
            }
        };
        document.getElementById('updateBtn').onclick = async () => {
            const ssid = document.getElementById('ssid').value.trim();
            const pass = document.getElementById('password').value;
            if (!ssid) return alert('SSID required');
            const res = await fetch('/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ssid, pass })
            });
            const msg = await res.text();
            alert(msg);
            if (res.ok) setTimeout(() => location.reload(), 2000);
        };
    </script>
</body>
</html>
)rawliteral";

// ========== SOFTAP QR PAGE ==========
const char qr_page_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>dMarch Device Setup</title>
    <style>
        body { background:#0f172a; color:#e2e8f0; font-family: sans-serif; padding: 20px; text-align: center; }
        .card { background:#1e293b; border-radius: 16px; padding: 20px; max-width: 400px; margin: auto; }
        #qrcode { display: flex; justify-content: center; margin: 20px 0; }
        canvas { border: 2px solid #38bdf8; border-radius: 12px; padding: 8px; background: white; }
        button { background: #38bdf8; color: #000; border: none; padding: 12px 24px; border-radius: 24px; font-weight: bold; cursor: pointer; margin-top: 12px; }
        .info { font-size: 0.8rem; color: #94a3b8; word-break: break-all; }
    </style>
    <script src="/qrcode.js"></script>
</head>
<body>
    <div class="card">
        <h2>🔐 Device Pairing</h2>
        <p>Scan QR code below using dMarch web panel to add this device.</p>
        <div id="qrcode"></div>
        <button id="downloadBtn">📥 Download QR (PNG)</button>
        <p class="info">Device ID: {{DEVICE_ID}}<br>Secret: {{SECRET_SHORT}}...</p>
        <button onclick="location.href='/reset'">⚠️ Reset Secret (Factory Reset)</button>
        <button onclick="location.href='/force_ap'" style="background:#ef4444; color:white; margin-top:5px;">🚨 Emergency Force AP</button>
    </div>
    <script>
        const config = {
            broker: "{{MQTT_BROKER}}",
            port: {{MQTT_PORT}},
            user: "{{MQTT_USER}}",
            pass: "{{MQTT_PASS}}",
            device: "{{DEVICE_ID}}",
            ghOwner: "{{GH_OWNER}}",
            ghRepo: "{{GH_REPO}}",
            ghBasePath: "{{GH_BASE_PATH}}",
            ghToken: "{{GH_TOKEN}}",
            secret: "{{SECRET}}"
        };
        const jsonStr = JSON.stringify(config);
        const qr = qrcode(0, 'M');
        qr.addData(jsonStr);
        qr.make();
        const cellSize = 4;
        const margin = 2;
        const size = qr.getModuleCount() * cellSize + margin * 2;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000000';
        for (let row = 0; row < qr.getModuleCount(); row++) {
            for (let col = 0; col < qr.getModuleCount(); col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect(col * cellSize + margin, row * cellSize + margin, cellSize, cellSize);
                }
            }
        }
        document.getElementById('qrcode').appendChild(canvas);
        document.getElementById('downloadBtn').addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = 'dMarch_' + config.device + '_qrcode.png';
            link.href = canvas.toDataURL();
            link.click();
        });
    </script>
</body>
</html>
)rawliteral";

void serveQRPage() {
  String html = String(qr_page_html);
  html.replace("{{DEVICE_ID}}", DEVICE_ID);
  html.replace("{{SECRET}}", deviceSecret);
  html.replace("{{SECRET_SHORT}}", deviceSecret.substring(0, 8));
  html.replace("{{MQTT_BROKER}}", MQTT_BROKER);
  html.replace("{{MQTT_PORT}}", String(MQTT_PORT));
  html.replace("{{MQTT_USER}}", MQTT_USER);
  html.replace("{{MQTT_PASS}}", MQTT_PASS);
  html.replace("{{GH_OWNER}}", GH_OWNER);
  html.replace("{{GH_REPO}}", GH_REPO);
  html.replace("{{GH_BASE_PATH}}", GH_BASE_PATH);
  html.replace("{{GH_TOKEN}}", GH_TOKEN);
  server.send(200, "text/html", html);
}

void setupWebServer() {
  // Halaman utama: offline control panel (lengkap)
  server.on("/api/ota", HTTP_GET, []() {
    performOTA();
    server.send(200, "text/plain", "OTA started");
  });
  server.on("/api/restart", HTTP_GET, []() {
    server.send(200, "text/plain", "Restarting...");
    delay(500);
    ESP.restart();
  });

  server.on("/", HTTP_GET, []() {
    server.send_P(200, "text/html", offline_html);
  });

  // Opsional: halaman setup WiFi sederhana (bisa diakses via /setup)
  server.on("/setup", HTTP_GET, []() {
    server.send_P(200, "text/html", wifi_setup_html);
  });

  // Endpoint untuk file qrcode.js (library QR)
  server.on("/qrcode.js", HTTP_GET, []() {
    server.send_P(200, "application/javascript", (const char*)qrcode_js, qrcode_js_len);
  });

  // Endpoint scan WiFi (return JSON)
  server.on("/scan", HTTP_GET, []() {
    wifi_mode_t currentMode = WiFi.getMode();
    WiFi.mode(WIFI_AP_STA);
    delay(100);
    int n = WiFi.scanNetworks();
    String json = "[";
    for (int i = 0; i < n; i++) {
      if (i > 0) json += ",";
      json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
    }
    json += "]";
    WiFi.scanDelete();
    WiFi.mode(WIFI_AP);
    server.send(200, "application/json", json);
  });

  // Endpoint update WiFi (POST)
  server.on("/update", HTTP_POST, []() {
    String body = server.arg("plain");
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    if (error) {
      server.send(400, "text/plain", "Invalid JSON");
      return;
    }
    String ssid = doc["ssid"].as<String>();
    String pass = doc["pass"].as<String>();
    if (ssid.length() < 2) {
      server.send(400, "text/plain", "SSID too short");
      return;
    }
    saveWifiCredentials(ssid, pass);
    server.send(200, "text/plain", "Credentials saved. Restarting...");
    delay(500);
    ESP.restart();
  });

  // Emergency Force AP (tanpa autentikasi)
  server.on("/force_ap", HTTP_GET, []() {
    forceAPMode();
  });

  // Reset secret (factory reset)
  server.on("/reset", HTTP_GET, []() {
    resetSecretAndRestart();
  });

  // ===== API untuk halaman offline =====
  server.on("/api/status", HTTP_GET, []() {
    JsonDocument doc;
    doc["relay_count"] = relayCount;
    String pinStr = "";
    for (int i = 0; i < relayCount; i++) {
      pinStr += String(pinRelay[i]);
      if (i + 1 < relayCount) pinStr += ",";
    }
    doc["relay_pins"] = pinStr;
    JsonArray states = doc["relay_states"].to<JsonArray>();
    for (int i = 0; i < relayCount; i++) {
      states.add(EEPROM.read(i) == 1 ? 1 : 0);
    }
    doc["hw_type"] = HW_TYPE;
    doc["max_relay"] = getMaxRelayForHardware();
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
  });

  server.on("/api/relay", HTTP_GET, []() {
    if (server.hasArg("num") && server.hasArg("state")) {
      int num = server.arg("num").toInt();
      int state = server.arg("state").toInt();
      if (num >= 1 && num <= relayCount) {
        controlRelay(num, state, true);
        server.send(200, "text/plain", "OK");
      } else {
        server.send(400, "text/plain", "Invalid relay number");
      }
    } else {
      server.send(400, "text/plain", "Missing parameters");
    }
  });

  server.on("/api/config", HTTP_POST, []() {
    String body = server.arg("plain");
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);
    if (error) {
      server.send(400, "text/plain", "Invalid JSON");
      return;
    }
    if (doc.containsKey("relayCount")) {
      int newCount = doc["relayCount"];
      saveRelayCount(newCount);
    }
    if (doc.containsKey("gpio")) {
      String pins = doc["gpio"].as<String>();
      int rIdx = 0, lastC = 0;
      for (int i = 0; i <= pins.length(); i++) {
        if (i == pins.length() || pins.charAt(i) == ',') {
          String seg = pins.substring(lastC, i);
          seg.trim();
          if (seg.length() > 0 && rIdx < relayCount) EEPROM.write(EEPROM_GPIO_START + rIdx, seg.toInt());
          rIdx++;
          lastC = i + 1;
        }
      }
      EEPROM.commit();
    }
    server.send(200, "text/plain", "OK");
    delay(500);
    ESP.restart();
  });

  server.begin();
}

void enterAPMode() {
  if (apModeInitialized) return;
  apModeInitialized = true;
  isApMode = true;
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
  WiFi.softAP("dMarch-Pro-Config", "12345678");
  Serial.println("AP Mode: dMarch-Pro-Config | Pass: 12345678 | IP: 192.168.4.1");
  sendLog("Entered AP mode", false);
  if (mqttClient.connected()) mqttClient.disconnect();
  setupWebServer();
}

// ========== OTA UPDATE (dummy) ==========
void performOTA() {
  sendLog("OTA Update Started");
  // Implementasi OTA bisa ditambahkan nanti
}

// ========== MQTT CALLBACK ==========
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message = "";
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  message.trim();

  if (!topicStr.startsWith(DEVICE_ID)) return;
  String relativeTopic = topicStr.substring(DEVICE_ID.length() + 1);

  // Emergency force AP via MQTT (tanpa HMAC)
  if (relativeTopic == "force_ap") {
    sendLog("Emergency force AP via MQTT");
    forceAPMode();
    return;
  }

  auto processSecure = [&](std::function<void()> action) {
    if (verifySecureCommand(message)) {
      action();
    } else {
      sendLog("Secure command rejected");
    }
  };

  if (relativeTopic.startsWith("relay/") && relativeTopic.endsWith("/cmd")) {
    int relayNum = relativeTopic.substring(6, relativeTopic.lastIndexOf("/cmd")).toInt();
    processSecure([&]() {
      JsonDocument doc;
      deserializeJson(doc, message);
      int state = doc["state"];
      controlRelay(relayNum, state, true);
    });
  } else if (relativeTopic == "all/on") {
    processSecure([&]() {
      allOnProcessing = true;
      for (int i = 1; i <= relayCount; i++) {
        controlRelay(i, 1, true);
        mqttClient.loop();
        delay(SEQUENTIAL_DELAY);
      }
      allOnProcessing = false;
    });
  } else if (relativeTopic == "all/off") {
    processSecure([&]() {
      allOnProcessing = true;
      for (int i = 1; i <= relayCount; i++) {
        controlRelay(i, 0, true);
        mqttClient.loop();
        delay(SEQUENTIAL_DELAY);
      }
      allOnProcessing = false;
    });
  } else if (relativeTopic == "system/restart") {
    processSecure([&]() {
      sendLog("Restarting...");
      delay(1000);
      ESP.restart();
    });
  } else if (relativeTopic == "system/ota") {
    processSecure([&]() {
      performOTA();
    });
  } else if (relativeTopic == "network/update") {
    processSecure([&]() {
      JsonDocument doc;
      deserializeJson(doc, message);
      String s = doc["ssid"].as<String>();
      String p = doc["pass"].as<String>();
      if (s.length() > 2) {
        saveWifiCredentials(s, p);
        sendLog("Network updated via MQTT. Restarting...");
        delay(1000);
        ESP.restart();
      }
    });
  } else if (relativeTopic == "network/reset") {
    processSecure([&]() {
      for (int i = 0; i < 32; i++) {
        EEPROM.write(EEPROM_WIFI_SSID_START + i, 0);
        EEPROM.write(EEPROM_WIFI_PASS_START + i, 0);
      }
      EEPROM.commit();
      sendLog("WiFi reset, restarting to AP mode...");
      delay(1000);
      ESP.restart();
    });
  } else if (relativeTopic == "config/relayCount") {
    processSecure([&]() {
      JsonDocument doc;
      deserializeJson(doc, message);
      int newCount = doc["count"];
      saveRelayCount(newCount);
      sendLog("Relay count changed to " + String(relayCount) + ", restarting...");
      delay(500);
      ESP.restart();
    });
  } else if (relativeTopic == "gpio/update") {
    processSecure([&]() {
      JsonDocument doc;
      deserializeJson(doc, message);
      String pins = doc["pins"].as<String>();
      int rIdx = 0, lastC = 0;
      for (int i = 0; i <= pins.length(); i++) {
        if (i == pins.length() || pins.charAt(i) == ',') {
          String seg = pins.substring(lastC, i);
          seg.trim();
          if (seg.length() > 0 && rIdx < relayCount) EEPROM.write(EEPROM_GPIO_START + rIdx, seg.toInt());
          rIdx++;
          lastC = i + 1;
        }
      }
      EEPROM.commit();
      sendLog("GPIO Updated! Restarting...");
      delay(2000);
      ESP.restart();
    });
  } else if (relativeTopic == "resetSecret") {
    processSecure([&]() {
      resetSecretAndRestart();
    });
  } else if (relativeTopic == "ntp/set") {
    for (int i = 0; i < message.length(); i++) EEPROM.write(EEPROM_NTP_SERVER + i, message[i]);
    EEPROM.write(EEPROM_NTP_SERVER + message.length(), '\0');
    EEPROM.commit();
    timeClient.setPoolServerName(message.c_str());
    sendLog("NTP updated: " + message);
  } else if (relativeTopic == "timezone/set") {
    int offset = message.toInt() * 3600;
    EEPROM.put(EEPROM_TZ_START, offset);
    EEPROM.commit();
    timezoneOffset = offset;
    timeClient.setTimeOffset(offset);
    sendLog("Timezone: " + String(message.toInt()) + "h");
  } else if (relativeTopic == "wifi/scan" && message == "1") {
    sendLog("WiFi scan requested");
    scanWiFiNetworks();
  }
}

void connectMQTT() {
  if (isApMode || mqttClient.connected()) return;
  sendLog("Connecting to MQTT...");
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
  espClient.setInsecure();
  String clientId = DEVICE_ID + "_" + String(random(0xffff), HEX);
  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
    sendLog("MQTT connected");
    mqttClient.subscribe((DEVICE_ID + "/relay/+/cmd").c_str());
    mqttClient.subscribe((DEVICE_ID + "/all/on").c_str());
    mqttClient.subscribe((DEVICE_ID + "/all/off").c_str());
    mqttClient.subscribe((DEVICE_ID + "/system/restart").c_str());
    mqttClient.subscribe((DEVICE_ID + "/system/ota").c_str());
    mqttClient.subscribe((DEVICE_ID + "/gpio/update").c_str());
    mqttClient.subscribe((DEVICE_ID + "/ntp/set").c_str());
    mqttClient.subscribe((DEVICE_ID + "/timezone/set").c_str());
    mqttClient.subscribe((DEVICE_ID + "/network/update").c_str());
    mqttClient.subscribe((DEVICE_ID + "/network/reset").c_str());
    mqttClient.subscribe((DEVICE_ID + "/config/relayCount").c_str());
    mqttClient.subscribe((DEVICE_ID + "/wifi/scan").c_str());
    mqttClient.subscribe((DEVICE_ID + "/resetSecret").c_str());
    mqttClient.subscribe((DEVICE_ID + "/force_ap").c_str());  // Emergency tanpa HMAC

    for (int i = 1; i <= relayCount; i++) {
      mqttClient.publish((DEVICE_ID + "/relay/" + String(i) + "/state").c_str(), String(EEPROM.read(i - 1)).c_str(), true);
    }
    publishSystemHealth();
  } else {
    sendLog("MQTT failed, rc=" + String(mqttClient.state()));
  }
}

// ========== EEPROM FUNGSI ==========
void clearCorruptedWiFiData() {
  bool cleaned = false;
  for (int i = 0; i < 32; i++) {
    char c = EEPROM.read(EEPROM_WIFI_SSID_START + i);
    if (c == 0 || c == 255) break;
    if (!((c >= 32 && c <= 126))) {
      for (int j = 0; j < 32; j++) EEPROM.write(EEPROM_WIFI_SSID_START + j, 0);
      for (int j = 0; j < 32; j++) EEPROM.write(EEPROM_WIFI_PASS_START + j, 0);
      cleaned = true;
      break;
    }
  }
  for (int idx = 0; idx < MAX_SAVED_SSID; idx++) {
    int offset = EEPROM_WIFI_LIST_START + (idx * SSID_STORAGE_SIZE);
    bool valid = true;
    int len = 0;
    for (int i = 0; i < SSID_STORAGE_SIZE; i++) {
      char c = EEPROM.read(offset + i);
      if (c == 0 || c == 255) break;
      if (!((c >= 32 && c <= 126))) {
        valid = false;
        break;
      }
      len++;
    }
    if (!valid || (len > 0 && len < 2)) {
      for (int i = 0; i < SSID_STORAGE_SIZE; i++) EEPROM.write(offset + i, 0);
      int passOffset = EEPROM_WIFI_PASS_LIST_START + (idx * PASS_STORAGE_SIZE);
      for (int i = 0; i < PASS_STORAGE_SIZE; i++) EEPROM.write(passOffset + i, 0);
      cleaned = true;
    }
  }
  if (cleaned) {
    EEPROM.commit();
    Serial.println("Cleaned corrupted WiFi data");
  }
}

void loadWifiCredentials() {
  char ssid[33] = { 0 }, pass[33] = { 0 };
  for (int i = 0; i < 32; i++) {
    char c = EEPROM.read(EEPROM_WIFI_SSID_START + i);
    if (c == '\0') break;
    ssid[i] = c;
  }
  for (int i = 0; i < 32; i++) {
    char c = EEPROM.read(EEPROM_WIFI_PASS_START + i);
    if (c == '\0') break;
    pass[i] = c;
  }
  savedWifiSsid = String(ssid);
  savedWifiPass = String(pass);
  if (savedWifiSsid.length() > 0) {
    Serial.print("Loaded saved SSID: ");
    Serial.println(savedWifiSsid);
  }
}

void saveWifiCredentials(const String& s, const String& p) {
  for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_WIFI_SSID_START + i, (i < s.length()) ? s[i] : 0);
  for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_WIFI_PASS_START + i, (i < p.length()) ? p[i] : 0);
  EEPROM.commit();
  addToSavedWifiList(s, p);
}

void loadSavedWifiList() {
  savedWifiCount = 0;
  for (int idx = 0; idx < MAX_SAVED_SSID; idx++) {
    int offset = EEPROM_WIFI_LIST_START + (idx * SSID_STORAGE_SIZE);
    char ssid[SSID_STORAGE_SIZE + 1] = { 0 };
    int len = 0;
    bool valid = true;
    for (int i = 0; i < SSID_STORAGE_SIZE; i++) {
      char c = EEPROM.read(offset + i);
      if (c == 0 || c == 255) break;
      if (c < 32 || c > 126) {
        valid = false;
        break;
      }
      ssid[i] = c;
      len++;
    }
    if (valid && len >= 2) {
      savedWifiList[savedWifiCount] = String(ssid);
      int passOffset = EEPROM_WIFI_PASS_LIST_START + (idx * PASS_STORAGE_SIZE);
      char pass[PASS_STORAGE_SIZE + 1] = { 0 };
      for (int i = 0; i < PASS_STORAGE_SIZE; i++) {
        char c = EEPROM.read(passOffset + i);
        if (c == 0 || c == 255) break;
        pass[i] = c;
      }
      savedWifiPassList[savedWifiCount] = String(pass);
      savedWifiCount++;
      Serial.print("Loaded saved SSID: ");
      Serial.println(ssid);
    }
  }
  Serial.print("Total saved SSIDs: ");
  Serial.println(savedWifiCount);
}

void addToSavedWifiList(String ssid, String pass) {
  if (ssid.length() < 2) return;
  for (int i = 0; i < savedWifiCount; i++)
    if (savedWifiList[i] == ssid) return;
  if (savedWifiCount >= MAX_SAVED_SSID) {
    for (int i = 1; i < MAX_SAVED_SSID; i++) {
      savedWifiList[i - 1] = savedWifiList[i];
      savedWifiPassList[i - 1] = savedWifiPassList[i];
    }
    savedWifiCount = MAX_SAVED_SSID - 1;
  }
  savedWifiList[savedWifiCount] = ssid;
  savedWifiPassList[savedWifiCount] = pass;
  savedWifiCount++;
  for (int idx = 0; idx < savedWifiCount; idx++) {
    int offset = EEPROM_WIFI_LIST_START + (idx * SSID_STORAGE_SIZE);
    for (int i = 0; i < SSID_STORAGE_SIZE; i++) EEPROM.write(offset + i, 0);
    for (int i = 0; i < (int)savedWifiList[idx].length(); i++) EEPROM.write(offset + i, savedWifiList[idx][i]);
    int passOffset = EEPROM_WIFI_PASS_LIST_START + (idx * PASS_STORAGE_SIZE);
    for (int i = 0; i < PASS_STORAGE_SIZE; i++) EEPROM.write(passOffset + i, 0);
    for (int i = 0; i < (int)savedWifiPassList[idx].length(); i++) EEPROM.write(passOffset + i, savedWifiPassList[idx][i]);
  }
  EEPROM.commit();
}

void loadRelayCount() {
  int val = EEPROM.read(EEPROM_RELAY_COUNT);
  int maxRel = getMaxRelayForHardware();
  if (val >= 1 && val <= maxRel) relayCount = val;
  else {
    relayCount = maxRel;
    EEPROM.write(EEPROM_RELAY_COUNT, relayCount);
    EEPROM.commit();
  }
}

void saveRelayCount(int count) {
  int maxRel = getMaxRelayForHardware();
  if (count < 1) count = 1;
  if (count > maxRel) count = maxRel;
  relayCount = count;
  EEPROM.write(EEPROM_RELAY_COUNT, relayCount);
  EEPROM.commit();
}

void checkBootLoop() {
  int bootCount = EEPROM.read(EEPROM_BOOT_COUNT);
  if (bootCount >= 5) {
    Serial.println("Too many reboots, forcing AP mode");
    for (int i = 0; i < relayCount; i++) EEPROM.write(EEPROM_STATE_START + i, 0);
    EEPROM.write(EEPROM_BOOT_COUNT, 0);
    EEPROM.commit();
    isApMode = true;
    return;
  }
  EEPROM.write(EEPROM_BOOT_COUNT, bootCount + 1);
  EEPROM.commit();
}

void resetBootCounter() {
  EEPROM.write(EEPROM_BOOT_COUNT, 0);
  EEPROM.commit();
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  delay(1000);
  DEVICE_ID = generateDeviceId();
  Serial.println("\n=== dMarch Relay Pro v" + String(FW_VERSION) + " (FULL SECURE) ===");
  Serial.println("Hardware: " + String(HW_TYPE));
  Serial.println("Device ID: " + DEVICE_ID);
  delay(500);
  EEPROM.begin(EEPROM_SIZE);
  clearCorruptedWiFiData();
  checkBootLoop();
  loadWifiCredentials();
  loadRelayCount();
  loadSavedWifiList();
  loadOrCreateSecret();
  Serial.print("Device Secret (hex): ");
  Serial.println(deviceSecret);
  mqttClient.setBufferSize(1024);  // Tambahkan ini di setup()

  int tzOffset;
  EEPROM.get(EEPROM_TZ_START, tzOffset);
  if (tzOffset != 0xFFFFFFFF && tzOffset != 0) {
    timezoneOffset = tzOffset;
  }
  timeClient.setTimeOffset(timezoneOffset);

  pinRelay = new int[relayCount];
  relayStartTime = new unsigned long[relayCount];
  const int* defaultPins = getDefaultPins();
  int maxDef = getMaxRelayForHardware();
  for (int i = 0; i < relayCount; i++) {
    int savedPin = EEPROM.read(EEPROM_GPIO_START + i);
    if (savedPin == 255) {
      pinRelay[i] = defaultPins[i % maxDef];
    } else {
      pinRelay[i] = savedPin;
    }
    pinMode(pinRelay[i], OUTPUT);
    controlRelay(i + 1, EEPROM.read(i), false);
    relayLabels[i] = "Relay " + String(i + 1);
    relayStartTime[i] = 0;
  }

  if (!isApMode) {
    if (savedWifiSsid.length() > 0) {
      WiFi.begin(savedWifiSsid.c_str(), savedWifiPass.c_str());
      unsigned long startTime = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - startTime < 10000) delay(500);
      if (WiFi.status() == WL_CONNECTED) {
        isApMode = false;
        resetBootCounter();
      } else {
        attemptFallbackToSavedSSIDs();
      }
    } else {
      isApMode = true;
    }
  }
  if (isApMode) {
    enterAPMode();
    resetBootCounter();
  }

  esp_task_wdt_config_t wdt_cfg = { .timeout_ms = 15000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_init(&wdt_cfg);
  esp_task_wdt_add(NULL);
  if (!isApMode) {
    timeClient.begin();
    timeClient.forceUpdate();
    while (!timeClient.isTimeSet() && millis() < 5000) {
      delay(100);
    }
    if (timeClient.isTimeSet()) {
      sendLog("NTP synced");
    }
  }
  setupComplete = true;
  Serial.println("Setup complete");
}

void loop() {
  esp_task_wdt_reset();
  if (isApMode) {
    server.handleClient();
    checkWifiWhileInApMode();   // <-- tambahkan ini
  } else {
    if (!mqttClient.connected()) connectMQTT();
    else mqttClient.loop();
    checkInternetAndFallback();
  }
  for (int i = 0; i < relayCount; i++) {
    if (millis() - relayStartTime[i] > MAX_RUNTIME && relayStartTime[i] != 0) {
      controlRelay(i + 1, 0, true);
      sendLog("Safety: Relay " + String(i + 1) + " OFF (4h)");
    }
  }
  static unsigned long lastHealth = 0;
  if (millis() - lastHealth >= 5000 && !isApMode) {
    lastHealth = millis();
    publishSystemHealth();
  }
  if (!isApMode) timeClient.update();
}
