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
  const fwVersion = (hardware.firmwareVersion || '3.0.0').replace(/"/g, '');

  const alarmInitLines = alarms.slice(0, 8).map((a, idx) => {
    const [hh, mm] = a.time.split(':').map(Number);
    const safeLabel = a.label.replace(/"/g, '').slice(0, 18);
    const melodyCode = a.melody === 'gentle' ? 1 : a.melody === 'urgent' ? 2 : 0;
    return `  alarms[${idx}] = { ${hh || 7}, ${mm || 0}, ${a.enabled ? 'true' : 'false'}, ${a.faceId}, ${melodyCode}, "${safeLabel}" };`;
  });

  return `/*
 * =========================================================================
 * FaceBot — Dual-Core ESP32 Cloud Firmware (Muhib Creation · v${fwVersion})
 * Control from ANYWHERE via Vercel Web Portal — Zero ESP32 WiFi Switching!
 * =========================================================================
 * ARCHITECTURE (Maximum Efficiency & Butter-Smooth 24-FPS Animations):
 *   - Core 1 (loop)         : 24-FPS silky-smooth OLED animations + Green LED + Buzzer
 *   - Core 0 (FreeRTOS Task): 1.2s Vercel Cloud HTTPS Sync + Auto OTA + Open-Meteo Weather
 *   - No Hotspot needed! ESP32 stays on Home WiFi ("${safeSsid}").
 *   - Anyone with your Vercel URL can control FaceBot from anywhere in the world!
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
String botMode          = "auto";
String activeScreen     = "face";
String customLine1      = "Hi ${safeUser}!";
String customLine2      = "";
String greenLedMode     = "auto"; // "auto", "on", "off", "blink"
int    currentFace      = 0;
int    frameCount       = 0;
bool   screenLocked     = false;
bool   isSleeping       = false;
bool   buzzerActiveMode = false;

// Pending buzzer trigger from Core 0 Cloud Sync -> executed smoothly on Core 1
volatile bool pendingBuzzer = false;
String pendingBuzzerMode    = "tone";

// Cloud deduplication counters (64-bit int64_t for JS Date.now() ms!)
int64_t lastCloudUpdatedAt = 0;
int  lastBuzzerSeq         = 0;
int  lastBitmapSeq         = 0;
int  lastAlarmDismissSeq   = 0;
int  lastOtaTriggerSeq     = 0;
bool cloudOnline           = false;

// Screen durations (seconds)
int watchDurSec   = ${watchDur};
int weatherDurSec = ${weatherDur};
int faceDurSec    = ${faceDur};
unsigned long lastCycleSwitchMs = 0;
int cycleStep = 0;

// Live Weather Cache
float  liveTempC      = 24.0;
int    liveHumidity   = 65;
float  liveWindKmh    = 6.0;
String liveCondition  = "Clear";

// Daily Interaction Stats (24 hourly buckets)
int hourlyHits[24] = { 0 };
unsigned long totalHitsToday = 0;

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
  if (greenLedMode == "on") ledOn = true;
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
    if ((++cycles & 31) == 0) yield();
  }
  digitalWrite(PIN_BUZZER, LOW);
}

void playHappyChime() {
  playToneSafe(523, 75); delay(20);
  playToneSafe(659, 75); delay(20);
  playToneSafe(784, 100); delay(20);
  playToneSafe(1046, 130);
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

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.begin(client, CLOUD_URL);
  http.setTimeout(4000);
  int code = http.GET();
  if (code == 200) {
    cloudOnline = true;
    String body = http.getString();
    JsonDocument doc;
    if (!deserializeJson(doc, body)) {
      int64_t upd = doc["updatedAt"] | (int64_t)0;
      if (upd > 0 && upd != lastCloudUpdatedAt) {
        lastCloudUpdatedAt = upd;
        logEspInteraction();

        String newMode   = String(doc["mode"] | "auto");
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
        int    otaSeq    = doc["otaTriggerSeq"] | 0;

        if (stateMutex && xSemaphoreTake(stateMutex, pdMS_TO_TICKS(150)) == pdTRUE) {
          botMode      = newMode;
          activeScreen = newScreen;
          currentFace  = constrain(newFace, 0, 24);
          if (newL1.length() > 0) customLine1 = newL1;
          customLine2  = newL2;
          greenLedMode = newLed;
          userName     = newUser;
          cityName     = newCity;
          screenLocked = (newScreen != "auto");
          isSleeping   = (newScreen == "face" && currentFace == 7);

          if (buzSeq > lastBuzzerSeq) {
            lastBuzzerSeq = buzSeq;
            pendingBuzzerMode = buzMode;
            pendingBuzzer = true;
          }

          if (bmpSeq > lastBitmapSeq) {
            lastBitmapSeq = bmpSeq;
            if (bmpHex.length() >= 2048) {
              decodeHexBitmap(bmpHex);
              activeScreen = "bitmap";
              screenLocked = true;
            }
          }

          if (disSeq > lastAlarmDismissSeq) {
            lastAlarmDismissSeq = disSeq;
            alarmRinging = false;
            ringingAlarmIdx = -1;
          }

          if (doc["alarms"].is<JsonArray>()) {
            JsonArray arr = doc["alarms"].as<JsonArray>();
            int idx = 0;
            for (JsonObject a : arr) {
              if (idx >= MAX_ALARMS) break;
              alarms[idx].hour    = a["hour"] | 7;
              alarms[idx].minute  = a["min"] | 0;
              alarms[idx].enabled = a["on"] | false;
              alarms[idx].faceId  = a["face"] | 1;
              alarms[idx].melody  = a["melody"] | 0;
              alarms[idx].label   = String(a["label"] | "Alarm");
              idx++;
            }
            alarmCount = idx;
          }
          xSemaphoreGive(stateMutex);
          Serial.println("[Cloud Sync] screen=" + newScreen + " face=" + String(newFace) + " led=" + newLed);
        }

        if (otaSeq > lastOtaTriggerSeq) {
          lastOtaTriggerSeq = otaSeq;
          http.end();
          checkVercelOtaUpdate();
          return;
        }
      }
    }
  } else {
    cloudOnline = false;
    Serial.println("[Cloud Sync] HTTP error: " + String(code));
  }
  http.end();
}

void cloudSyncTask(void* param) {
  unsigned long lastWeatherMs = 0;
  if (otaAutoCheck) {
    vTaskDelay(pdMS_TO_TICKS(2500));
    checkVercelOtaUpdate();
  }
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      vTaskDelay(pdMS_TO_TICKS(3000));
      continue;
    }

    pollVercelCloudOnce();

    if (millis() - lastWeatherMs > 600000UL || lastWeatherMs == 0) {
      lastWeatherMs = millis();
      fetchWeatherCloud();
    }

    // Fast 1.2s cloud poll interval -> near-instant control from anywhere on Vercel!
    vTaskDelay(pdMS_TO_TICKS(1200));
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

  server.begin();
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  Wire.setClock(400000); // Fast 400kHz I2C for ultra-smooth 24-FPS OLED!

  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_LED_GREEN, OUTPUT);
  digitalWrite(PIN_LED_GREEN, LOW);
  pinMode(PIN_LED_ONBOARD, OUTPUT);
  digitalWrite(PIN_LED_ONBOARD, LOW);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 init failed!");
    for (;;) delay(500);
  }

  // Boot Confirmation: Green LED blink + Happy Chime
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_ONBOARD, HIGH);
    delay(90);
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_ONBOARD, LOW);
    delay(70);
  }
  playHappyChime();

  prefs.begin("facebot", true);
  wifiSsid     = prefs.getString("ssid", wifiSsid);
  wifiPassword = prefs.getString("pass", wifiPassword);
  prefs.end();

${alarmInitLines.length > 0 ? alarmInitLines.join('\n') : '  alarms[0] = { 7, 0, true, 1, 0, "Good Morning" }; alarmCount = 1;'}

  // Connect directly to Home WiFi (No ESP32 hotspot switching needed!)
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Low-latency WiFi for instant Vercel cloud response
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
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    configTime(utcOffsetSec, 0, "pool.ntp.org", "time.google.com");
    display.clearDisplay();
    display.setCursor(4, 12);
    display.println("Vercel Cloud Ready!");
    display.setCursor(4, 28);
    display.println("LAN: " + WiFi.localIP().toString());
    display.setCursor(4, 44);
    display.println("Control from anywhere");
    display.display();
    delay(1200);
  }

  stateMutex = xSemaphoreCreateMutex();
  setupLocalApi();

  // Launch Core 0 Background Cloud Sync Task (leaves Core 1 100% dedicated to smooth OLED!)
  xTaskCreatePinnedToCore(cloudSyncTask, "CloudSync", 10240, NULL, 1, NULL, 0);
  lastCycleSwitchMs = millis();
}

void loop() {
  server.handleClient();
  updateGreenLed();
  checkAlarms();

  // Handle pending buzzer chimes requested from Vercel Cloud
  if (pendingBuzzer) {
    pendingBuzzer = false;
    if (pendingBuzzerMode == "dc") playToneSafe(0, 220, true);
    else if (pendingBuzzerMode == "happy" || pendingBuzzerMode == "wake") playHappyChime();
    else if (pendingBuzzerMode == "alarm") {
      playToneSafe(1760, 140); delay(40); playToneSafe(2093, 180);
    } else {
      playToneSafe(880, 100); delay(30); playToneSafe(1318, 140);
    }
  }

  // Ring active alarm non-blockingly
  if (alarmRinging && ringingAlarmIdx >= 0) {
    static unsigned long lastBeep = 0;
    if (millis() - lastBeep >= 900) {
      lastBeep = millis();
      int m = alarms[ringingAlarmIdx].melody;
      if (m == 1) playToneSafe(587, 160);
      else if (m == 2) playToneSafe(2200, 140);
      else playToneSafe(1760, 160);
    }
  }

  // Automatic Screen Sequencer when unlocked
  if (!alarmRinging && !isSleeping && !screenLocked) {
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
      if (alarmRinging && ringingAlarmIdx >= 0) {
        drawAlarmOled(ringingAlarmIdx, frameCount);
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
