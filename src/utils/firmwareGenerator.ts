import { AlarmItem, BotSettings, CustomReaction, HardwareConfig, LocationConfig, PlaylistItem } from '../types';
import { OLED_HEIGHT, OLED_WIDTH } from './oledRenderer';

export function pixelsToCppProgmem(pixels: number[], varName = 'customBitmap'): string {
  const bytes: string[] = [];
  for (let y = 0; y < OLED_HEIGHT; y++) {
    for (let xByte = 0; xByte < OLED_WIDTH / 8; xByte++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = xByte * 8 + bit;
        if (pixels[y * OLED_WIDTH + px]) {
          byteVal |= 1 << (7 - bit);
        }
      }
      bytes.push('0x' + byteVal.toString(16).padStart(2, '0'));
    }
  }

  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    lines.push('  ' + bytes.slice(i, i + 16).join(', '));
  }

  return `unsigned char ${varName}[1024] = {\n${lines.join(',\n')}\n};`;
}

// =========================================================================
// DUAL-CORE FREERTOS ESP32 SKETCH:
//   Core 1: Smooth 24-FPS OLED Animations + Green LED + Buzzer + Alarms
//   Core 0: Fast 1.2s Vercel Cloud Anywhere Sync + GitHub OTA + Weather
//   Zero Resistors! Zero ESP32 Hotspot Required!
// =========================================================================
export function generateEsp32Firmware(
  settings: BotSettings,
  location: LocationConfig,
  hardware: HardwareConfig,
  alarms: AlarmItem[],
  playlist: PlaylistItem[],
  customReactions: CustomReaction[],
  utcOffsetSeconds = 21600
): string {
  const latestReaction = customReactions[0];
  const customBitmapBlock = latestReaction
    ? pixelsToCppProgmem(latestReaction.pixels, 'customTouchpadBitmap')
    : `unsigned char customTouchpadBitmap[1024] = { 0 };`;

  const enabledItems = playlist.filter((p) => p.enabled);
  const watchDur = enabledItems.find((p) => p.kind === 'watch')?.durationSec ?? 8;
  const weatherDur = enabledItems.find((p) => p.kind === 'weather')?.durationSec ?? 6;
  const faceDur = enabledItems.find((p) => p.kind === 'face')?.durationSec ?? 5;

  const safeSsid = (hardware.wifiSsid || 'muhib').replace(/"/g, '');
  const safePass = (hardware.wifiPassword || '12345678').replace(/"/g, '');
  const safeUser = (settings.userName || 'Muhib').replace(/"/g, '');
  const safeDeviceId = (hardware.deviceId || 'muhib-bot-1').replace(/"/g, '');
  const safeCloudBase = (hardware.cloudPortalUrl || 'https://myfacebot.vercel.app')
    .replace(/\/$/, '')
    .replace(/"/g, '');
  const safeFirebaseUrl = (hardware.firebaseDbUrl || '').replace(/"/g, '');
  const useFirebase = hardware.cloudBackendType === 'firebase-rtdb' && safeFirebaseUrl.length > 8;
  const cloudPollUrl = useFirebase
    ? safeFirebaseUrl
    : `${safeCloudBase}/api/bot-state?device=${safeDeviceId}`;
  const otaVersionUrl = `${safeCloudBase}/ota/version.json`;
  const fwVersion = (hardware.firmwareVersion || '4.3.0').replace(/"/g, '');

  const alarmInitLines = alarms.slice(0, 8).map((a, idx) => {
    const [hh, mm] = a.time.split(':').map(Number);
    const safeLabel = a.label.replace(/"/g, '').slice(0, 18);
    const melodyCode = a.melody === 'gentle' ? 1 : a.melody === 'urgent' ? 2 : 0;
    return `  alarms[${idx}] = { ${hh || 7}, ${mm || 0}, ${a.enabled ? 'true' : 'false'}, ${a.faceId}, ${melodyCode}, "${safeLabel}" };`;
  });

  return `/*
 * =========================================================================
 * FaceBot — Always-On AI Agent Dual-Core ESP32 Firmware (Muhib Creation · v${fwVersion})
 * Rock-Solid Zero-Drop WiFi · Strict Default Auto Mode · 3s WiFi Connected Alert
 * =========================================================================
 * ARCHITECTURE (Maximum WiFi Stability & Butter-Smooth 24-FPS Animations):
 *   - Core 1 (loop)         : 24-FPS silky-smooth OLED + 3s WiFi Connected Alert + Timer + LED + Buzzer
 *   - Core 0 (FreeRTOS Task): Clean 2.5s Vercel Cloud Sync (16KB stack) + Auto OTA + Open-Meteo Weather
 *   - Rock-Solid WiFi       : 15dBm safe TX power (no USB brownout), Post-IP WIFI_PS_NONE, 4s blip filter
 *   - Strict Default Auto   : ALWAYS boots & reconnects in Auto Mode; only enters User Mode on manual toggle!
 *   - Offline Auto Mode     : Silent switch to Auto Mode with NVS-cached weather/alarms (ZERO WiFi OFF alert)
 *   - Online WiFi Connected : Exact 3s WiFi Connected OLED + 3s Buzzer + 3s Green LED Blink -> Auto Mode
 *
 * Required Arduino Libraries (ONLY 3):
 *   1. Adafruit SSD1306
 *   2. Adafruit GFX Library
 *   3. ArduinoJson (v7+)
 *
 * Ultra-Clean ESP32 Pinout Wiring (8 Wires Total · ZERO Resistors!):
 *   - 0.96" SSD1306 OLED (I2C): SDA -> GPIO 21, SCL -> GPIO 22, VCC -> 3.3V, GND -> GND
 *   - Piezo Buzzer            : (+) -> GPIO 14, (-) -> GND
 *   - 1x Green LED (Direct)   : Long leg (+) -> GPIO 26, Short leg (-) -> GND
 */

#include <WiFi.h>
#include <esp_wifi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <time.h>
#include <math.h>

// -------- Home WiFi & Vercel Cloud Configuration --------
String wifiSsid       = "${safeSsid}";
String wifiPassword   = "${safePass}";
const char* CLOUD_URL = "${cloudPollUrl}";
const char* OTA_URL   = "${otaVersionUrl}";
const char* FW_VER    = "${fwVersion}";
bool otaAutoCheck     = ${hardware.otaAutoCheck ? 'true' : 'false'};
Preferences prefs;

// -------- User, Location & Timezone --------
String userName       = "${safeUser}";
String cityName       = "${location.city}";
float  locLat         = ${location.latitude.toFixed(4)};
float  locLon         = ${location.longitude.toFixed(4)};
long   utcOffsetSec   = ${utcOffsetSeconds};
float  coldThresholdC = ${settings.coldThresholdC.toFixed(1)};

// -------- ESP32 Hardware Pins (Zero Resistors!) --------
#define SCREEN_WIDTH    128
#define SCREEN_HEIGHT    64
#define OLED_RESET       -1
#define PIN_BUZZER       14
#define PIN_LED_GREEN    26
#define PIN_LED_ONBOARD   2

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
WebServer server(80);
SemaphoreHandle_t stateMutex = NULL;

// -------- Multi-Alarm Schedule --------
struct AlarmSlot {
  int    hour;
  int    minute;
  bool   enabled;
  int    faceId;
  int    melody; // 0=classic, 1=gentle, 2=urgent
  String label;
};

#define MAX_ALARMS 8
AlarmSlot alarms[MAX_ALARMS];
int       alarmCount       = ${Math.min(alarms.length, 8)};
bool      alarmRinging     = false;
int       ringingAlarmIdx  = -1;
int       lastTriggeredMin = -1;

// -------- Shared Bot Runtime State (Synced via Vercel Cloud & Local LAN) --------
String botMode              = "auto";
String preferredOnlineMode  = "auto"; // Automatically restored when WiFi reconnects!
String activeScreen         = "face";
String customLine1          = "Hi ${safeUser}!";
String customLine2          = "";
String greenLedMode         = "auto"; // "auto", "on", "off", "blink"
int    currentFace          = 0;
int    frameCount           = 0;
bool   screenLocked         = false;
bool   isSleeping           = false;
bool   buzzerActiveMode     = false;

// Pending buzzer trigger from Core 0 Cloud Sync -> executed smoothly on Core 1
volatile bool pendingBuzzer = false;
String pendingBuzzerMode    = "tone";

// -------- #1 TOP-PRIORITY 3-Second WiFi Connected Hardware Alert (With 4s Blip Filter!) --------
volatile bool wifiGotIpFlag         = false;
volatile bool wifiLinkDownFlag      = false;
volatile int  lastDisconnectReason  = 0;
bool          wifiTrulyOnline       = false;
unsigned long wifiLostSinceMs       = 0;
bool          wifiAlertActive       = false;
bool          wifiAlertConnected    = false;
unsigned long wifiAlertStartMs      = 0;
unsigned long wifiAlertUntilMs      = 0;
unsigned long lastWifiAlertBeepMs   = 0;
unsigned long lastWifiAlertFiredMs  = 0;
bool          lastWifiAlertState    = false;

// -------- Native 24-FPS Smooth Focus Timer State (Zero Stutter!) --------
bool          localTimerActive    = false;
String        localTimerLabel     = "FOCUS";
unsigned long localTimerEndMs     = 0;
int           localTimerTotalSec  = 1500;
int64_t       lastSyncedTimerEnd  = 0;

// Cloud deduplication & Strict Manual-Only Mode Tracking
int64_t lastCloudUpdatedAt = 0;
bool    hasInitialCloudSync = false;
int     lastModeSeq         = -1;
String  lastCloudMode       = "";
int  lastBuzzerSeq          = 0;
int  lastBitmapSeq          = 0;
int  lastAlarmDismissSeq    = 0;
int  lastAlarmTestSeq       = 0;
int  lastOtaTriggerSeq      = 0;
bool cloudOnline            = false;
volatile bool ntpConfigured = false;

// Screen durations (seconds)
int watchDurSec   = ${watchDur};
int weatherDurSec = ${weatherDur};
int faceDurSec    = ${faceDur};
unsigned long lastCycleSwitchMs = 0;
int cycleStep = 0;

// Live Weather Cache (persisted in ESP32 NVS so offline Auto Mode always responds with synced weather!)
float  liveTempC      = 24.0;
int    liveHumidity   = 65;
float  liveWindKmh    = 6.0;
String liveCondition  = "Clear";

// Daily Interaction Stats (24 hourly buckets)
int hourlyHits[24] = { 0 };
unsigned long totalHitsToday = 0;

// -------- NVS Offline Cache (Weather + Alarms + Profile survive WiFi OFF & Reboot!) --------
void saveWeatherCacheToNvs() {
  prefs.begin("facebot", false);
  prefs.putFloat("wTemp", liveTempC);
  prefs.putInt("wHum", liveHumidity);
  prefs.putFloat("wWind", liveWindKmh);
  prefs.putString("wCond", liveCondition);
  prefs.putString("city", cityName);
  prefs.putString("user", userName);
  prefs.end();
}

void saveAlarmsCacheToNvs() {
  prefs.begin("facebot", false);
  prefs.putInt("alCnt", alarmCount);
  for (int i = 0; i < alarmCount && i < MAX_ALARMS; i++) {
    String prefix = "a" + String(i);
    prefs.putInt((prefix + "h").c_str(), alarms[i].hour);
    prefs.putInt((prefix + "m").c_str(), alarms[i].minute);
    prefs.putBool((prefix + "e").c_str(), alarms[i].enabled);
    prefs.putInt((prefix + "f").c_str(), alarms[i].faceId);
    prefs.putInt((prefix + "y").c_str(), alarms[i].melody);
    prefs.putString((prefix + "l").c_str(), alarms[i].label);
  }
  prefs.end();
}

void loadOfflineCacheFromNvs() {
  prefs.begin("facebot", true);
  if (prefs.isKey("wTemp")) liveTempC = prefs.getFloat("wTemp", liveTempC);
  if (prefs.isKey("wHum")) liveHumidity = prefs.getInt("wHum", liveHumidity);
  if (prefs.isKey("wWind")) liveWindKmh = prefs.getFloat("wWind", liveWindKmh);
  String cCond = prefs.getString("wCond", "");
  if (cCond.length() > 0) liveCondition = cCond;
  String cCity = prefs.getString("city", "");
  if (cCity.length() > 0) cityName = cCity;
  String cUser = prefs.getString("user", "");
  if (cUser.length() > 0) userName = cUser;

  int savedCnt = prefs.getInt("alCnt", -1);
  if (savedCnt > 0 && savedCnt <= MAX_ALARMS) {
    alarmCount = savedCnt;
    for (int i = 0; i < alarmCount; i++) {
      String prefix = "a" + String(i);
      alarms[i].hour    = prefs.getInt((prefix + "h").c_str(), 7);
      alarms[i].minute  = prefs.getInt((prefix + "m").c_str(), 0);
      alarms[i].enabled = prefs.getBool((prefix + "e").c_str(), true);
      alarms[i].faceId  = prefs.getInt((prefix + "f").c_str(), 1);
      alarms[i].melody  = prefs.getInt((prefix + "y").c_str(), 0);
      alarms[i].label   = prefs.getString((prefix + "l").c_str(), "Alarm");
    }
  }
  prefs.end();
}

// -------- Rock-Solid Hardware WiFi Event Callback (Applies Post-IP WIFI_PS_NONE!) --------
void onEsp32WifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    // Re-enforce modem sleep OFF right AFTER AP association so router never kicks ESP32!
    WiFi.setSleep(false);
    esp_wifi_set_ps(WIFI_PS_NONE);
    wifiLinkDownFlag = false;
    wifiGotIpFlag    = true;
  } else if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    lastDisconnectReason = (int)info.wifi_sta_disconnected.reason;
    wifiLinkDownFlag     = true;
  }
}

// Forward declarations so triggerWifiAlert3s can paint OLED + LED at millisecond 0!
void updateGreenLed();
void drawWifiStatusOled(bool connected, int frame);

void triggerWifiAlert3s(bool connected) {
  unsigned long nowMs = millis();
  if (lastWifiAlertFiredMs > 0 && lastWifiAlertState == connected && (nowMs - lastWifiAlertFiredMs) < 2000UL) {
    return;
  }
  lastWifiAlertFiredMs = nowMs;
  lastWifiAlertState   = connected;
  wifiTrulyOnline      = connected;

  // WiFi OFF -> ZERO OLED/Buzzer/LED notification! Silently switch to Auto Mode & reset cloud mode tracker!
  if (!connected) {
    if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      wifiAlertActive     = false;
      botMode             = "auto";
      screenLocked        = false;
      hasInitialCloudSync = false;
      lastCloudMode       = "";
      xSemaphoreGive(stateMutex);
    } else {
      wifiAlertActive     = false;
      botMode             = "auto";
      screenLocked        = false;
      hasInitialCloudSync = false;
      lastCloudMode       = "";
    }
    digitalWrite(PIN_BUZZER, LOW);
    updateGreenLed();
    Serial.println("[WiFi] Truly Offline (reason=" + String(lastDisconnectReason) + ") -> Silent Auto Mode");
    return;
  }

  // WiFi CONNECTED -> Exact 3-second OLED + Buzzer + Green LED Blink, ALWAYS defaults to Auto Mode!
  if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    wifiAlertActive     = true;
    wifiAlertConnected  = true;
    wifiAlertStartMs    = nowMs;
    wifiAlertUntilMs    = nowMs + 3000UL;
    lastWifiAlertBeepMs = 0;
    isSleeping          = false;
    botMode             = "auto";
    screenLocked        = false;
    hasInitialCloudSync = false;
    lastCloudMode       = "";
    xSemaphoreGive(stateMutex);
  } else {
    wifiAlertActive     = true;
    wifiAlertConnected  = true;
    wifiAlertStartMs    = nowMs;
    wifiAlertUntilMs    = nowMs + 3000UL;
    lastWifiAlertBeepMs = 0;
    isSleeping          = false;
    botMode             = "auto";
    screenLocked        = false;
    hasInitialCloudSync = false;
    lastCloudMode       = "";
  }

  updateGreenLed();
  drawWifiStatusOled(true, frameCount);
  Serial.println("[WiFi CONNECTED 3s] IP=" + WiFi.localIP().toString() + " -> Default Auto Mode");
}

void logEspInteraction() {
  totalHitsToday++;
  struct tm t;
  if (getLocalTime(&t, 5)) {
    hourlyHits[t.tm_hour % 24]++;
  } else {
    hourlyHits[(millis() / 3600000UL) % 24]++;
  }
}

// Custom 128x64 Touchpad Bitmap
${customBitmapBlock}

void decodeHexBitmap(const String& hex) {
  if (hex.length() < 2048) return;
  for (int i = 0; i < 1024; i++) {
    char hi = hex[i * 2];
    char lo = hex[i * 2 + 1];
    uint8_t h = (hi >= 'a') ? (hi - 'a' + 10) : (hi >= 'A') ? (hi - 'A' + 10) : (hi - '0');
    uint8_t l = (lo >= 'a') ? (lo - 'a' + 10) : (lo >= 'A') ? (lo - 'A' + 10) : (lo - '0');
    customTouchpadBitmap[i] = (h << 4) | l;
  }
}

// -------- Single Green LED (GPIO 26, No Resistor) --------
void updateGreenLed() {
  bool ledOn = false;
  if (wifiAlertActive) {
    // #1 TOP PRIORITY: Fast unmistakable Green LED notification blink for exact 3s on WiFi Connected!
    ledOn = ((millis() / 110UL) % 2 == 0);
  } else if (greenLedMode == "on") ledOn = true;
  else if (greenLedMode == "off") ledOn = false;
  else if (greenLedMode == "blink") ledOn = ((millis() / 280UL) % 2 == 0);
  else ledOn = alarmRinging ? ((millis() / 160UL) % 2 == 0) : !isSleeping;

  digitalWrite(PIN_LED_GREEN, ledOn ? HIGH : LOW);
  digitalWrite(PIN_LED_ONBOARD, ledOn ? HIGH : LOW);
}

// -------- Zero-Conflict Piezo Buzzer Driver (Passive & Active) --------
void playToneSafe(int freqHz, int durationMs, bool forceDc = false) {
  if (forceDc || buzzerActiveMode || freqHz <= 0) {
    digitalWrite(PIN_BUZZER, HIGH);
    unsigned long start = millis();
    while (millis() - start < (unsigned long)durationMs) {
      updateGreenLed();
      delay(4);
      yield();
    }
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }
  long halfPeriodUs = 500000L / freqHz;
  if (halfPeriodUs < 50) halfPeriodUs = 50;
  unsigned long endUs = micros() + (unsigned long)durationMs * 1000UL;
  int cycles = 0;
  while ((long)(endUs - micros()) > 0) {
    digitalWrite(PIN_BUZZER, HIGH);
    delayMicroseconds(halfPeriodUs);
    digitalWrite(PIN_BUZZER, LOW);
    delayMicroseconds(halfPeriodUs);
    if ((++cycles & 31) == 0) {
      updateGreenLed();
      yield();
    }
  }
  digitalWrite(PIN_BUZZER, LOW);
}

void playHappyChime() {
  playToneSafe(523, 75); delay(20);
  playToneSafe(659, 75); delay(20);
  playToneSafe(784, 100); delay(20);
  playToneSafe(1046, 130);
}

// Crisp 1-second pulse called 5 times across the 5-second WiFi ON / OFF priority alert
void playWifiAlertPulse(bool connected) {
  if (connected) {
    // Rising bright connected chime (WiFi ON)
    playToneSafe(1550, 85);
    updateGreenLed();
    delay(35);
    playToneSafe(2250, 115);
  } else {
    // Urgent falling alert beep (WiFi OFF)
    playToneSafe(2200, 95);
    updateGreenLed();
    delay(35);
    playToneSafe(1250, 130);
  }
  updateGreenLed();
}

// Loud, crisp Bip-Bip-Bip alarm sound pattern on GPIO 14 (Classic / Gentle / Urgent)
void playAlarmBipPattern(int melody) {
  if (melody == 1) {
    // Gentle Chime
    playToneSafe(587, 130); delay(45);
    playToneSafe(784, 130); delay(45);
    playToneSafe(1046, 200);
  } else if (melody == 2) {
    // Urgent Siren: Bip-Bop-Bip-Bop!
    playToneSafe(2400, 90); delay(30);
    playToneSafe(1600, 90); delay(30);
    playToneSafe(2400, 90); delay(30);
    playToneSafe(1600, 90); delay(30);
    playToneSafe(2600, 150);
  } else {
    // Classic Digital Alarm: BIP - BIP - BIP - BEEP!
    playToneSafe(2000, 100); delay(55);
    playToneSafe(2000, 100); delay(55);
    playToneSafe(2000, 100); delay(55);
    playToneSafe(2400, 170);
  }
}

// -------- Smooth 24-FPS OLED Helper Drawings --------
void drawHeart(int x, int y, int size) {
  display.fillCircle(x - size / 2, y, size / 2, SSD1306_WHITE);
  display.fillCircle(x + size / 2, y, size / 2, SSD1306_WHITE);
  display.fillTriangle(x - size, y + 1, x + size, y + 1, x, y + size + 3, SSD1306_WHITE);
}

void drawStar(int x, int y, int r) {
  display.drawLine(x - r, y, x + r, y, SSD1306_WHITE);
  display.drawLine(x, y - r, x, y + r, SSD1306_WHITE);
  display.drawLine(x - r + 2, y - r + 2, x + r - 2, y + r - 2, SSD1306_WHITE);
  display.drawLine(x - r + 2, y + r - 2, x + r - 2, y - r + 2, SSD1306_WHITE);
}

// -------- Silky-Smooth 24-FPS Interpolated 25 Face Expressions --------
void drawFace(int type, int frame) {
  display.clearDisplay();
  float t = frame * 0.22f;
  int bob = (int)round(sinf(t) * 2.2f);
  int drift = (int)round(sinf(t * 0.55f) * 3.5f);

  // Smooth multi-step eyelid blink curve
  int bp = frame % 72;
  int eyeH = 28;
  if (bp == 0 || bp == 4) eyeH = 16;
  else if (bp == 1 || bp == 3) eyeH = 8;
  else if (bp == 2) eyeH = 3;

  switch (type) {
    case 0: // 1. Normal Blink (smooth eyelid + gentle gaze)
      {
        int yOff = (28 - eyeH) / 2;
        int gx = (int)round(sinf(t * 0.35f) * 2.5f);
        if (eyeH <= 4) {
          display.fillRect(26, 28, 28, 3, SSD1306_WHITE);
          display.fillRect(74, 28, 28, 3, SSD1306_WHITE);
        } else {
          int rad = min(8, eyeH / 2);
          display.fillRoundRect(26, 16 + bob + yOff, 28, eyeH, rad, SSD1306_WHITE);
          display.fillRoundRect(74, 16 + bob + yOff, 28, eyeH, rad, SSD1306_WHITE);
          if (eyeH >= 14) {
            display.fillCircle(35 + gx, 23 + bob + yOff / 2, 3, SSD1306_BLACK);
            display.fillCircle(83 + gx, 23 + bob + yOff / 2, 3, SSD1306_BLACK);
          }
        }
        display.drawRoundRect(56, 50, 16, 4, 2, SSD1306_WHITE);
      }
      break;

    case 1: // 2. Super Happy (smooth joyful bounce)
      {
        int bounce = (int)round(sinf(t * 1.4f) * 2.5f);
        display.fillCircle(40, 30 + bounce, 14, SSD1306_WHITE);
        display.fillCircle(40, 36 + bounce, 14, SSD1306_BLACK);
        display.fillCircle(88, 30 + bounce, 14, SSD1306_WHITE);
        display.fillCircle(88, 36 + bounce, 14, SSD1306_BLACK);
        display.fillCircle(64, 44, 10, SSD1306_WHITE);
        display.fillRect(50, 32, 28, 12, SSD1306_BLACK);
      }
      break;

    case 2: // 3. Cute Wink
      display.fillRoundRect(26, 16 + bob, 28, 28, 8, SSD1306_WHITE);
      display.fillCircle(34, 23 + bob, 3, SSD1306_BLACK);
      display.drawLine(74, 28 + bob, 88, 22 + bob, SSD1306_WHITE);
      display.drawLine(74, 28 + bob, 88, 34 + bob, SSD1306_WHITE);
      display.drawCircle(64, 46, 7, SSD1306_WHITE);
      display.fillRect(54, 38, 20, 8, SSD1306_BLACK);
      break;

    case 3: // 4. Freezing Cold
      {
        int shiver = (int)round(sinf(frame * 1.9f) * 2.2f);
        display.drawRoundRect(26 + shiver, 18, 28, 24, 5, SSD1306_WHITE);
        display.drawRoundRect(74 + shiver, 18, 28, 24, 5, SSD1306_WHITE);
        display.fillCircle(40 + shiver, 30, 4, SSD1306_WHITE);
        display.fillCircle(88 + shiver, 30, 4, SSD1306_WHITE);
        for (int x = 44; x < 84; x += 8) {
          display.drawLine(x + shiver, 52, x + 4 + shiver, 48, SSD1306_WHITE);
          display.drawLine(x + 4 + shiver, 48, x + 8 + shiver, 52, SSD1306_WHITE);
        }
      }
      break;

    case 4: // 5. In Love (smooth heartbeat)
      {
        int pulse = (int)round(10.0f + sinf(t * 1.8f) * 2.2f);
        drawHeart(40, 22, pulse);
        drawHeart(88, 22, pulse);
        display.drawCircle(64, 48, 8, SSD1306_WHITE);
        display.fillRect(54, 39, 20, 9, SSD1306_BLACK);
      }
      break;

    case 5: // 6. Angry
      {
        int throb = (int)round(sinf(t * 2.2f) * 1.2f);
        display.fillRoundRect(26, 20 + throb, 28, 22, 4, SSD1306_WHITE);
        display.fillRoundRect(74, 20 + throb, 28, 22, 4, SSD1306_WHITE);
        display.fillTriangle(24, 14 + throb, 56, 26 + throb, 56, 14 + throb, SSD1306_BLACK);
        display.fillTriangle(104, 14 + throb, 72, 26 + throb, 72, 14 + throb, SSD1306_BLACK);
        display.drawLine(50, 52, 78, 52, SSD1306_WHITE);
      }
      break;

    case 6: // 7. Surprised
      {
        int pr = (int)round(5.0f + sinf(t * 2.0f) * 1.4f);
        display.drawCircle(40, 26, 14, SSD1306_WHITE);
        display.fillCircle(40, 26, pr, SSD1306_WHITE);
        display.drawCircle(88, 26, 14, SSD1306_WHITE);
        display.fillCircle(88, 26, pr, SSD1306_WHITE);
        display.drawCircle(64, 50, 7, SSD1306_WHITE);
      }
      break;

    case 7: // 8. Sleepy (smooth floating Zzz)
      {
        int zOff = (int)((frame * 35 / 100) % 10);
        display.drawLine(26, 30, 54, 30, SSD1306_WHITE);
        display.drawLine(74, 30, 102, 30, SSD1306_WHITE);
        display.drawCircle(64, 48, 4 + (int)round(sinf(t * 0.6f)), SSD1306_WHITE);
        display.setTextSize(1);
        display.setTextColor(SSD1306_WHITE);
        display.setCursor(96 + (int)round(sinf(t * 0.5f) * 2.0f), 16 - zOff);
        display.print("Zzz");
      }
      break;

    case 8: // 9. Cool Shades
      display.fillRect(20, 18 + bob, 38, 16, SSD1306_WHITE);
      display.fillRect(70, 18 + bob, 38, 16, SSD1306_WHITE);
      display.drawLine(58, 22 + bob, 70, 22 + bob, SSD1306_WHITE);
      display.drawLine(26, 22 + bob, 34, 30 + bob, SSD1306_BLACK);
      display.drawLine(76, 22 + bob, 84, 30 + bob, SSD1306_BLACK);
      display.drawLine(54, 50, 74, 46, SSD1306_WHITE);
      break;

    case 9: // 10. Sad Puppy
      display.fillRoundRect(26, 22, 28, 22, 6, SSD1306_WHITE);
      display.fillRoundRect(74, 22, 28, 22, 6, SSD1306_WHITE);
      display.fillTriangle(24, 18, 44, 18, 24, 28, SSD1306_BLACK);
      display.fillTriangle(104, 18, 84, 18, 104, 28, SSD1306_BLACK);
      display.drawCircle(64, 56, 10, SSD1306_WHITE);
      display.fillRect(50, 56, 28, 12, SSD1306_BLACK);
      break;

    case 10: // 11. Crying (smooth falling tears)
      {
        int tearL = (int)((frame * 14 / 10) % 24);
        int tearR = (int)((frame * 14 / 10 + 12) % 24);
        display.drawLine(26, 26, 54, 26, SSD1306_WHITE);
        display.drawLine(74, 26, 102, 26, SSD1306_WHITE);
        display.fillCircle(32, 30 + tearL, 2, SSD1306_WHITE);
        display.fillCircle(96, 30 + tearR, 2, SSD1306_WHITE);
        display.drawRoundRect(52, 46, 24, 10, 4, SSD1306_WHITE);
      }
      break;

    case 11: // 12. Dizzy
      {
        int r = max(2, (int)round(7.5f + sinf(t * 2.2f) * 3.5f));
        display.drawCircle(40, 26, 12, SSD1306_WHITE);
        display.drawCircle(40, 26, r, SSD1306_WHITE);
        display.drawCircle(88, 26, 12, SSD1306_WHITE);
        display.drawCircle(88, 26, r, SSD1306_WHITE);
        display.drawLine(52, 50, 60, 46, SSD1306_WHITE);
        display.drawLine(60, 46, 68, 52, SSD1306_WHITE);
        display.drawLine(68, 52, 76, 48, SSD1306_WHITE);
      }
      break;

    case 12: // 13. Starry Eyed
      {
        int sr = (int)round(10.5f + sinf(t * 2.1f) * 2.2f);
        drawStar(40, 26, sr);
        drawStar(88, 26, sr);
        display.fillCircle(64, 48, 8, SSD1306_WHITE);
        display.fillRect(54, 39, 20, 9, SSD1306_BLACK);
      }
      break;

    case 13: // 14. Skeptical
      display.fillRect(26, 24, 28, 10, SSD1306_WHITE);
      display.fillRoundRect(74, 16, 28, 26, 6, SSD1306_WHITE);
      display.drawLine(52, 50, 76, 48, SSD1306_WHITE);
      break;

    case 14: // 15. Cheeky Tongue
      display.fillRoundRect(26, 16, 28, 26, 8, SSD1306_WHITE);
      display.fillRoundRect(74, 16, 28, 26, 8, SSD1306_WHITE);
      display.drawLine(48, 46, 80, 46, SSD1306_WHITE);
      display.fillRoundRect(60, 46, 12, (int)round(10.0f + sinf(t * 1.8f) * 2.5f), 4, SSD1306_WHITE);
      break;

    case 15: // 16. Kawaii Cat
      display.fillCircle(40, 26 + bob, 11, SSD1306_WHITE);
      display.fillCircle(36, 22 + bob, 3, SSD1306_BLACK);
      display.fillCircle(88, 26 + bob, 11, SSD1306_WHITE);
      display.fillCircle(84, 22 + bob, 3, SSD1306_BLACK);
      display.drawCircle(58, 48, 6, SSD1306_WHITE);
      display.drawCircle(70, 48, 6, SSD1306_WHITE);
      display.fillRect(50, 40, 28, 8, SSD1306_BLACK);
      break;

    case 16: // 17. Knocked Out
      display.drawLine(30, 18, 50, 36, SSD1306_WHITE);
      display.drawLine(50, 18, 30, 36, SSD1306_WHITE);
      display.drawLine(78, 18, 98, 36, SSD1306_WHITE);
      display.drawLine(98, 18, 78, 36, SSD1306_WHITE);
      display.drawLine(52, 50, 76, 50, SSD1306_WHITE);
      break;

    case 17: // 18. Thinking
      display.drawRoundRect(26, 18, 28, 24, 6, SSD1306_WHITE);
      display.fillCircle(44 + drift, 24, 5, SSD1306_WHITE);
      display.drawRoundRect(74, 18, 28, 24, 6, SSD1306_WHITE);
      display.fillCircle(92 + drift, 24, 5, SSD1306_WHITE);
      display.drawCircle(68, 50, 4, SSD1306_WHITE);
      break;

    case 18: // 19. Shy Blushing
      display.fillCircle(40, 26, 10, SSD1306_WHITE);
      display.fillCircle(88, 26, 10, SSD1306_WHITE);
      display.drawLine(22, 40, 26, 44, SSD1306_WHITE);
      display.drawLine(28, 40, 32, 44, SSD1306_WHITE);
      display.drawLine(96, 40, 100, 44, SSD1306_WHITE);
      display.drawLine(102, 40, 106, 44, SSD1306_WHITE);
      display.drawCircle(64, 48, 5, SSD1306_WHITE);
      display.fillRect(56, 42, 16, 6, SSD1306_BLACK);
      break;

    case 19: // 20. Angry Shout
      display.fillTriangle(26, 18, 54, 30, 26, 34, SSD1306_WHITE);
      display.fillTriangle(102, 18, 74, 30, 102, 34, SSD1306_WHITE);
      display.fillRoundRect(48, 41, 32, (int)round(15.0f + sinf(t * 2.5f) * 3.0f), 6, SSD1306_WHITE);
      break;

    case 20: // 21. Cyclops Alien
      display.drawCircle(64, 26, 18, SSD1306_WHITE);
      display.fillCircle(64 + (int)round(sinf(t * 0.9f) * 8.0f), 26, 7, SSD1306_WHITE);
      display.drawLine(50, 52, 78, 52, SSD1306_WHITE);
      break;

    case 21: // 22. Money Eyes
      display.setTextSize(3);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(32, 16 + bob);
      display.print("$");
      display.setCursor(80, 16 + bob);
      display.print("$");
      display.drawCircle(64, 48, 8, SSD1306_WHITE);
      display.fillRect(54, 39, 20, 9, SSD1306_BLACK);
      break;

    case 22: // 23. Robot Scanning (smooth back-and-forth sweep)
      {
        int scanX = (int)round((sinf(t * 1.4f) + 1.0f) * 11.0f);
        display.drawRect(24, 18, 32, 20, SSD1306_WHITE);
        display.fillRect(26 + scanX, 20, 6, 16, SSD1306_WHITE);
        display.drawRect(72, 18, 32, 20, SSD1306_WHITE);
        display.fillRect(74 + scanX, 20, 6, 16, SSD1306_WHITE);
        display.drawRect(46, 48, 36, 6, SSD1306_WHITE);
      }
      break;

    case 23: // 24. Smug Proud
      display.fillRoundRect(26, 22, 28, 16, 4, SSD1306_WHITE);
      display.fillRoundRect(74, 22, 28, 16, 4, SSD1306_WHITE);
      display.drawLine(52, 48, 66, 50, SSD1306_WHITE);
      display.drawLine(66, 50, 78, 44, SSD1306_WHITE);
      break;

    case 24: // 25. Looking Around (silky sinusoidal eye glide)
      {
        int dir = (int)round(sinf(t * 0.8f) * 7.5f);
        display.drawRoundRect(24, 14, 30, 28, 8, SSD1306_WHITE);
        display.fillCircle(39 + dir, 28, 7, SSD1306_WHITE);
        display.drawRoundRect(74, 14, 30, 28, 8, SSD1306_WHITE);
        display.fillCircle(89 + dir, 28, 7, SSD1306_WHITE);
        display.drawLine(56, 50, 72, 50, SSD1306_WHITE);
      }
      break;
  }
  display.display();
}

// -------- Watch, Weather, Greeting, Text & Alarm Screens --------
void drawWatchOled() {
  struct tm t;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(2, 3);
  display.print(cityName.substring(0, 10));
  display.setCursor(92, 3);
  display.print(String((int)round(liveTempC)) + "C");
  display.drawFastHLine(0, 14, 128, SSD1306_WHITE);

  if (getLocalTime(&t, 5)) {
    char timeBuf[10];
    strftime(timeBuf, sizeof(timeBuf), "%H:%M", &t);
    display.setTextSize(3);
    display.setCursor(16, 21);
    display.print(timeBuf);

    char dateBuf[20];
    strftime(dateBuf, sizeof(dateBuf), "%a %d %b %Y", &t);
    display.drawFastHLine(0, 50, 128, SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(16, 54);
    display.print(dateBuf);
  } else {
    display.setTextSize(1);
    display.setCursor(18, 28);
    display.print("Syncing NTP Time");
  }
  display.display();
}

void drawWeatherOled() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(2, 3);
  display.print(cityName.substring(0, 14));
  display.drawFastHLine(0, 14, 128, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(14, 22);
  display.print(String(liveTempC, 1) + " C");

  display.setTextSize(1);
  display.setCursor(14, 42);
  display.print("H:" + String(liveHumidity) + "% W:" + String((int)liveWindKmh) + "k");
  display.drawFastHLine(0, 52, 128, SSD1306_WHITE);
  display.setCursor(10, 55);
  display.print(liveTempC <= coldThresholdC ? "Today is too cold!" : liveCondition);
  display.display();
}

void drawGreetingOled() {
  struct tm t;
  String greet = "Hello";
  if (getLocalTime(&t, 5)) {
    if (t.tm_hour >= 5 && t.tm_hour < 12) greet = "Good Morning";
    else if (t.tm_hour >= 12 && t.tm_hour < 17) greet = "Good Afternoon";
    else if (t.tm_hour >= 17 && t.tm_hour < 21) greet = "Good Evening";
    else greet = "Good Night";
  }
  display.clearDisplay();
  display.drawRoundRect(2, 2, 124, 60, 6, SSD1306_WHITE);
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(18, 16);
  display.print(greet);
  display.setTextSize(2);
  display.setCursor(18, 32);
  display.print(userName);
  display.display();
}

void drawCustomTextOled() {
  display.clearDisplay();
  display.drawRoundRect(2, 2, 124, 60, 5, SSD1306_WHITE);
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(10, 16);
  display.print(customLine1.substring(0, 18));
  if (customLine2.length() > 0) {
    display.setTextSize(2);
    display.setCursor(10, 32);
    display.print(customLine2.substring(0, 9));
  }
  display.display();
}

void drawAlarmOled(int idx, int frame) {
  display.clearDisplay();
  bool inv = ((frame / 6) % 2 == 0);
  if (inv) {
    display.fillRect(0, 0, 128, 16, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
  } else {
    display.drawRect(0, 0, 128, 16, SSD1306_WHITE);
    display.setTextColor(SSD1306_WHITE);
  }
  display.setTextSize(1);
  display.setCursor(22, 4);
  display.print("ALARM RINGING!");

  display.setTextColor(SSD1306_WHITE);
  char buf[8];
  snprintf(buf, sizeof(buf), "%02d:%02d", alarms[idx].hour, alarms[idx].minute);
  display.setTextSize(2);
  display.setCursor(32, 24);
  display.print(buf);
  display.setTextSize(1);
  display.setCursor(14, 48);
  display.print(alarms[idx].label);
  display.display();
}

// -------- #1 TOP-PRIORITY 5-Second WiFi ON / OFF OLED Screen (With Live 5s Progress Bar!) --------
void drawWifiArc(int cx, int cy, int r) {
  for (int deg = -135; deg <= -45; deg += 4) {
    float rad = deg * 0.0174533f;
    int px = cx + (int)round(cosf(rad) * r);
    int py = cy + (int)round(sinf(rad) * r);
    display.drawPixel(px, py, SSD1306_WHITE);
    display.drawPixel(px, py - 1, SSD1306_WHITE);
  }
}

void drawWifiStatusOled(bool connected, int frame) {
  display.clearDisplay();
  display.drawRoundRect(0, 0, 128, 64, 5, SSD1306_WHITE);

  int cx = 32;
  int cy = 34;
  if (connected) {
    // Animated pulsing WiFi signal waves (WiFi ON)
    int wavePhase = (frame / 4) % 4;
    display.fillCircle(cx, cy, 3, SSD1306_WHITE);
    if (wavePhase >= 1) drawWifiArc(cx, cy, 9);
    if (wavePhase >= 2) drawWifiArc(cx, cy, 15);
    if (wavePhase >= 3) drawWifiArc(cx, cy, 21);

    // Happy checkmark badge + status text
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(58, 10);
    display.print("WIFI ON!");
    display.setCursor(58, 22);
    display.print("CONNECTED");
    display.setCursor(58, 34);
    display.print("AUTO MODE");
  } else {
    // Bold flashing WiFi OFF icon with diagonal slash
    bool flash = ((frame / 4) % 2 == 0);
    display.fillCircle(cx, cy, 3, SSD1306_WHITE);
    drawWifiArc(cx, cy, 10);
    drawWifiArc(cx, cy, 17);
    if (flash) {
      display.drawLine(14, 14, 50, 38, SSD1306_WHITE);
      display.drawLine(14, 15, 50, 39, SSD1306_WHITE);
      display.drawLine(15, 14, 51, 38, SSD1306_WHITE);
    }

    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(58, 10);
    display.print("WIFI OFF!");
    display.setCursor(58, 22);
    display.print("AUTO MODE");
    display.setCursor(58, 34);
    display.print("CACHED SYNC");
  }

  // Live 3-second countdown progress bar across the bottom
  unsigned long nowMs = millis();
  long remMs = (long)(wifiAlertUntilMs - nowMs);
  if (remMs < 0) remMs = 0;
  if (remMs > 3000) remMs = 3000;
  int barW = (int)((remMs * 114L) / 3000L);
  display.drawRect(6, 48, 116, 10, SSD1306_WHITE);
  if (barW > 0) {
    display.fillRect(7, 49, barW, 8, SSD1306_WHITE);
  }
  display.display();
}

// -------- Native Silky-Smooth 24-FPS Focus Timer Screen (Zero 1.2s Stutter!) --------
void drawTimerOled(int frame) {
  unsigned long nowMs = millis();
  long remMs = (long)(localTimerEndMs - nowMs);
  if (remMs <= 0) {
    localTimerActive = false;
    customLine1 = localTimerLabel + " DONE!";
    customLine2 = "NICE JOB!";
    activeScreen = "text";
    screenLocked = true;
    pendingBuzzerMode = "happy";
    pendingBuzzer = true;
    drawCustomTextOled();
    return;
  }

  int remSec = (int)((remMs + 999) / 1000);
  int mm = remSec / 60;
  int ss = remSec % 60;
  char buf[8];
  snprintf(buf, sizeof(buf), "%02d:%02d", mm, ss);

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(4, 3);
  display.print(localTimerLabel.substring(0, 12) + " TIMER");
  // Subtle pulsing dot
  if ((frame / 8) % 2 == 0) {
    display.fillCircle(120, 6, 2, SSD1306_WHITE);
  }
  display.drawFastHLine(0, 13, 128, SSD1306_WHITE);

  display.setTextSize(3);
  display.setCursor(18, 21);
  display.print(buf);

  // Smooth fractional 24-FPS progress bar
  long totalMs = (long)max(1, localTimerTotalSec) * 1000L;
  int fillW = (int)((remMs * 116L) / totalMs);
  if (fillW < 0) fillW = 0;
  if (fillW > 116) fillW = 116;
  display.drawRect(5, 50, 118, 9, SSD1306_WHITE);
  if (fillW > 0) {
    display.fillRect(6, 51, fillW, 7, SSD1306_WHITE);
  }
  display.display();
}

// =========================================================================
// CORE 0 BACKGROUND CLOUD SYNC, WEATHER & AUTO-OTA (Zero OLED Stutter!)
// =========================================================================
void fetchWeatherCloud() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = "http://api.open-meteo.com/v1/forecast?latitude=" + String(locLat, 4) +
               "&longitude=" + String(locLon, 4) +
               "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto";
  http.begin(url);
  http.setTimeout(4000);
  if (http.GET() == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      liveTempC    = doc["current"]["temperature_2m"] | liveTempC;
      liveHumidity = doc["current"]["relative_humidity_2m"] | liveHumidity;
      liveWindKmh  = doc["current"]["wind_speed_10m"] | liveWindKmh;
      int wcode    = doc["current"]["weather_code"] | 0;
      if (wcode == 0) liveCondition = "Clear Sky";
      else if (wcode <= 3) liveCondition = "Partly Cloudy";
      else if (wcode >= 51 && wcode <= 82) liveCondition = "Rainy";
      else if (wcode >= 95) liveCondition = "Thunderstorm";
      else liveCondition = "Cloudy";
      saveWeatherCacheToNvs();
    }
  }
  http.end();
}

void checkVercelOtaUpdate() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, OTA_URL);
  http.setTimeout(5000);
  if (http.GET() == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      String remoteVer = doc["version"] | "";
      String binUrl    = doc["binUrl"] | "";
      if (remoteVer.length() > 0 && remoteVer != String(FW_VER) && binUrl.startsWith("http")) {
        Serial.println("New Vercel OTA firmware found: " + remoteVer);
        WiFiClientSecure otaClient;
        otaClient.setInsecure();
        httpUpdate.update(otaClient, binUrl);
      }
    }
  }
  http.end();
}

void pollVercelCloudOnce() {
  if (WiFi.status() != WL_CONNECTED) {
    cloudOnline = false;
    return;
  }

  // Fresh clean TLS client per 2.5s poll -> ZERO stale half-closed Vercel socket hangs, ZERO WiFi drops!
  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(5);

  HTTPClient http;
  http.setReuse(false);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(client, CLOUD_URL)) {
    cloudOnline = false;
    client.stop();
    return;
  }
  http.setTimeout(4000);
  int code = http.GET();
  if (code == 200) {
    cloudOnline = true;
    String body = http.getString();
    JsonDocument doc;
    if (!deserializeJson(doc, body)) {
      int64_t upd = doc["updatedAt"] | (int64_t)0;

      // Sync smooth native 24-FPS Focus Timer from cloud timestamps (immune to NTP drift!)
      bool tActive      = doc["timerActive"] | false;
      int64_t tEndAtMs  = doc["timerEndAtMs"] | (int64_t)0;
      int64_t srvNowMs  = doc["serverTimeMs"] | (int64_t)0;
      int tDurSec       = doc["timerDurationSec"] | 1500;
      String tLabel     = String(doc["timerLabel"] | "FOCUS");

      if (tActive && tEndAtMs > srvNowMs && srvNowMs > 0) {
        if (tEndAtMs != lastSyncedTimerEnd) {
          lastSyncedTimerEnd = tEndAtMs;
          unsigned long remMs = (unsigned long)(tEndAtMs - srvNowMs);
          if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            localTimerActive   = true;
            localTimerLabel    = tLabel;
            localTimerEndMs    = millis() + remMs;
            localTimerTotalSec = max(1, tDurSec);
            isSleeping         = false;
            xSemaphoreGive(stateMutex);
          }
        }
      } else if (!tActive && localTimerActive) {
        if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
          localTimerActive   = false;
          lastSyncedTimerEnd = 0;
          xSemaphoreGive(stateMutex);
        }
      }

      if (upd > 0 && upd != lastCloudUpdatedAt) {
        lastCloudUpdatedAt = upd;
        logEspInteraction();

        String docMode   = String(doc["mode"] | "auto");
        int    docModeSeq = doc["modeSeq"] | 0;
        String newScreen = String(doc["screen"] | "auto");
        int    newFace   = doc["faceId"] | currentFace;
        String newL1     = String(doc["textLine1"] | "");
        String newL2     = String(doc["textLine2"] | "");
        String newLed    = String(doc["greenLed"] | "auto");
        String newUser   = String(doc["userName"] | "Muhib");
        String newCity   = String(doc["city"] | "Dhaka");
        int    buzSeq    = doc["buzzerSeq"] | 0;
        String buzMode   = String(doc["buzzerMode"] | "tone");
        int    bmpSeq    = doc["bitmapSeq"] | 0;
        String bmpHex    = String(doc["bitmapHex"] | "");
        int    disSeq    = doc["alarmDismissSeq"] | 0;
        int    testSeq   = doc["alarmTestSeq"] | 0;
        int    testSlot  = doc["alarmTestSlot"] | 0;
        int    otaSeq    = doc["otaTriggerSeq"] | 0;

        bool alarmsChanged = false;
        bool profileChanged = (newUser != userName || newCity != cityName);

        if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(150)) == pdTRUE) {
          // STRICT DEFAULT AUTO MODE RULE:
          // On initial sync after boot or WiFi reconnect, NEVER jump into stale "user" mode!
          // Only switch between "auto" and "user" when user explicitly toggles mode in the portal!
          if (!hasInitialCloudSync) {
            hasInitialCloudSync = true;
            lastModeSeq   = docModeSeq;
            lastCloudMode = docMode;
            lastBitmapSeq = bmpSeq;
            lastBuzzerSeq = buzSeq;
            botMode       = "auto";
            screenLocked  = false;
          } else {
            bool explicitModeChange =
              (docModeSeq > 0 && docModeSeq != lastModeSeq) ||
              (lastCloudMode.length() > 0 && docMode != lastCloudMode);
            if (explicitModeChange) {
              lastModeSeq   = docModeSeq;
              lastCloudMode = docMode;
              botMode       = (docMode == "user") ? "user" : "auto";
              if (botMode == "auto") {
                screenLocked = false;
                isSleeping   = false;
              }
            }
          }

          greenLedMode = newLed;
          userName     = newUser;
          cityName     = newCity;

          // Only accept manual screen/face/bitmap locks when actively in User Mode!
          if (botMode == "user") {
            activeScreen = newScreen;
            currentFace  = constrain(newFace, 0, 24);
            if (newL1.length() > 0) customLine1 = newL1;
            customLine2  = newL2;
            screenLocked = (newScreen != "auto");
            isSleeping   = (newScreen == "face" && currentFace == 7);

            if (bmpSeq > lastBitmapSeq) {
              lastBitmapSeq = bmpSeq;
              if (bmpHex.length() >= 2048) {
                decodeHexBitmap(bmpHex);
                activeScreen = "bitmap";
                screenLocked = true;
              }
            }
          } else {
            // In Auto Mode: always stay unlocked & cycling freely!
            screenLocked  = false;
            lastBitmapSeq = bmpSeq;
          }

          if (doc["alarms"].is<JsonArray>()) {
            JsonArray arr = doc["alarms"].as<JsonArray>();
            int idx = 0;
            for (JsonObject a : arr) {
              if (idx >= MAX_ALARMS) break;
              int nh    = a["hour"] | 7;
              int nm    = a["min"] | 0;
              bool ne   = a["on"] | false;
              int nf    = a["face"] | 1;
              int ny    = a["melody"] | 0;
              String nl = String(a["label"] | "Alarm");
              if (alarms[idx].hour != nh || alarms[idx].minute != nm ||
                  alarms[idx].enabled != ne || alarms[idx].faceId != nf ||
                  alarms[idx].melody != ny || alarms[idx].label != nl) {
                alarmsChanged = true;
              }
              alarms[idx].hour    = nh;
              alarms[idx].minute  = nm;
              alarms[idx].enabled = ne;
              alarms[idx].faceId  = nf;
              alarms[idx].melody  = ny;
              alarms[idx].label   = nl;
              idx++;
            }
            if (alarmCount != idx) alarmsChanged = true;
            alarmCount = idx;
          }

          if (buzSeq > lastBuzzerSeq) {
            lastBuzzerSeq = buzSeq;
            pendingBuzzerMode = buzMode;
            pendingBuzzer = true;
          }

          if (testSeq > lastAlarmTestSeq) {
            lastAlarmTestSeq = testSeq;
            if (alarmCount > 0) {
              ringingAlarmIdx = constrain(testSlot, 0, alarmCount - 1);
            } else {
              alarms[0] = { 7, 0, true, 1, 0, "FaceBot Alarm" };
              alarmCount = 1;
              ringingAlarmIdx = 0;
            }
            alarmRinging = true;
            isSleeping = false;
          }

          if (disSeq > lastAlarmDismissSeq) {
            lastAlarmDismissSeq = disSeq;
            alarmRinging = false;
            ringingAlarmIdx = -1;
          }

          xSemaphoreGive(stateMutex);
          Serial.println("[Cloud Sync] botMode=" + botMode + " docMode=" + docMode + " screen=" + newScreen);
        }

        if (alarmsChanged) saveAlarmsCacheToNvs();
        if (profileChanged) saveWeatherCacheToNvs();

        if (otaSeq > lastOtaTriggerSeq) {
          lastOtaTriggerSeq = otaSeq;
          http.end();
          client.stop();
          checkVercelOtaUpdate();
          return;
        }
      }
    }
  } else {
    cloudOnline = false;
    Serial.println("[Cloud Sync] HTTP retry code: " + String(code));
  }
  http.end();
  client.stop();
}

void cloudSyncTask(void* param) {
  unsigned long lastWeatherMs = 0;
  unsigned long lastGentleRetryMs = millis();

  for (;;) {
    bool wifiNow = (WiFi.status() == WL_CONNECTED);

    if (!wifiNow) {
      cloudOnline = false;
      // Do NOT spam WiFi.begin() every few seconds (it interrupts ESP32 auto-reconnect!).
      // Only issue a gentle reconnect if offline for >15 seconds continuously.
      if (wifiLostSinceMs > 0 && (millis() - wifiLostSinceMs >= 15000UL) &&
          (millis() - lastGentleRetryMs >= 15000UL)) {
        lastGentleRetryMs = millis();
        Serial.println("[WiFi] Offline >15s -> Gentle reconnect to: " + wifiSsid);
        WiFi.reconnect();
      }
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    // Ensure NTP clock is configured whenever WiFi comes online
    if (!ntpConfigured) {
      ntpConfigured = true;
      configTime(utcOffsetSec, 0, "pool.ntp.org", "time.google.com");
      Serial.println("[WiFi] Connected! IP=" + WiFi.localIP().toString() + " | Syncing NTP Time...");
    }

    pollVercelCloudOnce();

    if (millis() - lastWeatherMs > 600000UL || lastWeatherMs == 0) {
      lastWeatherMs = millis();
      fetchWeatherCloud();
    }

    // Balanced 2.5s cloud poll -> gives Core 0 WiFi driver plenty of idle time (ZERO WiFi drops!)
    vTaskDelay(pdMS_TO_TICKS(2500));
  }
}

// -------- Alarm Scheduler & Local Optional HTTP API --------
void checkAlarms() {
  struct tm t;
  if (!getLocalTime(&t, 5)) return;
  int nowMin = t.tm_hour * 60 + t.tm_min;
  if (nowMin == lastTriggeredMin) return;

  for (int i = 0; i < alarmCount; i++) {
    if (alarms[i].enabled && alarms[i].hour == t.tm_hour && alarms[i].minute == t.tm_min) {
      lastTriggeredMin = nowMin;
      alarmRinging = true;
      ringingAlarmIdx = i;
      isSleeping = false;
      break;
    }
  }
}

void sendCorsOk(const String& body = "OK", const char* mime = "text/plain") {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, mime, body);
}

void setupLocalApi() {
  server.on("/api/stats", []() {
    String json = "{\\"total\\":" + String(totalHitsToday) + ",\\"hourly\\":[";
    for (int h = 0; h < 24; h++) {
      json += String(hourlyHits[h]);
      if (h < 23) json += ",";
    }
    json += "]}";
    sendCorsOk(json, "application/json");
  });

  server.on("/api/mode", []() {
    if (server.hasArg("mode")) {
      String reqMode = server.arg("mode");
      if (WiFi.status() == WL_CONNECTED && (reqMode == "auto" || reqMode == "user")) {
        botMode = reqMode;
        preferredOnlineMode = reqMode;
        if (reqMode == "auto") screenLocked = false;
        logEspInteraction();
      } else {
        botMode = "auto";
        screenLocked = false;
      }
    }
    sendCorsOk(botMode);
  });

  server.on("/api/face", []() {
    if (server.hasArg("id")) {
      currentFace = constrain(server.arg("id").toInt(), 0, 24);
      activeScreen = "face";
      screenLocked = true;
      isSleeping = (currentFace == 7);
      alarmRinging = false;
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/screen", []() {
    if (server.hasArg("kind")) {
      activeScreen = server.arg("kind");
      screenLocked = true;
      isSleeping = false;
      if (server.hasArg("l1")) customLine1 = server.arg("l1");
      if (server.hasArg("l2")) customLine2 = server.arg("l2");
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/led", []() {
    if (server.hasArg("green")) {
      greenLedMode = server.arg("green");
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/buzzer", []() {
    pendingBuzzerMode = server.hasArg("mode") ? server.arg("mode") : "tone";
    pendingBuzzer = true;
    logEspInteraction();
    sendCorsOk();
  });

  server.on("/api/bitmap", HTTP_POST, []() {
    String hex = server.arg("plain");
    hex.trim();
    if (hex.length() >= 2048) {
      decodeHexBitmap(hex);
      activeScreen = "bitmap";
      screenLocked = true;
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/wifi", []() {
    if (server.hasArg("ssid") && server.hasArg("pass")) {
      wifiSsid = server.arg("ssid");
      wifiPassword = server.arg("pass");
      prefs.begin("facebot", false);
      prefs.putString("ssid", wifiSsid);
      prefs.putString("pass", wifiPassword);
      prefs.end();
      sendCorsOk("Saved! Rebooting...");
      delay(300);
      ESP.restart();
      return;
    }
    sendCorsOk();
  });

  server.on("/api/alarm/set", []() {
    int slot = server.hasArg("slot") ? constrain(server.arg("slot").toInt(), 0, MAX_ALARMS - 1) : 0;
    alarms[slot].hour    = server.hasArg("hour") ? server.arg("hour").toInt() : 7;
    alarms[slot].minute  = server.hasArg("min") ? server.arg("min").toInt() : 0;
    alarms[slot].enabled = server.hasArg("on") ? (server.arg("on").toInt() != 0) : true;
    alarms[slot].faceId  = server.hasArg("face") ? server.arg("face").toInt() : 1;
    alarms[slot].melody  = server.hasArg("melody") ? server.arg("melody").toInt() : 0;
    alarms[slot].label   = server.hasArg("label") ? server.arg("label") : "Alarm";
    if (slot + 1 > alarmCount) alarmCount = slot + 1;
    logEspInteraction();
    sendCorsOk();
  });

  server.on("/api/alarm/test", []() {
    int slot = server.hasArg("slot") ? constrain(server.arg("slot").toInt(), 0, max(0, alarmCount - 1)) : 0;
    if (alarmCount == 0) {
      alarms[0] = { 7, 0, true, 1, 0, "Test Alarm" };
      alarmCount = 1;
      slot = 0;
    }
    ringingAlarmIdx = slot;
    alarmRinging = true;
    isSleeping = false;
    logEspInteraction();
    sendCorsOk();
  });

  server.on("/api/alarm/dismiss", []() {
    alarmRinging = false;
    ringingAlarmIdx = -1;
    sendCorsOk();
  });

  server.begin();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\\n=== Muhib Creation FaceBot ESP32 Booting ===");

  Wire.begin(21, 22);
  Wire.setClock(400000); // Fast 400kHz I2C for ultra-smooth 24-FPS OLED!

  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_LED_GREEN, OUTPUT);
  digitalWrite(PIN_LED_GREEN, LOW);
  pinMode(PIN_LED_ONBOARD, OUTPUT);
  digitalWrite(PIN_LED_ONBOARD, LOW);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 init failed! Check SDA=21, SCL=22, VCC=3.3V, GND=GND.");
    for (;;) delay(500);
  }

  // Boot Confirmation: Green LED blink + Crisp Chime
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_ONBOARD, HIGH);
    delay(90);
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_ONBOARD, LOW);
    delay(70);
  }
  playHappyChime();

  // Load saved WiFi + previously synced offline cache (weather, alarms, city, user)
  prefs.begin("facebot", true);
  String savedSsid = prefs.getString("ssid", "");
  String savedPass = prefs.getString("pass", "");
  prefs.end();
  if (savedSsid.length() > 0) {
    wifiSsid = savedSsid;
    wifiPassword = savedPass;
  }

${alarmInitLines.length > 0 ? alarmInitLines.join('\n') : '  alarms[0] = { 7, 0, true, 1, 0, "Good Morning" }; alarmCount = 1;'}
  loadOfflineCacheFromNvs();

  stateMutex = xSemaphoreCreateMutex();

  // Rock-Solid WiFi Init: Safe 15dBm TX power (ZERO USB 3.3V brownout!), Modem-Sleep OFF, AutoReconnect!
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setTxPower(WIFI_POWER_15dBm);
  WiFi.onEvent(onEsp32WifiEvent);

  Serial.println("[WiFi] Connecting to 2.4GHz SSID: " + wifiSsid);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(4, 12);
  display.println("Muhib Creation v" + String(FW_VER));
  display.setCursor(4, 28);
  display.println("Connecting Home WiFi:");
  display.setCursor(4, 42);
  display.println(wifiSsid);
  display.display();

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) {
    delay(150);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleep(false);
    esp_wifi_set_ps(WIFI_PS_NONE);
    wifiGotIpFlag   = false;
    wifiLinkDownFlag = false;
    wifiLostSinceMs = 0;
    ntpConfigured   = true;
    configTime(utcOffsetSec, 0, "pool.ntp.org", "time.google.com");
    triggerWifiAlert3s(true);
  } else {
    Serial.println("[WiFi] Offline at boot -> Silent Auto Mode (NVS Cache)");
    botMode         = "auto";
    screenLocked    = false;
    wifiTrulyOnline = false;
    wifiLostSinceMs = millis();
  }

  setupLocalApi();

  // Launch Core 0 Background Cloud Sync Task (16KB stack for rock-solid TLS!)
  xTaskCreatePinnedToCore(cloudSyncTask, "CloudSync", 16384, NULL, 1, NULL, 0);
  lastCycleSwitchMs = millis();
}

void loop() {
  server.handleClient();

  // 1. Debounced WiFi State Watcher (Filters <4s router beacon blips; triggers 3s alert on genuine reconnect!)
  static unsigned long lastWifiCheckMs = 0;
  if (millis() - lastWifiCheckMs >= 250UL) {
    lastWifiCheckMs = millis();
    bool linkUp = (WiFi.status() == WL_CONNECTED);

    if (linkUp) {
      wifiLostSinceMs = 0;
      if (!wifiTrulyOnline || wifiGotIpFlag) {
        bool wasOffline = !wifiTrulyOnline;
        wifiGotIpFlag = false;
        wifiTrulyOnline = true;
        if (wasOffline) {
          triggerWifiAlert3s(true); // Exact 3s OLED + Buzzer + LED Blink -> Default Auto Mode!
        }
      }
    } else {
      if (wifiLostSinceMs == 0) {
        wifiLostSinceMs = millis();
      }
      // Wait 4 continuous seconds before declaring truly offline (ignores 1-2s AP roaming glitches!)
      if (wifiTrulyOnline && (millis() - wifiLostSinceMs >= 4000UL)) {
        triggerWifiAlert3s(false); // Silent Auto Mode (ZERO WiFi OFF notification!)
      }
    }
  }

  // 2. Manage 3-second top-priority WiFi Connected notification (OLED + Buzzer + Green LED blink together!)
  if (wifiAlertActive) {
    if ((long)(millis() - wifiAlertUntilMs) >= 0) {
      wifiAlertActive = false;
      digitalWrite(PIN_BUZZER, LOW);
    } else if (lastWifiAlertBeepMs == 0 || millis() - lastWifiAlertBeepMs >= 1000UL) {
      lastWifiAlertBeepMs = millis();
      playWifiAlertPulse(true);
    }
  }

  updateGreenLed();
  checkAlarms();

  // Handle pending buzzer chimes requested from Vercel Cloud (only when WiFi 5s alert isn't active)
  if (pendingBuzzer && !wifiAlertActive) {
    pendingBuzzer = false;
    if (pendingBuzzerMode == "dc") playToneSafe(0, 220, true);
    else if (pendingBuzzerMode == "happy" || pendingBuzzerMode == "wake") playHappyChime();
    else if (pendingBuzzerMode == "alarm") {
      playAlarmBipPattern(0);
    } else {
      // Crisp double Bip-Bip piezo beep
      playToneSafe(1800, 100); delay(50); playToneSafe(2200, 130);
    }
  }

  // Ring active alarm with unmistakable Bip-Bip-Bip melody every 1.25s (suppressed during 5s WiFi alert)
  if (!wifiAlertActive && alarmRinging && ringingAlarmIdx >= 0 && ringingAlarmIdx < MAX_ALARMS) {
    static unsigned long lastBeep = 0;
    if (millis() - lastBeep >= 1250) {
      lastBeep = millis();
      playAlarmBipPattern(alarms[ringingAlarmIdx].melody);
    }
  }

  // Automatic Screen Sequencer when unlocked (Auto Mode runs offline with cached weather, alarms & faces!)
  if (!wifiAlertActive && !alarmRinging && !localTimerActive && !isSleeping && !screenLocked) {
    unsigned long holdMs = (activeScreen == "watch")
      ? (unsigned long)watchDurSec * 1000UL
      : (activeScreen == "weather")
        ? (unsigned long)weatherDurSec * 1000UL
        : (unsigned long)faceDurSec * 1000UL;

    if (millis() - lastCycleSwitchMs >= holdMs) {
      lastCycleSwitchMs = millis();
      cycleStep++;
      int slot = cycleStep % 6;
      if (slot == 0) activeScreen = "watch";
      else if (slot == 1) activeScreen = "weather";
      else if (slot == 2) activeScreen = "greeting";
      else {
        activeScreen = "face";
        currentFace = (currentFace + 1) % 25;
        if (currentFace == 7) currentFace = 8;
      }
    }
  }

  // Silky-Smooth 24-FPS OLED Renderer (~42ms per frame) on Core 1!
  static unsigned long lastFrameMs = 0;
  if (millis() - lastFrameMs >= 42) {
    lastFrameMs = millis();
    frameCount++;

    if (!stateMutex || xSemaphoreTake(stateMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
      if (wifiAlertActive) {
        // #1 ABSOLUTE TOP PRIORITY: 5-Second WiFi ON / OFF OLED Notification!
        drawWifiStatusOled(wifiAlertConnected, frameCount);
      } else if (alarmRinging && ringingAlarmIdx >= 0) {
        drawAlarmOled(ringingAlarmIdx, frameCount);
      } else if (localTimerActive) {
        // Native 24-FPS Smooth Focus Timer!
        drawTimerOled(frameCount);
      } else if (activeScreen == "watch") {
        drawWatchOled();
      } else if (activeScreen == "weather") {
        if (liveTempC <= coldThresholdC && (frameCount % 96 < 48)) {
          drawFace(3, frameCount);
        } else {
          drawWeatherOled();
        }
      } else if (activeScreen == "greeting") {
        drawGreetingOled();
      } else if (activeScreen == "text") {
        drawCustomTextOled();
      } else if (activeScreen == "bitmap") {
        display.clearDisplay();
        display.drawBitmap(0, 0, customTouchpadBitmap, 128, 64, SSD1306_WHITE);
        display.display();
      } else {
        drawFace(currentFace, frameCount);
      }
      if (stateMutex) xSemaphoreGive(stateMutex);
    }
  }
}
`;
}
