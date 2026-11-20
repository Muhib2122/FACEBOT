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

  return `const unsigned char ${varName}[] PROGMEM = {\n${lines.join(',\n')}\n};`;
}

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
    : `const unsigned char customTouchpadBitmap[1024] PROGMEM = { 0 };`;

  const enabledItems = playlist.filter((p) => p.enabled);
  const watchDur = enabledItems.find((p) => p.kind === 'watch')?.durationSec ?? 8;
  const weatherDur = enabledItems.find((p) => p.kind === 'weather')?.durationSec ?? 6;
  const faceDur = enabledItems.find((p) => p.kind === 'face')?.durationSec ?? 5;

  const safeSsid = (hardware.wifiSsid || 'muhib').replace(/"/g, '');
  const safePass = (hardware.wifiPassword || '12345678').replace(/"/g, '');
  const safePortalUrl = (hardware.cloudPortalUrl || 'https://your-facebot.vercel.app').replace(/\/$/, '').replace(/"/g, '');
  const safeDeviceId = (hardware.deviceId || 'muhib-bot-1').replace(/"/g, '');
  const safeFwVersion = (hardware.firmwareVersion || '1.0.0').replace(/"/g, '');
  const cloudStateUrl =
    hardware.cloudBackendType === 'firebase-rtdb' && hardware.firebaseDbUrl.trim()
      ? hardware.firebaseDbUrl.trim().replace(/"/g, '')
      : `${safePortalUrl}/api/bot-state?device=${safeDeviceId}`;

  const alarmInitLines = alarms.slice(0, 8).map((a, idx) => {
    const [hh, mm] = a.time.split(':').map(Number);
    const safeLabel = a.label.replace(/"/g, '').slice(0, 18);
    const melodyCode = a.melody === 'gentle' ? 1 : a.melody === 'urgent' ? 2 : 0;
    return `  alarms[${idx}] = { ${hh || 7}, ${mm || 0}, ${a.enabled ? 'true' : 'false'}, ${a.faceId}, ${melodyCode}, "${safeLabel}" };`;
  });

  return `/*
 * =========================================================================
 * ESP32 Mini Face Bot — Complete Firmware (Vercel Cloud Sync + GitHub OTA)
 * Generated for: ${settings.userName || 'Muhib'} (${location.city}, ${location.country})
 * Firmware Version: ${safeFwVersion}
 * =========================================================================
 * Mechanical Design:
 *   - SG90 Servo Motor forms the rotating neck base (0..180 deg, 90 deg = straight).
 *   - HC-SR04 Ultrasonic Sensor is mounted on the servo horn.
 *   - 0.96" SSD1306 OLED Display is mounted directly ABOVE the HC-SR04 so the face
 *     always looks directly at the detected user!
 *   - When NO object is detected in range, the servo smoothly centers to 90 deg
 *     and calls headServo.detach() (powered OFF, zero jitter).
 *
 * Cloud Sync & Over-The-Air (OTA) Updates via GitHub -> Vercel:
 *   - Live Portal Controls: ESP32 polls your Vercel portal JSON every 2.5s over HTTPS.
 *   - C++ Display/Function Updates: Push compiled /public/ota/firmware.bin + version.json
 *     to GitHub -> Vercel deploys -> ESP32 downloads & flashes itself over WiFi!
 *
 * Required Arduino Libraries:
 *   1. Adafruit SSD1306
 *   2. Adafruit GFX Library
 *   3. ESP32Servo (by Kevin Harrington)
 *   4. ArduinoJson (v7+)
 *   (WiFiClientSecure & HTTPUpdate are built into the ESP32 Board package!)
 *
 * Pinout Wiring:
 *   - 0.96" SSD1306 OLED (I2C): SDA -> GPIO 21, SCL -> GPIO 22, VCC -> 3.3V, GND -> GND
 *   - SG90 Servo Motor (Head) : Signal -> GPIO 13, VCC -> 5V (VIN), GND -> GND
 *   - Piezo Buzzer            : (+) -> GPIO 14, (-) -> GND
 *   - HC-SR04 Ultrasonic      : TRIG -> GPIO 5, ECHO -> GPIO 18 (use 1k/2k divider), VCC -> 5V, GND -> GND
 *   - Green Status LED        : Anode -> GPIO 26 (via 220 ohm), Cathode -> GND
 *   - Red Alert LED           : Anode -> GPIO 27 (via 220 ohm), Cathode -> GND
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
#include <ESP32Servo.h>
#include <time.h>

// -------- Default Home WiFi (Editable Live via Admin Panel & Saved in NVS) --------
String wifiSsid     = "${safeSsid}";
String wifiPassword = "${safePass}";
Preferences prefs;

// -------- Vercel Cloud Sync & GitHub OTA Firmware Configuration --------
const char* FIRMWARE_VERSION = "${safeFwVersion}";
String portalBaseUrl   = "${safePortalUrl}";
String cloudStateUrl   = "${cloudStateUrl}";
bool   cloudSyncOn     = ${hardware.cloudSyncEnabled ? 'true' : 'false'};
bool   otaAutoCheck    = ${hardware.otaAutoCheck ? 'true' : 'false'};
unsigned long lastCloudSyncMs = 0;
unsigned long lastOtaCheckMs  = 0;
int    lastDismissSeq  = 0;
int    lastOtaSeq      = 0;

// -------- User, Location & Timezone Configuration --------
String userName       = "${settings.userName || 'Muhib'}";
String cityName       = "${location.city}";
float  locLat         = ${location.latitude.toFixed(4)};
float  locLon         = ${location.longitude.toFixed(4)};
long   utcOffsetSec   = ${utcOffsetSeconds};
float  coldThresholdC = ${settings.coldThresholdC.toFixed(1)};
float  hotThresholdC  = ${settings.hotThresholdC.toFixed(1)};

// -------- Hardware Pin Definitions --------
#define SCREEN_WIDTH   128
#define SCREEN_HEIGHT   64
#define OLED_RESET      -1
#define PIN_SERVO       13
#define PIN_BUZZER      14
#define PIN_TRIG         5
#define PIN_ECHO        18
#define PIN_LED_GREEN   26
#define PIN_LED_RED     27

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Servo headServo;
WebServer server(80);

// -------- Multi-Alarm Schedule (up to 8 custom alarms from Web Portal) --------
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

// -------- State, Servo Tracking & Idle Power-Off Variables --------
String botMode            = "auto"; // "auto" or "user"
String activeScreen       = "face"; // "face", "watch", "weather", "greeting", "text"
String customLine1        = "";
String customLine2        = "";
int    currentFace        = 0;
int    frameCount         = 0;
bool   isSleeping         = false;
bool   ultrasonicOn       = ${hardware.ultrasonicEnabled ? 'true' : 'false'};
bool   trackingEnabled    = ${hardware.trackingEnabled ? 'true' : 'false'};
bool   servoOffWhenIdle   = ${hardware.servoPowerOffWhenIdle ? 'true' : 'false'};
int    wakeDistCm         = ${hardware.wakeDistanceCm};
int    trackRangeCm       = ${hardware.trackingRangeCm};
int    servoAngle         = 90;
int    trackedUserAngle   = 90;
bool   objectLocked       = false;
bool   servoAttached      = false;
bool   manualServo        = false;
unsigned long lastObjectSeenMs = 0;

// Screen durations (seconds) customizable via Web Portal
unsigned long watchDurationMs   = ${watchDur}000;
unsigned long weatherDurationMs = ${weatherDur}000;
unsigned long faceDurationMs    = ${faceDur}000;

// Live Weather Cache
float  liveTempC      = 24.0;
int    liveHumidity   = 65;
float  liveWindKmh    = 6.0;
String liveCondition  = "Clear";
unsigned long lastWeatherFetch = 0;

// Custom Touchpad Bitmap (128x64 monochrome)
${customBitmapBlock}

// -------- Servo Safe Power Management (Attach / Smooth Move / Auto-Off at 90 deg) --------
void moveServoSmooth(int targetAngle) {
  targetAngle = constrain(targetAngle, 15, 165);
  if (!servoAttached) {
    headServo.attach(PIN_SERVO);
    servoAttached = true;
  }
  headServo.write(targetAngle);
  servoAngle = targetAngle;
}

void parkAndPowerOffServo() {
  if (servoAngle != 90) {
    moveServoSmooth(90);
    delay(280); // Wait for head to face straight ahead
  }
  if (servoOffWhenIdle && servoAttached) {
    headServo.detach(); // Servo OFF -> zero hum, zero holding current
    servoAttached = false;
  }
}

// -------- Helper Drawing Functions --------
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

// -------- All 25 Dynamic Face Expressions --------
void drawFace(int type, int frame) {
  display.clearDisplay();
  int bob = (frame % 2 == 0) ? 0 : -2;

  switch (type) {
    case 0: // 1. Normal Blink
      if (frame % 12 == 0) {
        display.fillRect(26, 28, 28, 4, SSD1306_WHITE);
        display.fillRect(74, 28, 28, 4, SSD1306_WHITE);
      } else {
        display.fillRoundRect(26, 16 + bob, 28, 28, 8, SSD1306_WHITE);
        display.fillRoundRect(74, 16 + bob, 28, 28, 8, SSD1306_WHITE);
        display.fillCircle(34, 23 + bob, 3, SSD1306_BLACK);
        display.fillCircle(82, 23 + bob, 3, SSD1306_BLACK);
      }
      display.drawRoundRect(56, 50, 16, 4, 2, SSD1306_WHITE);
      break;

    case 1: // 2. Super Happy
      display.fillCircle(40, 30 + bob, 14, SSD1306_WHITE);
      display.fillCircle(40, 36 + bob, 14, SSD1306_BLACK);
      display.fillCircle(88, 30 + bob, 14, SSD1306_WHITE);
      display.fillCircle(88, 36 + bob, 14, SSD1306_BLACK);
      display.fillCircle(64, 44, 10, SSD1306_WHITE);
      display.fillRect(50, 32, 28, 12, SSD1306_BLACK);
      break;

    case 2: // 3. Cute Wink
      display.fillRoundRect(26, 16, 28, 28, 8, SSD1306_WHITE);
      display.fillCircle(34, 23, 3, SSD1306_BLACK);
      display.drawLine(74, 28, 88, 22, SSD1306_WHITE);
      display.drawLine(74, 28, 88, 34, SSD1306_WHITE);
      display.drawCircle(64, 46, 7, SSD1306_WHITE);
      display.fillRect(54, 38, 20, 8, SSD1306_BLACK);
      break;

    case 3: // 4. Freezing Cold
      {
        int shiver = (frame % 2 == 0) ? -2 : 2;
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

    case 4: // 5. In Love
      {
        int pulse = (frame % 2 == 0) ? 10 : 12;
        drawHeart(40, 22, pulse);
        drawHeart(88, 22, pulse);
        display.drawCircle(64, 48, 8, SSD1306_WHITE);
        display.fillRect(54, 39, 20, 9, SSD1306_BLACK);
      }
      break;

    case 5: // 6. Angry
      display.fillRoundRect(26, 20, 28, 22, 4, SSD1306_WHITE);
      display.fillRoundRect(74, 20, 28, 22, 4, SSD1306_WHITE);
      display.fillTriangle(24, 14, 56, 26, 56, 14, SSD1306_BLACK);
      display.fillTriangle(104, 14, 72, 26, 72, 14, SSD1306_BLACK);
      display.drawLine(50, 52, 78, 52, SSD1306_WHITE);
      break;

    case 6: // 7. Surprised / Shocked
      display.drawCircle(40, 26, 14, SSD1306_WHITE);
      display.fillCircle(40, 26, 5 + (frame % 2), SSD1306_WHITE);
      display.drawCircle(88, 26, 14, SSD1306_WHITE);
      display.fillCircle(88, 26, 5 + (frame % 2), SSD1306_WHITE);
      display.drawCircle(64, 50, 7, SSD1306_WHITE);
      break;

    case 7: // 8. Sleepy
      display.drawLine(26, 30, 54, 30, SSD1306_WHITE);
      display.drawLine(74, 30, 102, 30, SSD1306_WHITE);
      display.drawCircle(64, 48, 4, SSD1306_WHITE);
      display.setTextSize(1);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(96, 14 - (frame % 6));
      display.print("Zzz");
      break;

    case 8: // 9. Cool / Thug Life
      display.fillRect(20, 18 + bob, 38, 16, SSD1306_WHITE);
      display.fillRect(70, 18 + bob, 38, 16, SSD1306_WHITE);
      display.drawLine(58, 22 + bob, 70, 22 + bob, SSD1306_WHITE);
      display.drawLine(26, 22 + bob, 34, 30 + bob, SSD1306_BLACK);
      display.drawLine(76, 22 + bob, 84, 30 + bob, SSD1306_BLACK);
      display.drawLine(54, 50, 74, 46, SSD1306_WHITE);
      break;

    case 9: // 10. Sad / Puppy Eyes
      display.fillRoundRect(26, 22, 28, 22, 6, SSD1306_WHITE);
      display.fillRoundRect(74, 22, 28, 22, 6, SSD1306_WHITE);
      display.fillTriangle(24, 18, 44, 18, 24, 28, SSD1306_BLACK);
      display.fillTriangle(104, 18, 84, 18, 104, 28, SSD1306_BLACK);
      display.drawCircle(64, 56, 10, SSD1306_WHITE);
      display.fillRect(50, 56, 28, 12, SSD1306_BLACK);
      break;

    case 10: // 11. Crying
      display.drawLine(26, 26, 54, 26, SSD1306_WHITE);
      display.drawLine(74, 26, 102, 26, SSD1306_WHITE);
      display.fillCircle(32, 32 + (frame % 4) * 5, 2, SSD1306_WHITE);
      display.fillCircle(96, 32 + ((frame + 2) % 4) * 5, 2, SSD1306_WHITE);
      display.drawRoundRect(52, 46, 24, 10, 4, SSD1306_WHITE);
      break;

    case 11: // 12. Dizzy / Confused
      {
        int r = (frame % 2 == 0) ? 10 : 7;
        display.drawCircle(40, 26, 12, SSD1306_WHITE);
        display.drawCircle(40, 26, r, SSD1306_WHITE);
        display.drawCircle(88, 26, 12, SSD1306_WHITE);
        display.drawCircle(88, 26, r, SSD1306_WHITE);
        display.drawLine(52, 50, 60, 46, SSD1306_WHITE);
        display.drawLine(60, 46, 68, 52, SSD1306_WHITE);
        display.drawLine(68, 52, 76, 48, SSD1306_WHITE);
      }
      break;

    case 12: // 13. Starry Eyed / Excited
      drawStar(40, 26, 10 + (frame % 3));
      drawStar(88, 26, 10 + (frame % 3));
      display.fillCircle(64, 48, 8, SSD1306_WHITE);
      display.fillRect(54, 39, 20, 9, SSD1306_BLACK);
      break;

    case 13: // 14. Skeptical / Suspicious
      display.fillRect(26, 24, 28, 10, SSD1306_WHITE);
      display.fillRoundRect(74, 16, 28, 26, 6, SSD1306_WHITE);
      display.drawLine(52, 50, 76, 48, SSD1306_WHITE);
      break;

    case 14: // 15. Cheeky / Tongue Out
      display.fillRoundRect(26, 16, 28, 26, 8, SSD1306_WHITE);
      display.fillRoundRect(74, 16, 28, 26, 8, SSD1306_WHITE);
      display.drawLine(48, 46, 80, 46, SSD1306_WHITE);
      display.fillRoundRect(60, 46, 12, 10 + (frame % 2) * 2, 4, SSD1306_WHITE);
      break;

    case 15: // 16. Kawaii Cat Face
      display.fillCircle(40, 26 + bob, 11, SSD1306_WHITE);
      display.fillCircle(36, 22 + bob, 3, SSD1306_BLACK);
      display.fillCircle(88, 26 + bob, 11, SSD1306_WHITE);
      display.fillCircle(84, 22 + bob, 3, SSD1306_BLACK);
      display.drawCircle(58, 48, 6, SSD1306_WHITE);
      display.drawCircle(70, 48, 6, SSD1306_WHITE);
      display.fillRect(50, 40, 28, 8, SSD1306_BLACK);
      break;

    case 16: // 17. Dead / Knocked Out
      display.drawLine(30, 18, 50, 36, SSD1306_WHITE);
      display.drawLine(50, 18, 30, 36, SSD1306_WHITE);
      display.drawLine(78, 18, 98, 36, SSD1306_WHITE);
      display.drawLine(98, 18, 78, 36, SSD1306_WHITE);
      display.drawLine(52, 50, 76, 50, SSD1306_WHITE);
      break;

    case 17: // 18. Thinking
      display.drawRoundRect(26, 18, 28, 24, 6, SSD1306_WHITE);
      display.fillCircle(46, 24, 5, SSD1306_WHITE);
      display.drawRoundRect(74, 18, 28, 24, 6, SSD1306_WHITE);
      display.fillCircle(94, 24, 5, SSD1306_WHITE);
      display.drawCircle(68, 50, 4, SSD1306_WHITE);
      break;

    case 18: // 19. Shy / Blushing
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
      display.fillRoundRect(48, 42, 32, 16, 6, SSD1306_WHITE);
      break;

    case 20: // 21. Cyclops / Alien
      display.drawCircle(64, 26, 18, SSD1306_WHITE);
      display.fillCircle(64 + ((frame % 3) - 1) * 4, 26, 7, SSD1306_WHITE);
      display.drawLine(50, 52, 78, 52, SSD1306_WHITE);
      break;

    case 21: // 22. Money / Rich Eyes
      display.setTextSize(3);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(32, 16 + bob);
      display.print("$");
      display.setCursor(80, 16 + bob);
      display.print("$");
      display.drawCircle(64, 48, 8, SSD1306_WHITE);
      display.fillRect(54, 39, 20, 9, SSD1306_BLACK);
      break;

    case 22: // 23. Robot Scanning
      {
        int scanX = (frame * 6) % 20;
        display.drawRect(24, 18, 32, 20, SSD1306_WHITE);
        display.fillRect(26 + scanX, 20, 6, 16, SSD1306_WHITE);
        display.drawRect(72, 18, 32, 20, SSD1306_WHITE);
        display.fillRect(74 + scanX, 20, 6, 16, SSD1306_WHITE);
        display.drawRect(46, 48, 36, 6, SSD1306_WHITE);
      }
      break;

    case 23: // 24. Smug / Proud
      display.fillRoundRect(26, 22, 28, 16, 4, SSD1306_WHITE);
      display.fillRoundRect(74, 22, 28, 16, 4, SSD1306_WHITE);
      display.drawLine(52, 48, 66, 50, SSD1306_WHITE);
      display.drawLine(66, 50, 78, 44, SSD1306_WHITE);
      break;

    case 24: // 25. Looking Around
      {
        int dir = ((frame / 3) % 3 - 1) * 7;
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

// -------- Real-Time NTP Watch & Weather OLED Screens --------
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

  if (getLocalTime(&t)) {
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

void drawAlarmOled(int idx, int frame) {
  display.clearDisplay();
  bool inv = (frame % 2 == 0);
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

// -------- HC-SR04 Ultrasonic Distance Reading --------
float readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long duration = pulseIn(PIN_ECHO, HIGH, 25000);
  if (duration == 0) return 999.0;
  return (duration * 0.0343) / 2.0;
}

// -------- HC-SR04 + OLED Co-Mounted User Tracking & Idle Servo Power-Off --------
void updateUltrasonicTracking() {
  if (!ultrasonicOn || manualServo) return;

  float dist = readDistanceCm();

  // Case 1: Object is right in front of the current OLED/HC-SR04 angle!
  if (dist > 2.0 && dist <= trackRangeCm) {
    objectLocked = true;
    trackedUserAngle = servoAngle;
    lastObjectSeenMs = millis();

    // If sleeping and user approaches within wakeDistCm (25cm), wake up!
    if (isSleeping && dist <= wakeDistCm) {
      isSleeping = false;
      showWakeGreeting();
    }
    return;
  }

  // Case 2: User moved slightly left/right while locked -> quick neighbor check (+/- 20 deg)
  if (trackingEnabled && objectLocked && (millis() - lastObjectSeenMs < 2500)) {
    int checkAngles[2] = {
      constrain(trackedUserAngle - 20, 35, 145),
      constrain(trackedUserAngle + 20, 35, 145)
    };
    for (int i = 0; i < 2; i++) {
      moveServoSmooth(checkAngles[i]);
      delay(130);
      float d = readDistanceCm();
      if (d > 2.0 && d <= trackRangeCm) {
        trackedUserAngle = checkAngles[i];
        lastObjectSeenMs = millis();
        return; // Keep facing the user!
      }
    }
  }

  // Case 3: No object found for 3+ seconds -> face straight ahead (90 deg) and turn Servo OFF
  if (millis() - lastObjectSeenMs > 3000) {
    objectLocked = false;
    trackedUserAngle = 90;
    parkAndPowerOffServo();
  }
}

// -------- Expressive Servo Head Motion (Anchored Around Tracked User Angle) --------
void updateServoForFace(int faceType, int frame) {
  if (manualServo) {
    moveServoSmooth(servoAngle);
    return;
  }

  // If no object is detected and not actively emoting/alarming, keep servo OFF at 90 deg
  if (!objectLocked && !alarmRinging && faceType == 0) {
    parkAndPowerOffServo();
    return;
  }

  int base = objectLocked ? trackedUserAngle : 90;
  if (faceType == 1 || faceType == 4 || faceType == 12) {
    // Happy / In Love / Excited: Sway +/- 20 deg (70 <-> 110 around center)
    moveServoSmooth((frame % 4 < 2) ? base - 20 : base + 20);
  } else if (faceType == 6) {
    // Surprised: Quick tilt to side
    moveServoSmooth(base + 26);
  } else if (faceType == 5 || faceType == 19) {
    // Angry: Rapid head shake
    moveServoSmooth((frame % 2 == 0) ? base - 18 : base + 18);
  } else if (faceType == 7 || faceType == 9) {
    // Sleepy / Sad: Gentle side droop then detach if idle
    moveServoSmooth(base + 16);
  } else if (faceType == 24) {
    int offset[3] = {-25, 0, 25};
    moveServoSmooth(base + offset[(frame / 3) % 3]);
  } else if (objectLocked) {
    // Face directly toward the detected user
    moveServoSmooth(trackedUserAngle);
  } else {
    parkAndPowerOffServo();
  }
}

void playWakeSound() {
  tone(PIN_BUZZER, 523, 90); delay(100);
  tone(PIN_BUZZER, 659, 90); delay(100);
  tone(PIN_BUZZER, 784, 120); delay(130);
  noTone(PIN_BUZZER);
}

void playAlarmBeepTick(int melody, int frame) {
  if (melody == 1) {
    int notes[3] = {440, 554, 659};
    tone(PIN_BUZZER, notes[frame % 3], 140);
  } else if (melody == 2) {
    tone(PIN_BUZZER, (frame % 2 == 0) ? 2200 : 1400, 120);
  } else {
    tone(PIN_BUZZER, (frame % 4 == 3) ? 2093 : 1760, 130);
  }
}

void checkScheduledAlarms() {
  if (alarmRinging) return;
  struct tm t;
  if (!getLocalTime(&t)) return;
  int currentMinKey = t.tm_hour * 60 + t.tm_min;
  if (currentMinKey == lastTriggeredMin || t.tm_sec > 3) return;

  for (int i = 0; i < alarmCount; i++) {
    if (alarms[i].enabled && alarms[i].hour == t.tm_hour && alarms[i].minute == t.tm_min) {
      lastTriggeredMin = currentMinKey;
      alarmRinging = true;
      ringingAlarmIdx = i;
      isSleeping = false;
      break;
    }
  }
}

void fetchWeatherFromOpenMeteo() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = "https://api.open-meteo.com/v1/forecast?latitude=" + String(locLat, 4) +
               "&longitude=" + String(locLon, 4) +
               "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code";
  http.begin(url);
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      liveTempC    = doc["current"]["temperature_2m"] | 24.0;
      liveHumidity = doc["current"]["relative_humidity_2m"] | 60;
      liveWindKmh  = doc["current"]["wind_speed_10m"] | 5.0;
    }
  }
  http.end();
}

// -------- GitHub -> Vercel Over-The-Air (OTA) Firmware Auto-Updater --------
void checkOtaFirmwareUpdate() {
  if (WiFi.status() != WL_CONNECTED || portalBaseUrl.length() < 8) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String manifestUrl = portalBaseUrl + "/ota/version.json";
  http.begin(client, manifestUrl);
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      String remoteVer = doc["version"] | "";
      String binPath   = doc["binUrl"]  | "/ota/firmware.bin";
      if (remoteVer.length() > 0 && remoteVer != String(FIRMWARE_VERSION)) {
        String fullBinUrl = binPath.startsWith("http") ? binPath : (portalBaseUrl + binPath);
        display.clearDisplay();
        display.setTextSize(1);
        display.setTextColor(SSD1306_WHITE);
        display.setCursor(10, 18);
        display.print("OTA UPDATE FOUND!");
        display.setCursor(10, 34);
        display.print("v" + String(FIRMWARE_VERSION) + " -> v" + remoteVer);
        display.setCursor(10, 48);
        display.print("Downloading...");
        display.display();

        t_httpUpdate_return ret = httpUpdate.update(client, fullBinUrl);
        if (ret == HTTP_UPDATE_FAILED) {
          Serial.printf("OTA Error (%d): %s\\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
        }
      }
    }
  }
  http.end();
}

// -------- Real-Time Cloud State Sync from Published Vercel Portal --------
void syncStateFromCloudPortal() {
  if (!cloudSyncOn || WiFi.status() != WL_CONNECTED || cloudStateUrl.length() < 8) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(2500);
  http.begin(client, cloudStateUrl);
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      if (doc["mode"].is<const char*>())         botMode         = String(doc["mode"].as<const char*>());
      if (doc["screen"].is<const char*>())       activeScreen    = String(doc["screen"].as<const char*>());
      if (doc["faceId"].is<int>())               currentFace     = constrain(doc["faceId"].as<int>(), 0, 24);
      if (doc["userName"].is<const char*>())     userName        = String(doc["userName"].as<const char*>());
      if (doc["city"].is<const char*>())         cityName        = String(doc["city"].as<const char*>());
      if (doc["textLine1"].is<const char*>())    customLine1     = String(doc["textLine1"].as<const char*>());
      if (doc["textLine2"].is<const char*>())    customLine2     = String(doc["textLine2"].as<const char*>());
      if (doc["manualServo"].is<bool>())         manualServo     = doc["manualServo"].as<bool>();
      if (doc["servoAngle"].is<int>() && manualServo) moveServoSmooth(doc["servoAngle"].as<int>());
      if (doc["ultrasonicOn"].is<bool>())        ultrasonicOn    = doc["ultrasonicOn"].as<bool>();
      if (doc["trackingOn"].is<bool>())          trackingEnabled = doc["trackingOn"].as<bool>();
      if (doc["servoIdleOff"].is<bool>())        servoOffWhenIdle = doc["servoIdleOff"].as<bool>();

      // Sync Alarms array from Vercel Portal
      if (doc["alarms"].is<JsonArray>()) {
        JsonArray arr = doc["alarms"].as<JsonArray>();
        int idx = 0;
        for (JsonObject al : arr) {
          if (idx >= MAX_ALARMS) break;
          alarms[idx].hour    = al["hour"] | 7;
          alarms[idx].minute  = al["min"] | 0;
          alarms[idx].enabled = al["on"] | false;
          alarms[idx].faceId  = al["face"] | 1;
          alarms[idx].melody  = al["melody"] | 0;
          alarms[idx].label   = String(al["label"] | "Alarm");
          idx++;
        }
        alarmCount = idx;
      }

      // Remote Alarm Dismiss from Portal
      int dismissSeq = doc["alarmDismissSeq"] | 0;
      if (dismissSeq > lastDismissSeq) {
        lastDismissSeq = dismissSeq;
        alarmRinging = false;
        ringingAlarmIdx = -1;
        noTone(PIN_BUZZER);
        digitalWrite(PIN_LED_RED, LOW);
      }

      // Remote OTA Update Trigger from Admin Panel
      int otaSeq = doc["otaTriggerSeq"] | 0;
      if (otaSeq > lastOtaSeq) {
        lastOtaSeq = otaSeq;
        http.end();
        checkOtaFirmwareUpdate();
        return;
      }
    }
  }
  http.end();
}

void showWakeGreeting() {
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED, LOW);
  playWakeSound();
  for (int i = 0; i < 6; i++) {
    drawFace((i % 2 == 0) ? 1 : 4, i);
    updateServoForFace(1, i);
    delay(240);
  }
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(14, 24);
  display.print("Hi " + userName + "!");
  display.display();
  delay(2000);
}

// -------- Real-Time Web Portal & Admin Panel HTTP Endpoints --------
void setupWebPortalRoutes() {
  server.enableCORS(true);

  // Admin Panel: Save Home WiFi SSID & Password to ESP32 Flash (NVS) & Reconnect
  server.on("/api/wifi", HTTP_GET, []() {
    if (server.hasArg("ssid") && server.hasArg("pass")) {
      wifiSsid = server.arg("ssid");
      wifiPassword = server.arg("pass");
      prefs.begin("facebot", false);
      prefs.putString("ssid", wifiSsid);
      prefs.putString("pass", wifiPassword);
      prefs.end();
      server.send(200, "application/json", "{\\"ok\\":true,\\"rebooting\\":true}");
      delay(400);
      ESP.restart();
      return;
    }
    server.send(400, "application/json", "{\\"ok\\":false}");
  });

  server.on("/api/face", HTTP_GET, []() {
    if (server.hasArg("id")) {
      currentFace = constrain(server.arg("id").toInt(), 0, 24);
      activeScreen = "face";
      isSleeping = (currentFace == 7);
      drawFace(currentFace, frameCount);
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/screen", HTTP_GET, []() {
    if (server.hasArg("kind")) {
      activeScreen = server.arg("kind");
      isSleeping = false;
    }
    if (server.hasArg("l1")) customLine1 = server.arg("l1");
    if (server.hasArg("l2")) customLine2 = server.arg("l2");
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/servo", HTTP_GET, []() {
    if (server.hasArg("angle")) {
      manualServo = true;
      moveServoSmooth(server.arg("angle").toInt());
    }
    if (server.hasArg("auto")) {
      manualServo = (server.arg("auto") == "0");
    }
    if (server.hasArg("idleoff")) {
      servoOffWhenIdle = (server.arg("idleoff") == "1");
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/sensor", HTTP_GET, []() {
    if (server.hasArg("ultrasonic")) {
      ultrasonicOn = (server.arg("ultrasonic") == "1");
    }
    if (server.hasArg("tracking")) {
      trackingEnabled = (server.arg("tracking") == "1");
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/mode", HTTP_GET, []() {
    if (server.hasArg("mode")) {
      botMode = server.arg("mode");
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/alarm/set", HTTP_GET, []() {
    int slot = server.hasArg("slot") ? constrain(server.arg("slot").toInt(), 0, MAX_ALARMS - 1) : 0;
    alarms[slot].hour    = server.hasArg("hour")   ? server.arg("hour").toInt()   : 7;
    alarms[slot].minute  = server.hasArg("min")    ? server.arg("min").toInt()    : 0;
    alarms[slot].enabled = server.hasArg("on")     ? (server.arg("on") == "1")    : true;
    alarms[slot].faceId  = server.hasArg("face")   ? server.arg("face").toInt()   : 1;
    alarms[slot].melody  = server.hasArg("melody") ? server.arg("melody").toInt() : 0;
    alarms[slot].label   = server.hasArg("label")  ? server.arg("label")          : "Alarm";
    if (slot + 1 > alarmCount) alarmCount = slot + 1;
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/alarm/dismiss", HTTP_GET, []() {
    alarmRinging = false;
    ringingAlarmIdx = -1;
    noTone(PIN_BUZZER);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_LED_GREEN, HIGH);
    server.send(200, "application/json", "{\\"ok\\":true,\\"dismissed\\":true}");
  });

  server.on("/api/alarm/test", HTTP_GET, []() {
    int slot = server.hasArg("slot") ? constrain(server.arg("slot").toInt(), 0, max(0, alarmCount - 1)) : 0;
    if (alarmCount == 0) {
      alarms[0] = { 7, 0, true, 1, 0, "Test Alarm" };
      alarmCount = 1;
    }
    alarmRinging = true;
    ringingAlarmIdx = slot;
    isSleeping = false;
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/config", HTTP_GET, []() {
    if (server.hasArg("name")) userName = server.arg("name");
    if (server.hasArg("city")) cityName = server.arg("city");
    if (server.hasArg("lat"))  locLat = server.arg("lat").toFloat();
    if (server.hasArg("lon"))  locLon = server.arg("lon").toFloat();
    if (server.hasArg("tz")) {
      utcOffsetSec = server.arg("tz").toInt();
      configTime(utcOffsetSec, 0, "pool.ntp.org");
    }
    fetchWeatherFromOpenMeteo();
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.begin();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);

  // Load saved Home WiFi credentials from NVS (falls back to muhib / 12345678)
  prefs.begin("facebot", true);
  wifiSsid     = prefs.getString("ssid", wifiSsid);
  wifiPassword = prefs.getString("pass", wifiPassword);
  prefs.end();

  // Center head straight ahead (90 deg), then detach servo if idle
  moveServoSmooth(90);
  delay(350);
  if (servoOffWhenIdle) {
    headServo.detach();
    servoAttached = false;
  }

${alarmInitLines.join('\n')}

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 OLED not found!");
    for (;;);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(10, 24);
  display.print("WiFi: " + wifiSsid);
  display.display();

  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 25) {
    delay(400);
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_LED_GREEN, HIGH);
    configTime(utcOffsetSec, 0, "pool.ntp.org");
    fetchWeatherFromOpenMeteo();
    setupWebPortalRoutes();
    if (otaAutoCheck) {
      checkOtaFirmwareUpdate(); // Auto-check GitHub/Vercel OTA on boot
    }
    Serial.print("Portal IP: ");
    Serial.println(WiFi.localIP());
  } else {
    digitalWrite(PIN_LED_RED, HIGH);
  }
}

void loop() {
  server.handleClient();
  checkScheduledAlarms();

  // Poll published Vercel Cloud Portal every 2.5 seconds for live updates
  if (cloudSyncOn && (millis() - lastCloudSyncMs > 2500)) {
    syncStateFromCloudPortal();
    lastCloudSyncMs = millis();
  }

  // Periodically check GitHub/Vercel OTA manifest every 30 minutes
  if (otaAutoCheck && (millis() - lastOtaCheckMs > 1800000)) {
    checkOtaFirmwareUpdate();
    lastOtaCheckMs = millis();
  }

  // Active Alarm Ringing State (Buzzer + Red LED + OLED Alert)
  if (alarmRinging && ringingAlarmIdx >= 0) {
    drawAlarmOled(ringingAlarmIdx, frameCount);
    playAlarmBeepTick(alarms[ringingAlarmIdx].melody, frameCount);
    digitalWrite(PIN_LED_RED, (frameCount % 2 == 0) ? HIGH : LOW);
    digitalWrite(PIN_LED_GREEN, LOW);
    updateServoForFace(19, frameCount);
    frameCount++;
    delay(220);
    return;
  }

  // HC-SR04 Proximity Wake-Up + Co-Mounted User Tracking + Idle Servo Auto-Off
  updateUltrasonicTracking();

  // Refresh live weather every 10 minutes
  if (millis() - lastWeatherFetch > 600000) {
    fetchWeatherFromOpenMeteo();
    lastWeatherFetch = millis();
  }

  // Render active OLED screen
  if (isSleeping) {
    drawFace(7, frameCount);
    if (!objectLocked) parkAndPowerOffServo();
  } else if (activeScreen == "watch") {
    drawWatchOled();
  } else if (activeScreen == "weather") {
    drawWeatherOled();
  } else if (botMode == "auto" && liveTempC <= coldThresholdC && frameCount % 30 < 10) {
    drawFace(3, frameCount);
    display.setTextSize(1);
    display.setCursor(10, 2);
    display.print("Today is too cold!");
    display.display();
    digitalWrite(PIN_LED_RED, HIGH);
  } else {
    drawFace(currentFace, frameCount);
    updateServoForFace(currentFace, frameCount);
  }

  frameCount++;
  delay(220);
}
`;
}
