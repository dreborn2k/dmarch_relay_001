/*
  OBD2 Dashboard - ESP32 with HTTP Polling + OTA Update + DTC Reader
  Kompatibel dengan ESP32, ESP32-S2, ESP32-C3, dll.
  FIX: Multiple Content-Length header & koneksi stabil
*/
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include <Update.h>
#include <esp32_obd2.h>
#include <driver/twai.h>

// ==================== DETEKSI BOARD & PIN CAN ====================
#if defined(CONFIG_IDF_TARGET_ESP32C3)
#define DEFAULT_CAN_TX 5
#define DEFAULT_CAN_RX 6
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
#define DEFAULT_CAN_TX 4
#define DEFAULT_CAN_RX 5
#elif defined(CONFIG_IDF_TARGET_ESP32C6)
#define DEFAULT_CAN_TX 5
#define DEFAULT_CAN_RX 6
#elif defined(CONFIG_IDF_TARGET_ESP32S2)
#define DEFAULT_CAN_TX 4
#define DEFAULT_CAN_RX 5
#else
#define DEFAULT_CAN_TX 22
#define DEFAULT_CAN_RX 21
#endif
#define CAN_TX DEFAULT_CAN_TX
#define CAN_RX DEFAULT_CAN_RX
#define CAN_SPEED 500

// ==================== KONFIGURASI SOFTAP ====================
const char* ssid = "OBD2_Dashboard";
const char* password = "12345678";
WebServer server(80);

// ==================== VARIABEL UPLOAD SPIFFS ====================
static File fsUploadFile;
static String currentUploadPath = "";
static bool spiffsUploadError = false;
static bool spiffsUploadFinalized = false;

File uploadFile;
size_t uploadTotal = 0;

// ==================== OBD2 ====================
OBD2Class obd2;

// ==================== DATA OBD2 ====================
struct ObdData {
  float rpm = 750, speed = 0, engineLoad = 0, throttle = 0, timing = 0, maf = 0, map = 0;
  float coolant = 80, iat = 30, oilTemp = 80, fuelRate = 0, fuelLevel = 0;
  float stft1 = 0, ltft1 = 0, voltage = 12.5;
  uint16_t runtime = 0;
  bool mil = false;
} data;

const float ALPHA_FAST = 0.3;
const float ALPHA_MED = 0.2;
unsigned long lastRead = 0;
const unsigned long READ_INTERVAL = 200;

// ==================== HELPER READ PID ====================
float readPID(uint8_t pid, float defaultValue = 0) {
  float val = obd2.pidRead(pid);
  if (isnan(val) || val < -100 || val > 10000) return defaultValue;
  return val;
}

// ==================== BACA DATA OBD2 ====================
void readOBDData() {
  data.rpm        = ALPHA_FAST * readPID(ENGINE_RPM, data.rpm) + (1 - ALPHA_FAST) * data.rpm;
  data.speed      = ALPHA_FAST * readPID(VEHICLE_SPEED, data.speed) + (1 - ALPHA_FAST) * data.speed;
  data.engineLoad = ALPHA_FAST * readPID(CALCULATED_ENGINE_LOAD, data.engineLoad) + (1 - ALPHA_FAST) * data.engineLoad;
  data.throttle   = ALPHA_FAST * readPID(THROTTLE_POSITION, data.throttle) + (1 - ALPHA_FAST) * data.throttle;
  data.timing     = ALPHA_FAST * readPID(TIMING_ADVANCE, data.timing) + (1 - ALPHA_FAST) * data.timing;
  data.maf        = ALPHA_FAST * readPID(MAF_AIR_FLOW_RATE, data.maf) + (1 - ALPHA_FAST) * data.maf;
  data.map        = ALPHA_FAST * readPID(INTAKE_MANIFOLD_ABSOLUTE_PRESSURE, data.map) + (1 - ALPHA_FAST) * data.map;
  data.coolant    = ALPHA_MED * readPID(ENGINE_COOLANT_TEMPERATURE, data.coolant) + (1 - ALPHA_MED) * data.coolant;
  data.iat        = ALPHA_MED * readPID(AIR_INTAKE_TEMPERATURE, data.iat) + (1 - ALPHA_MED) * data.iat;
  data.oilTemp    = ALPHA_MED * readPID(ENGINE_OIL_TEMPERATURE, data.oilTemp) + (1 - ALPHA_MED) * data.oilTemp;
  data.fuelRate   = ALPHA_MED * readPID(ENGINE_FUEL_RATE, data.fuelRate) + (1 - ALPHA_MED) * data.fuelRate;
  data.fuelLevel  = ALPHA_MED * readPID(FUEL_TANK_LEVEL_INPUT, data.fuelLevel) + (1 - ALPHA_MED) * data.fuelLevel;
  data.stft1      = ALPHA_MED * readPID(SHORT_TERM_FUEL_TRIM_BANK_1, data.stft1) + (1 - ALPHA_MED) * data.stft1;
  data.ltft1      = ALPHA_MED * readPID(LONG_TERM_FUEL_TRIM_BANK_1, data.ltft1) + (1 - ALPHA_MED) * data.ltft1;
  data.voltage    = ALPHA_MED * readPID(CONTROL_MODULE_VOLTAGE, data.voltage) + (1 - ALPHA_MED) * data.voltage;
  data.runtime    = (uint16_t)readPID(RUN_TIME_SINCE_ENGINE_START, data.runtime);
  uint32_t status = obd2.pidReadRaw(MONITOR_STATUS_SINCE_DTCS_CLEARED);
  data.mil = (status & 0x80);
}

// ==================== KIRIM DATA JSON KE CLIENT ====================
void sendDataToClient() {
  JsonDocument doc;
  doc["rpm"] = data.rpm;
  doc["speed"] = data.speed;
  doc["val-ect"] = data.coolant;
  doc["val-tps"] = data.throttle;
  doc["val-maf"] = data.maf;
  doc["val-iat"] = data.iat;
  doc["radar-front-val"] = 12.5;
  doc["val-fuel"] = data.fuelRate;
  doc["val-volt"] = data.voltage;
  doc["val-load"] = data.engineLoad;
  doc["val-stft1"] = data.stft1;
  doc["val-ltft1"] = data.ltft1;
  doc["val-o2"] = 0.45;
  doc["val-timing"] = data.timing;
  doc["radarFrontCenter"] = false;
  doc["radarFrontLeft"] = false;
  doc["radarFrontRight"] = false;
  doc["radarRearLeft"] = false;
  doc["radarRearRight"] = false;
  doc["btStatus"] = "connected";
  doc["espnowStatus"] = "connected";
  doc["mil"] = data.mil;

  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

// ==================== DTC FUNCTIONS (CAN Raw via TWAI) ====================
bool twaiInitialized = false;

void initTWAI() {
  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)CAN_TX, (gpio_num_t)CAN_RX, TWAI_MODE_NORMAL);
  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) != ESP_OK) {
    Serial.println("TWAI install failed");
    return;
  }
  if (twai_start() != ESP_OK) {
    Serial.println("TWAI start failed");
    return;
  }
  twaiInitialized = true;
  Serial.println("TWAI started for DTC reading");
}

void requestDTC() {
  if (!twaiInitialized) return;
  twai_message_t msg;
  msg.identifier = 0x7DF;
  msg.extd = 0;
  msg.rtr = 0;
  msg.data_length_code = 2;
  msg.data[0] = 0x03;  // Service 03 - Read DTC
  msg.data[1] = 0x00;
  twai_transmit(&msg, pdMS_TO_TICKS(100));
}

void requestClearDTC() {
  if (!twaiInitialized) return;
  twai_message_t msg;
  msg.identifier = 0x7DF;
  msg.extd = 0;
  msg.rtr = 0;
  msg.data_length_code = 1;
  msg.data[0] = 0x04;  // Service 04 - Clear DTC
  twai_transmit(&msg, pdMS_TO_TICKS(100));
  delay(100);
}

bool readDTCResponse(uint8_t* buffer, uint8_t& count) {
  if (!twaiInitialized) return false;
  twai_message_t msg;
  unsigned long start = millis();

  while (millis() - start < 500) {
    if (twai_receive(&msg, pdMS_TO_TICKS(100)) == ESP_OK) {
      if (msg.identifier == 0x7E8 && msg.data_length_code >= 3 && msg.data[0] == 0x03) {
        count = (msg.data_length_code - 2) / 2;
        if (count > 8) count = 8;
        for (int i = 0; i < count; i++) {
          buffer[i * 2]   = msg.data[2 + i * 2];
          buffer[i * 2 + 1] = msg.data[2 + i * 2 + 1];
        }
        return true;
      }
    }
  }
  return false;
}

String dtcCodeToString(uint8_t high, uint8_t low) {
  char code[6];
  uint8_t first = (high >> 6) & 0x03;
  uint8_t second = (high >> 4) & 0x03;
  uint8_t third = high & 0x0F;
  uint8_t fourth = (low >> 4) & 0x0F;

  char prefix;
  switch (first) {
    case 0: prefix = 'P'; break;
    case 1: prefix = 'C'; break;
    case 2: prefix = 'B'; break;
    case 3: prefix = 'U'; break;
    default: prefix = '?';
  }
  snprintf(code, sizeof(code), "%c%01X%01X%01X", prefix, second, third, fourth);
  return String(code);
}

void handleGetDTC() {
  if (!twaiInitialized) {
    server.send(500, "application/json", "{\"error\":\"TWAI not initialized\"}");
    return;
  }
  requestDTC();

  uint8_t dtcBuffer[16];
  uint8_t dtcCount = 0;
  JsonDocument doc;

  if (readDTCResponse(dtcBuffer, dtcCount)) {
    JsonArray dtcArray = doc["dtcs"].to<JsonArray>();
    for (int i = 0; i < dtcCount; i++) {
      String code = dtcCodeToString(dtcBuffer[i * 2], dtcBuffer[i * 2 + 1]);
      dtcArray.add(code);
    }
    doc["count"] = dtcCount;
  } else {
    doc["count"] = 0;
    doc["message"] = "No DTC found or unable to read";
  }
  doc["mil"] = data.mil;

  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

void handleClearDTC() {
  if (!twaiInitialized) {
    server.send(500, "application/json", "{\"error\":\"TWAI not initialized\"}");
    return;
  }
  requestClearDTC();
  delay(200);
  server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"DTC cleared via service 04\"}");
}

// ==================== OTA FIRMWARE UPDATE ====================
void handleUpdateFirmware() {
  HTTPUpload& upload = server.upload();

  if (upload.status == UPLOAD_FILE_START) {
    Serial.printf("Firmware update: %s\n", upload.filename.c_str());
    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
      Update.printError(Serial);
    }
  }
  else if (upload.status == UPLOAD_FILE_WRITE) {
    if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
      Update.printError(Serial);
    }
  }
  else if (upload.status == UPLOAD_FILE_END) {
    if (Update.end(true)) {
      Serial.printf("Update success: %u bytes\n", upload.totalSize);
    } else {
      Update.printError(Serial);
    }
  }
}

// ==================== SPIFFS FILE UPDATE - FIX UTAMA ====================
void handleUpdateSPIFFS() {
  HTTPUpload& upload = server.upload();

  if (upload.status == UPLOAD_FILE_START) {
    String path = "/" + server.arg("path");

    Serial.println("=== UPLOAD START ===");
    Serial.println("File: " + path);

    uploadTotal = 0;

    // Hapus file lama dulu (anti corrupt)
    if (SPIFFS.exists(path)) {
      SPIFFS.remove(path);
    }

    uploadFile = SPIFFS.open(path, "w");

    if (!uploadFile) {
      Serial.println("GAGAL buka file!");
    }
  }

  else if (upload.status == UPLOAD_FILE_WRITE) {
    if (uploadFile) {
      uploadFile.write(upload.buf, upload.currentSize);
      uploadTotal += upload.currentSize;

      Serial.printf("Progress: %u bytes\n", uploadTotal);
    }
  }

  else if (upload.status == UPLOAD_FILE_END) {
    if (uploadFile) {
      uploadFile.close();

      Serial.println("=== UPLOAD SELESAI ===");
      Serial.printf("Total: %u bytes\n", uploadTotal);
    } else {
      Serial.println("UPLOAD GAGAL!");
    }
  }
}

// ==================== WEBSERVER SETUP ====================
void setupWebServer() {
  // Root & static files
  server.on("/", HTTP_GET, []() {
    File f = SPIFFS.open("/index.html", "r");
    if (!f) {
      server.send(404);
      return;
    }
    server.streamFile(f, "text/html");
    f.close();
  });

  server.on("/style.css", HTTP_GET, []() {
    File f = SPIFFS.open("/style.css", "r");
    if (!f) {
      server.send(404);
      return;
    }
    server.streamFile(f, "text/css");
    f.close();
  });

  server.on("/app.js", HTTP_GET, []() {
    File f = SPIFFS.open("/app.js", "r");
    if (!f) {
      server.send(404);
      return;
    }
    server.streamFile(f, "application/javascript");
    f.close();
  });

  server.on("/car.png", HTTP_GET, []() {
    File f = SPIFFS.open("/car.png", "r");
    if (!f) {
      server.send(404);
      return;
    }
    server.streamFile(f, "image/png");
    f.close();
  });

  server.on("/css/all.min.css", HTTP_GET, []() {
    File f = SPIFFS.open("/css/all.min.css", "r");
    if (!f) {
      server.send(404);
      return;
    }
    server.streamFile(f, "text/css");
    f.close();
  });

  server.on("/dtc_database.js", HTTP_GET, []() {
    File f = SPIFFS.open("/dtc_database.js", "r");
    if (!f) {
      server.send(404);
      return;
    }
    server.streamFile(f, "application/javascript");
    f.close();
  });

  // Webfonts
  const char* fontFiles[] = { "fa-brands-400.woff2", "fa-regular-400.woff2", "fa-solid-900.woff2", "fa-v4compatibility.woff2" };
  for (const char* f : fontFiles) {
    String path = "/webfonts/" + String(f);
    server.on(path.c_str(), HTTP_GET, [f]() {
      String fullPath = "/webfonts/" + String(f);
      File file = SPIFFS.open(fullPath, "r");
      if (!file) {
        server.send(404);
        return;
      }
      server.streamFile(file, "font/woff2");
      file.close();
    });
  }

  // API endpoints
  server.on("/data", HTTP_GET, []() {
    sendDataToClient();
  });
  server.on("/dtc", HTTP_GET, handleGetDTC);
  server.on("/clear-dtc", HTTP_POST, handleClearDTC);

  // OTA Firmware Update - format handler yang benar
  server.on("/update-firmware", HTTP_POST, []() {
    // Handler kosong - respons dikirim setelah upload selesai
    server.sendHeader("Connection", "close");
    if (Update.hasError()) {
      server.send(500, "text/plain", "Update Failed");
    } else {
      server.send(200, "text/plain", "Update Success! Rebooting...");
      delay(1000);
      ESP.restart();
    }
  }, handleUpdateFirmware);

  // SPIFFS Update - format handler yang benar + callback upload
  server.on("/update-spiffs", HTTP_POST,
  []() {
    server.send(200, "text/plain", "OK");
  }, handleUpdateSPIFFS
           );

  // Debug: list files
  server.on("/list", HTTP_GET, []() {
    String html = "<pre>\n";
    File root = SPIFFS.open("/");
    File file = root.openNextFile();
    while (file) {
      html += String(file.name()) + " (" + String(file.size()) + " bytes)\n";
      file = root.openNextFile();
    }
    html += "</pre>";
    server.send(200, "text/html", html);
  });
  server.enableCORS(true);
  server.begin();
  Serial.println("Web server started");
}

// ==================== SOFTAP SETUP ====================
void setupSoftAP() {
  WiFi.softAP(ssid, password);
  Serial.print("SoftAP IP: ");
  Serial.println(WiFi.softAPIP());
}

// ==================== SPIFFS SETUP ====================
void setupSPIFFS() {
  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed");
    return;
  }
  Serial.println("SPIFFS mounted");
}

// ==================== OBD2 SETUP ====================
void setupOBD() {
  if (!obd2.begin()) {
    Serial.println("OBD2 CAN bus gagal!");
    return;
  }
  obd2.setTimeout(500);
  Serial.println("OBD2 siap");
}

// ==================== SETUP UTAMA ====================
void setup() {
  Serial.begin(115200);
  delay(500);

  setupSPIFFS();
  setupSoftAP();
  setupWebServer();
  setupOBD();
  initTWAI();

  Serial.println("=== System Ready ===");
}

// ==================== LOOP UTAMA - FIX STABILITAS ====================
void loop() {
  unsigned long now = millis();

  // Handle client FIRST - prioritas tertinggi agar tidak timeout
  server.handleClient();
  yield();  // ✅ Wajib untuk ESP32 agar WiFi stack tidak hang

  // Baca OBD hanya jika interval terpenuhi
  if (now - lastRead >= READ_INTERVAL) {
    lastRead = now;
    readOBDData();
    yield();  // ✅ Yield setelah operasi berat
  }

  // ✅ HAPUS delay(10) - biarkan loop berjalan bebas dengan yield()
  // delay(10);  // ❌ Dihapus agar responsif
}
