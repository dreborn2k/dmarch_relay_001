/*
OBD2 Dashboard - ESP32 with HTTP Polling + OTA Update (Fixed)
Kompatibel dengan ESP32, ESP32-S2, ESP32-C3, dll.
*/
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include <Update.h>
#include <esp32_obd2.h>
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

// ==================== VARIABEL UPLOAD SPIFFS (PERSISTEN ANTAR CHUNK) ====================
static File fsUploadFile;
static String currentUploadPath = "";

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

float readPID(uint8_t pid, float defaultValue = 0) {
  float val = obd2.pidRead(pid);
  if (isnan(val) || val < -100 || val > 10000) return defaultValue;
  return val;
}

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
  doc["val-stft"] = data.stft1;
  doc["val-ltft"] = data.ltft1;
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

// ==================== OTA HANDLER ====================
void handleUpdateFirmware() {
  HTTPUpload& upload = server.upload();
  if (upload.status == UPLOAD_FILE_START) {
    Serial.printf("Firmware update: %s\n", upload.filename.c_str());
    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) Update.printError(Serial);
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

void handleUpdateSPIFFS() {
  HTTPUpload& upload = server.upload();
  if (upload.status == UPLOAD_FILE_START) {
    currentUploadPath = server.hasArg("path") ? server.arg("path") : ("/" + String(upload.filename));
    Serial.printf("SPIFFS upload start: %s\n", currentUploadPath.c_str());

    int lastSlash = currentUploadPath.lastIndexOf('/');
    if (lastSlash > 0) {
      String dir = currentUploadPath.substring(0, lastSlash);
      if (!SPIFFS.exists(dir)) SPIFFS.mkdir(dir);
    }

    if (SPIFFS.exists(currentUploadPath)) SPIFFS.remove(currentUploadPath);
    fsUploadFile = SPIFFS.open(currentUploadPath, FILE_WRITE);
    if (!fsUploadFile) {
      Serial.println("Failed to open SPIFFS file for writing");
    }
  } 
  else if (upload.status == UPLOAD_FILE_WRITE) {
    if (fsUploadFile) {
      fsUploadFile.write(upload.buf, upload.currentSize);
    }
  } 
  else if (upload.status == UPLOAD_FILE_END) {
    if (fsUploadFile) fsUploadFile.close();
    Serial.printf("Upload complete: %s, %u bytes\n", currentUploadPath.c_str(), upload.totalSize);
  } 
  else if (upload.status == UPLOAD_FILE_ABORTED) {
    if (fsUploadFile) fsUploadFile.close();
    if (!currentUploadPath.isEmpty() && SPIFFS.exists(currentUploadPath)) {
      SPIFFS.remove(currentUploadPath);
    }
    Serial.println("SPIFFS upload aborted");
  }
}


// ==================== WEBSERVER ====================
void setupWebServer() {
  server.on("/", HTTP_GET, []() {
    File f = SPIFFS.open("/index.html", "r");
    if (!f) { server.send(404, "text/plain", "Not Found"); return; }
    server.streamFile(f, "text/html");
    f.close();
  });

  server.on("/style.css", HTTP_GET, []() {
    File f = SPIFFS.open("/style.css", "r");
    if (!f) { server.send(404, "text/plain", "Not Found"); return; }
    server.streamFile(f, "text/css");
    f.close();
  });

  server.on("/app.js", HTTP_GET, []() {
    File f = SPIFFS.open("/app.js", "r");
    if (!f) { server.send(404, "text/plain", "Not Found"); return; }
    server.streamFile(f, "application/javascript");
    f.close();
  });

  server.on("/car.png", HTTP_GET, []() {
    File f = SPIFFS.open("/car.png", "r");
    if (!f) { server.send(404, "text/plain", "Not Found"); return; }
    server.streamFile(f, "image/png");
    f.close();
  });

  server.on("/css/all.min.css", HTTP_GET, []() {
    File f = SPIFFS.open("/css/all.min.css", "r");
    if (!f) { server.send(404, "text/plain", "Not Found"); return; }
    server.streamFile(f, "text/css");
    f.close();
  });

  const char* fontFiles[] = {"fa-brands-400.woff2", "fa-regular-400.woff2", "fa-solid-900.woff2", "fa-v4compatibility.woff2"};
  for (const char* f : fontFiles) {
    String path = "/webfonts/" + String(f);
    server.on(path.c_str(), HTTP_GET, [f]() {
      String fullPath = "/webfonts/" + String(f);
      File file = SPIFFS.open(fullPath, "r");
      if (!file) { server.send(404, "text/plain", "Not Found"); return; }
      server.streamFile(file, "font/woff2");
      file.close();
    });
  }

  server.on("/data", HTTP_GET, []() { sendDataToClient(); });

  // Pindahkan respons ke dalam lambda (argumen ketiga) untuk menghindari konflik header
  server.on("/update-firmware", HTTP_POST, []() {
    server.sendHeader("Connection", "close");
    if (Update.hasError()) {
      server.send(500, "text/plain", "Update Failed");
    } else {
      server.send(200, "text/plain", "Update Success! Rebooting...");
      delay(1000);
      ESP.restart();
    }
  }, handleUpdateFirmware);

  server.on("/update-spiffs", HTTP_POST, []() {
    server.sendHeader("Connection", "close");
    server.send(200, "text/plain", "OK");
    currentUploadPath = ""; 
  }, handleUpdateSPIFFS);

  server.begin();
  Serial.println("Web server started");
}

// ==================== SETUP ====================
void setupSoftAP() {
  WiFi.softAP(ssid, password);
  Serial.print("SoftAP IP: ");
  Serial.println(WiFi.softAPIP());
}

void setupSPIFFS() {
  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed");
    return;
  }
  Serial.println("SPIFFS mounted");
}

void setupOBD() {
  if (!obd2.begin()) {
    Serial.println("OBD2 CAN bus gagal!");
    return;
  }
  obd2.setTimeout(500);
  Serial.println("OBD2 siap");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  setupSPIFFS();
  setupSoftAP();
  setupWebServer();
  setupOBD();
}

void loop() {
  unsigned long now = millis();
  if (now - lastRead >= READ_INTERVAL) {
    lastRead = now;
    readOBDData();
  }
  server.handleClient();
  delay(10);
}
