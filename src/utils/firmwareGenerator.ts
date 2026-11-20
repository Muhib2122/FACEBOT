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
// SINGLE-BOARD ESP32 SKETCH (OLED + Piezo Buzzer + 1x Green LED, Zero Resistors!)
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
  const safeApName = `FaceBot-${safeUser.replace(/[^a-zA-Z0-9]/g, '') || 'Muhib'}`;

  const alarmInitLines = alarms.slice(0, 8).map((a, idx) => {
    const [hh, mm] = a.time.split(':').map(Number);
    const safeLabel = a.label.replace(/"/g, '').slice(0, 18);
    const melodyCode = a.melody === 'gentle' ? 1 : a.melody === 'urgent' ? 2 : 0;
    return `  alarms[${idx}] = { ${hh || 7}, ${mm || 0}, ${a.enabled ? 'true' : 'false'}, ${a.faceId}, ${melodyCode}, "${safeLabel}" };`;
  });

  return `/*
 * =========================================================================
 * FaceBot — Single-Board ESP32 Firmware (Minimal Zero-Resistor Edition)
 * Hardware: ESP32 + 0.96" SSD1306 OLED + Piezo Buzzer + 1x Green LED
 * Generated for: ${safeUser} (${location.city}, ${location.country})
 * =========================================================================
 * HOW TO CONNECT:
 *   1. ESP32 connects to Home WiFi ("${safeSsid}" / "${safePass}") for live Weather & NTP Time.
 *   2. AT THE SAME TIME, ESP32 creates its own Hotspot:
 *        Hotspot Name : ${safeApName}
 *        Password     : 12345678
 *   3. Connect phone/PC to "${safeApName}" and open:
 *        http://192.168.4.1
 *   4. Or paste ESP32's Home WiFi IP into the FaceBot AI Agent Web Portal for live AI control!
 *
 * Required Arduino Libraries (ONLY 3):
 *   1. Adafruit SSD1306
 *   2. Adafruit GFX Library
 *   3. ArduinoJson (v7+)
 *
 * Ultra-Clean ESP32 Pinout Wiring (NO Arduino, NO Servo, NO HC-SR04, ZERO Resistors!):
 *   - 0.96" SSD1306 OLED (I2C): SDA -> GPIO 21, SCL -> GPIO 22, VCC -> 3.3V, GND -> GND
 *   - Piezo Buzzer            : (+) -> GPIO 14, (-) -> GND
 *   - 1x Green LED (Direct)   : Long leg (+) -> GPIO 26, Short leg (-) -> GND
 *     (ESP32 3.3V GPIO matches standard 3.0V-3.2V Green LED forward voltage safely!)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <time.h>

// -------- Hotspot (AP) + Home WiFi (STA) Credentials --------
const char* AP_SSID = "${safeApName}";
const char* AP_PASS = "12345678";

String wifiSsid     = "${safeSsid}";
String wifiPassword = "${safePass}";
Preferences prefs;

// -------- User, Location & Timezone Configuration --------
String userName       = "${safeUser}";
String cityName       = "${location.city}";
float  locLat         = ${location.latitude.toFixed(4)};
float  locLon         = ${location.longitude.toFixed(4)};
long   utcOffsetSec   = ${utcOffsetSeconds};
float  coldThresholdC = ${settings.coldThresholdC.toFixed(1)};
float  hotThresholdC  = ${settings.hotThresholdC.toFixed(1)};

// -------- ESP32 Hardware Pins (Zero Resistors!) --------
#define SCREEN_WIDTH    128
#define SCREEN_HEIGHT    64
#define OLED_RESET       -1
#define PIN_BUZZER       14   // Piezo Buzzer (+) -> GPIO 14, (-) -> GND
#define PIN_LED_GREEN    26   // Green LED (+) -> GPIO 26, (-) -> GND (no resistor)
#define PIN_LED_ONBOARD   2   // Built-in ESP32 blue status LED mirror

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
WebServer server(80);

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

// -------- Bot Runtime State --------
String botMode          = "auto"; // "auto" or "user"
String activeScreen     = "face"; // "face", "watch", "weather", "greeting", "text", "bitmap"
String customLine1      = "Hi ${safeUser}!";
String customLine2      = "";
String greenLedMode     = "auto"; // "auto", "on", "off", "blink"
int    currentFace      = 0;
int    frameCount       = 0;
bool   screenLocked     = false;
bool   isSleeping       = false;
bool   buzzerActiveMode = false; // false = Passive melody, true = Active DC HIGH

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
unsigned long lastWeatherFetch = 0;

// Daily Interaction Stats (24 hourly buckets for Portal Dashboard Line Chart)
int hourlyHits[24] = { 0 };
unsigned long totalHitsToday = 0;

void logEspInteraction() {
  totalHitsToday++;
  struct tm t;
  if (getLocalTime(&t)) {
    hourlyHits[t.tm_hour % 24]++;
  } else {
    int approxHour = (millis() / 3600000UL) % 24;
    hourlyHits[approxHour]++;
  }
}

// Custom 128x64 Touchpad Bitmap
${customBitmapBlock}

// =========================================================================
// BUILT-IN MOBILE WEB PORTAL (Served at http://192.168.4.1 & Home WiFi IP)
// =========================================================================
const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>FaceBot ESP32 Portal</title>
<style>
  *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{margin:0;background:#0f172a;color:#f1f5f9;padding:12px 12px 48px}
  .wrap{max-width:680px;margin:0 auto}
  h1{font-size:18px;margin:0 0 4px}
  .sub{font-size:12px;color:#94a3b8;margin-bottom:14px}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;margin-bottom:12px}
  .card h2{font-size:14px;margin:0 0 10px;color:#e2e8f0}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer}
  button.sec{background:#334155;color:#e2e8f0}
  button.red{background:#dc2626}
  button.ok{background:#16a34a}
  input,select{background:#0f172a;color:#f8fafc;border:1px solid #475569;border-radius:8px;padding:8px 10px;font-size:13px;width:100%}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px}
  .grid button{padding:8px 6px;font-size:11px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;text-align:center}
  .grid button:active{background:#2563eb;border-color:#2563eb}
  .lbl{font-size:11px;color:#94a3b8;margin:6px 0 4px;display:block}
  .stat{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:10px;color:#34d399;font-family:monospace;line-height:1.5}
  canvas{width:100%;max-width:384px;aspect-ratio:2/1;background:#020617;border:2px solid #38bdf8;border-radius:8px;touch-action:none;display:block;margin:8px auto}
  .toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#2563eb;color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;display:none;z-index:99}
</style>
</head>
<body>
<div class="wrap">
  <h1>FaceBot ESP32 Local Portal</h1>
  <div class="sub" id="statusLine">Connected to Hotspot (192.168.4.1)</div>

  <!-- Green LED (GPIO 26) & Piezo Buzzer (GPIO 14) -->
  <div class="card">
    <h2>Green LED (GPIO 26) &amp; Piezo Buzzer (GPIO 14)</h2>
    <div class="stat" id="hwStat">Green LED: AUTO | Buzzer: PASSIVE</div>

    <span class="lbl">Single Green LED (Direct GPIO 26, No Resistor)</span>
    <div class="row" style="margin-bottom:10px">
      <button class="ok" onclick="cmd('/api/led?green=on','Green LED ON')">LED ON</button>
      <button class="sec" onclick="cmd('/api/led?green=off','Green LED OFF')">LED OFF</button>
      <button onclick="cmd('/api/led?green=blink','Green LED Blinking')">LED Blink</button>
      <button class="sec" onclick="cmd('/api/led?green=auto','Green LED Auto')">LED Auto</button>
    </div>

    <span class="lbl">Piezo Buzzer (GPIO 14)</span>
    <div class="row">
      <button onclick="cmd('/api/buzzer?mode=tone','Melody Beep!')">Beep Melody</button>
      <button class="ok" onclick="cmd('/api/buzzer?mode=happy','Happy Chime!')">Happy Chime</button>
      <button class="sec" onclick="cmd('/api/buzzer?mode=dc','Active DC Beep')">DC Beep</button>
      <button class="sec" onclick="cmd('/api/buzzer?type=passive','Passive Mode')">Passive</button>
      <button class="sec" onclick="cmd('/api/buzzer?type=active','Active Mode')">Active</button>
    </div>
  </div>

  <!-- Mode & OLED Screens -->
  <div class="card">
    <h2>Mode &amp; OLED Screens</h2>
    <div class="row" style="margin-bottom:8px">
      <button onclick="cmd('/api/mode?mode=auto','Auto Mode ON')">Auto Mode</button>
      <button class="sec" onclick="cmd('/api/mode?mode=user','User Mode ON')">User Mode</button>
      <button class="sec" onclick="cmd('/api/screen?kind=watch','Watch UI')">Watch UI</button>
      <button class="sec" onclick="cmd('/api/screen?kind=weather','Live Weather')">Weather</button>
      <button class="sec" onclick="cmd('/api/screen?kind=greeting','Greeting')">Greeting</button>
      <button class="sec" onclick="cmd('/api/face?id=7','Sleeping...')">Sleep</button>
    </div>
    <div class="row">
      <input id="txt1" placeholder="OLED Line 1 (e.g. Hi Muhib!)" style="flex:1;min-width:140px"/>
      <input id="txt2" placeholder="Big Line 2" style="flex:1;min-width:110px"/>
      <button onclick="sendText()">Show Text</button>
    </div>
  </div>

  <!-- User Mode Screen Durations -->
  <div class="card">
    <h2>Screen Durations (Seconds)</h2>
    <div class="row">
      <div style="flex:1"><span class="lbl">Watch (s)</span><input id="dWatch" type="number" value="8" min="2" max="120"/></div>
      <div style="flex:1"><span class="lbl">Weather (s)</span><input id="dWeather" type="number" value="6" min="2" max="120"/></div>
      <div style="flex:1"><span class="lbl">Faces (s)</span><input id="dFace" type="number" value="5" min="2" max="120"/></div>
      <button style="align-self:flex-end" onclick="saveDur()">Save</button>
    </div>
  </div>

  <!-- All 25 Face Expressions -->
  <div class="card">
    <h2>25 Dynamic Face Reactions</h2>
    <div class="grid" id="faceGrid"></div>
  </div>

  <!-- Interactive 128x64 Touchpad -->
  <div class="card">
    <h2>128x64 Finger Touchpad (Draw to OLED)</h2>
    <canvas id="pad" width="128" height="64"></canvas>
    <div class="row" style="justify-content:center;margin-top:8px">
      <button class="sec" onclick="pen=1">Draw</button>
      <button class="sec" onclick="pen=0">Erase</button>
      <button class="sec" onclick="clearPad()">Clear</button>
      <button class="ok" onclick="sendBitmap()">Send to OLED</button>
    </div>
  </div>

  <!-- Piezo Buzzer Alarm -->
  <div class="card">
    <h2>Piezo Buzzer Alarm</h2>
    <div class="row">
      <input id="alTime" type="time" value="07:00" style="width:120px"/>
      <input id="alLabel" placeholder="Alarm Label" value="Wake Up Muhib" style="flex:1;min-width:130px"/>
      <button onclick="setAlarm(1)">Set Alarm</button>
      <button class="sec" onclick="setAlarm(0)">Disable</button>
      <button class="sec" onclick="cmd('/api/alarm/test?slot=0','Testing Alarm!')">Test Ring</button>
      <button class="red" onclick="cmd('/api/alarm/dismiss','Alarm Dismissed')">Dismiss</button>
    </div>
  </div>

  <!-- Profile, City & Admin Home WiFi -->
  <div class="card">
    <h2>Admin Panel &middot; Home WiFi &amp; Profile</h2>
    <div class="row" style="margin-bottom:8px">
      <div style="flex:1;min-width:130px"><span class="lbl">Your Name</span><input id="uName" value="Muhib"/></div>
      <div style="flex:1;min-width:130px"><span class="lbl">City</span><input id="uCity" value="Dhaka"/></div>
      <button style="align-self:flex-end" onclick="saveProfile()">Save Profile</button>
    </div>
    <div class="row" style="border-top:1px solid #334155;padding-top:10px;margin-top:8px">
      <div style="flex:1;min-width:130px"><span class="lbl">Home WiFi SSID</span><input id="wSsid" value="muhib"/></div>
      <div style="flex:1;min-width:130px"><span class="lbl">Home WiFi Password</span><input id="wPass" type="text" value="12345678"/></div>
      <button class="ok" style="align-self:flex-end" onclick="saveWifi()">Save Home WiFi</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
const FACES=[
  'Normal Blink','Super Happy','Cute Wink','Freezing Cold','In Love',
  'Angry','Surprised','Sleepy','Cool Shades','Sad Puppy',
  'Crying','Dizzy','Starry Eyed','Skeptical','Cheeky Tongue',
  'Kawaii Cat','Knocked Out','Thinking','Shy Blushing','Angry Shout',
  'Cyclops','Money Eyes','Robot Scan','Smug Proud','Look Around'
];
const fg=document.getElementById('faceGrid');
FACES.forEach((n,i)=>{
  const b=document.createElement('button');
  b.textContent=(i+1)+'. '+n;
  b.onclick=()=>cmd('/api/face?id='+i,n);
  fg.appendChild(b);
});

function toast(m){
  const t=document.getElementById('toast');
  t.textContent=m;t.style.display='block';
  clearTimeout(window._tt);
  window._tt=setTimeout(()=>t.style.display='none',1800);
}
function cmd(url,msg){
  fetch(url).then(()=>{toast(msg||'Done');pollStatus(false);}).catch(()=>toast('Check WiFi connection'));
}
function sendText(){
  const l1=encodeURIComponent(document.getElementById('txt1').value);
  const l2=encodeURIComponent(document.getElementById('txt2').value);
  cmd('/api/screen?kind=text&l1='+l1+'&l2='+l2,'Text sent to OLED');
}
function saveDur(){
  const w=document.getElementById('dWatch').value;
  const we=document.getElementById('dWeather').value;
  const f=document.getElementById('dFace').value;
  cmd('/api/durations?watch='+w+'&weather='+we+'&face='+f,'Durations saved');
}
function setAlarm(on){
  const t=document.getElementById('alTime').value.split(':');
  const lbl=encodeURIComponent(document.getElementById('alLabel').value||'Alarm');
  cmd('/api/alarm/set?slot=0&hour='+parseInt(t[0])+'&min='+parseInt(t[1])+'&on='+on+'&label='+lbl,on?'Alarm Set':'Alarm Disabled');
}
function saveProfile(){
  const n=encodeURIComponent(document.getElementById('uName').value);
  const c=encodeURIComponent(document.getElementById('uCity').value);
  cmd('/api/config?name='+n+'&city='+c,'Profile Saved');
}
function saveWifi(){
  const s=encodeURIComponent(document.getElementById('wSsid').value);
  const p=encodeURIComponent(document.getElementById('wPass').value);
  cmd('/api/wifi?ssid='+s+'&pass='+p,'WiFi Saved! Rebooting...');
}

// 128x64 Finger Touchpad
const cv=document.getElementById('pad'),ctx=cv.getContext('2d');
let drawing=false,pen=1;
const px=new Uint8Array(128*64);
function clearPad(){px.fill(0);ctx.fillStyle='#020617';ctx.fillRect(0,0,128,64);}
clearPad();
function drawPt(e){
  const r=cv.getBoundingClientRect();
  const x=Math.floor((e.clientX-r.left)/r.width*128);
  const y=Math.floor((e.clientY-r.top)/r.height*64);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,ny=y+dy;
    if(nx>=0&&nx<128&&ny>=0&&ny<64){
      px[ny*128+nx]=pen;
      ctx.fillStyle=pen?'#38bdf8':'#020617';
      ctx.fillRect(nx,ny,1,1);
    }
  }
}
cv.onpointerdown=e=>{drawing=true;cv.setPointerCapture(e.pointerId);drawPt(e);};
cv.onpointermove=e=>{if(drawing)drawPt(e);};
cv.onpointerup=()=>drawing=false;

function sendBitmap(){
  let hex='';
  for(let y=0;y<64;y++){
    for(let xb=0;xb<16;xb++){
      let b=0;
      for(let bit=0;bit<8;bit++) if(px[y*128+xb*8+bit]) b|=(1<<(7-bit));
      hex+=b.toString(16).padStart(2,'0');
    }
  }
  fetch('/api/bitmap',{method:'POST',body:hex})
    .then(()=>toast('Drawing shown on OLED!'))
    .catch(()=>toast('Failed to send'));
}

function pollStatus(fillInputs){
  fetch('/api/status').then(r=>r.json()).then(d=>{
    document.getElementById('statusLine').textContent=
      'Home WiFi: '+(d.wifi?'Connected ('+d.staIp+')':'Offline')+' · Temp: '+d.temp+'C · Mode: '+d.mode;
    document.getElementById('hwStat').textContent=
      'Green LED: '+d.led.toUpperCase()+' | Buzzer: '+d.buz+' | Screen: '+d.screen;
    if(fillInputs){
      document.getElementById('uName').value=d.user;
      document.getElementById('uCity').value=d.city;
      document.getElementById('wSsid').value=d.ssid;
    }
  }).catch(()=>{});
}
pollStatus(true);
setInterval(()=>pollStatus(false), 1500);
</script>
</body>
</html>
)rawliteral";

// -------- Single Green LED (GPIO 26, No Resistor) Controller --------
void updateGreenLed() {
  bool ledOn = false;
  if (greenLedMode == "on") {
    ledOn = true;
  } else if (greenLedMode == "off") {
    ledOn = false;
  } else if (greenLedMode == "blink") {
    ledOn = ((millis() / 320UL) % 2 == 0);
  } else {
    // Auto: blink fast during alarm, OFF when sleeping, ON when awake
    if (alarmRinging) {
      ledOn = ((millis() / 180UL) % 2 == 0);
    } else {
      ledOn = !isSleeping;
    }
  }
  digitalWrite(PIN_LED_GREEN, ledOn ? HIGH : LOW);
  digitalWrite(PIN_LED_ONBOARD, ledOn ? HIGH : LOW);
}

// -------- High-Reliability Piezo Buzzer Driver (Passive & Active Supported!) --------
void playToneSafe(int freqHz, int durationMs, bool forceDc = false) {
  if (forceDc || buzzerActiveMode || freqHz <= 0) {
    digitalWrite(PIN_BUZZER, HIGH);
    unsigned long start = millis();
    while (millis() - start < (unsigned long)durationMs) {
      delay(5);
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

void stopBuzzer() {
  digitalWrite(PIN_BUZZER, LOW);
}

void playHappyChime() {
  playToneSafe(523, 85); delay(25);
  playToneSafe(659, 85); delay(25);
  playToneSafe(784, 120); delay(20);
  playToneSafe(1046, 150);
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

    case 10: // 11. Crying
      display.drawLine(26, 26, 54, 26, SSD1306_WHITE);
      display.drawLine(74, 26, 102, 26, SSD1306_WHITE);
      display.fillCircle(32, 32 + (frame % 4) * 5, 2, SSD1306_WHITE);
      display.fillCircle(96, 32 + ((frame + 2) % 4) * 5, 2, SSD1306_WHITE);
      display.drawRoundRect(52, 46, 24, 10, 4, SSD1306_WHITE);
      break;

    case 11: // 12. Dizzy
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

    case 12: // 13. Starry Eyed
      drawStar(40, 26, 10 + (frame % 3));
      drawStar(88, 26, 10 + (frame % 3));
      display.fillCircle(64, 48, 8, SSD1306_WHITE);
      display.fillRect(54, 39, 20, 9, SSD1306_BLACK);
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
      display.fillRoundRect(60, 46, 12, 10 + (frame % 2) * 2, 4, SSD1306_WHITE);
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
      display.fillCircle(46, 24, 5, SSD1306_WHITE);
      display.drawRoundRect(74, 18, 28, 24, 6, SSD1306_WHITE);
      display.fillCircle(94, 24, 5, SSD1306_WHITE);
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
      display.fillRoundRect(48, 42, 32, 16, 6, SSD1306_WHITE);
      break;

    case 20: // 21. Cyclops Alien
      display.drawCircle(64, 26, 18, SSD1306_WHITE);
      display.fillCircle(64 + ((frame % 3) - 1) * 4, 26, 7, SSD1306_WHITE);
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

    case 23: // 24. Smug Proud
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
  if (getLocalTime(&t)) {
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

// -------- Live Weather Fetch (Open-Meteo over Home WiFi) --------
void fetchWeather() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = "http://api.open-meteo.com/v1/forecast?latitude=" + String(locLat, 4) +
               "&longitude=" + String(locLon, 4) +
               "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto";
  http.begin(url);
  http.setTimeout(5000);
  int code = http.GET();
  if (code == 200) {
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

// -------- Alarm Scheduler & Piezo Buzzer Ringer --------
void checkAlarms() {
  struct tm t;
  if (!getLocalTime(&t)) return;
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

void serviceRingingAlarm() {
  if (!alarmRinging || ringingAlarmIdx < 0) return;
  static unsigned long lastBeep = 0;
  if (millis() - lastBeep >= 900) {
    lastBeep = millis();
    int m = alarms[ringingAlarmIdx].melody;
    if (m == 1) playToneSafe(587, 180);
    else if (m == 2) playToneSafe(2200, 160);
    else playToneSafe(1760, 180);
  }
}

// -------- Built-in Web Portal + AI Agent Bridge HTTP API --------
void sendCorsOk(const String& body = "OK", const char* mime = "text/plain") {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, mime, body);
}

void setupWebServer() {
  server.on("/", []() {
    server.send_P(200, "text/html", PORTAL_HTML);
  });

  server.on("/api/status", []() {
    String json = "{";
    json += "\\"wifi\\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
    json += "\\"staIp\\":\\"" + WiFi.localIP().toString() + "\\",";
    json += "\\"apIp\\":\\"" + WiFi.softAPIP().toString() + "\\",";
    json += "\\"temp\\":" + String(liveTempC, 1) + ",";
    json += "\\"mode\\":\\"" + botMode + "\\",";
    json += "\\"screen\\":\\"" + activeScreen + "\\",";
    json += "\\"face\\":" + String(currentFace) + ",";
    json += "\\"led\\":\\"" + greenLedMode + "\\",";
    json += "\\"buz\\":\\"" + String(buzzerActiveMode ? "ACTIVE" : "PASSIVE") + "\\",";
    json += "\\"user\\":\\"" + userName + "\\",";
    json += "\\"city\\":\\"" + cityName + "\\",";
    json += "\\"ssid\\":\\"" + wifiSsid + "\\"";
    json += "}";
    sendCorsOk(json, "application/json");
  });

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
      stopBuzzer();
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/mode", []() {
    if (server.hasArg("mode")) {
      botMode = server.arg("mode");
      screenLocked = false;
      isSleeping = false;
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/screen", []() {
    if (server.hasArg("kind")) {
      activeScreen = server.arg("kind");
      screenLocked = true;
      isSleeping = false;
      alarmRinging = false;
      stopBuzzer();
      if (server.hasArg("l1")) customLine1 = server.arg("l1");
      if (server.hasArg("l2")) customLine2 = server.arg("l2");
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/led", []() {
    if (server.hasArg("green")) {
      String g = server.arg("green");
      if (g == "1" || g == "on") greenLedMode = "on";
      else if (g == "0" || g == "off") greenLedMode = "off";
      else if (g == "blink") greenLedMode = "blink";
      else greenLedMode = "auto";
      updateGreenLed();
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/buzzer", []() {
    if (server.hasArg("type")) {
      buzzerActiveMode = (server.arg("type") == "active");
    }
    String modeArg = server.hasArg("mode") ? server.arg("mode") : "tone";
    if (modeArg == "dc") {
      playToneSafe(0, 250, true);
    } else if (modeArg == "happy" || modeArg == "wake") {
      playHappyChime();
    } else if (modeArg == "alarm") {
      playToneSafe(1760, 140); delay(50);
      playToneSafe(2093, 180);
    } else {
      playToneSafe(880, 110); delay(30);
      playToneSafe(1318, 150);
    }
    logEspInteraction();
    sendCorsOk();
  });

  server.on("/api/durations", []() {
    if (server.hasArg("watch")) watchDurSec = max(2, server.arg("watch").toInt());
    if (server.hasArg("weather")) weatherDurSec = max(2, server.arg("weather").toInt());
    if (server.hasArg("face")) faceDurSec = max(2, server.arg("face").toInt());
    sendCorsOk();
  });

  server.on("/api/bitmap", HTTP_POST, []() {
    String hex = server.arg("plain");
    hex.trim();
    if (hex.length() >= 2048) {
      for (int i = 0; i < 1024; i++) {
        char hi = hex[i * 2];
        char lo = hex[i * 2 + 1];
        uint8_t h = (hi >= 'a') ? (hi - 'a' + 10) : (hi >= 'A') ? (hi - 'A' + 10) : (hi - '0');
        uint8_t l = (lo >= 'a') ? (lo - 'a' + 10) : (lo >= 'A') ? (lo - 'A' + 10) : (lo - '0');
        customTouchpadBitmap[i] = (h << 4) | l;
      }
      activeScreen = "bitmap";
      screenLocked = true;
      isSleeping = false;
      logEspInteraction();
    }
    sendCorsOk();
  });

  server.on("/api/alarm/set", []() {
    int slot = server.hasArg("slot") ? constrain(server.arg("slot").toInt(), 0, MAX_ALARMS - 1) : 0;
    if (slot >= alarmCount) alarmCount = slot + 1;
    alarms[slot].hour    = server.hasArg("hour") ? constrain(server.arg("hour").toInt(), 0, 23) : 7;
    alarms[slot].minute  = server.hasArg("min") ? constrain(server.arg("min").toInt(), 0, 59) : 0;
    alarms[slot].enabled = !server.hasArg("on") || server.arg("on").toInt() == 1;
    alarms[slot].faceId  = server.hasArg("face") ? constrain(server.arg("face").toInt(), 0, 24) : 1;
    alarms[slot].melody  = server.hasArg("melody") ? constrain(server.arg("melody").toInt(), 0, 2) : 0;
    if (server.hasArg("label")) alarms[slot].label = server.arg("label").substring(0, 18);
    logEspInteraction();
    sendCorsOk();
  });

  server.on("/api/alarm/test", []() {
    int slot = server.hasArg("slot") ? constrain(server.arg("slot").toInt(), 0, MAX_ALARMS - 1) : 0;
    if (alarmCount == 0) {
      alarmCount = 1;
      alarms[0] = { 7, 0, true, 1, 0, "Test Alarm" };
    }
    ringingAlarmIdx = min(slot, alarmCount - 1);
    alarmRinging = true;
    isSleeping = false;
    sendCorsOk();
  });

  server.on("/api/alarm/dismiss", []() {
    alarmRinging = false;
    ringingAlarmIdx = -1;
    stopBuzzer();
    activeScreen = "face";
    currentFace = 0;
    screenLocked = false;
    sendCorsOk();
  });

  server.on("/api/config", []() {
    if (server.hasArg("name")) userName = server.arg("name").substring(0, 16);
    if (server.hasArg("city")) cityName = server.arg("city").substring(0, 18);
    if (server.hasArg("lat"))  locLat   = server.arg("lat").toFloat();
    if (server.hasArg("lon"))  locLon   = server.arg("lon").toFloat();
    fetchWeather();
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
      delay(400);
      ESP.restart();
      return;
    }
    sendCorsOk("Missing args");
  });

  server.begin();
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);

  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_LED_GREEN, OUTPUT);
  digitalWrite(PIN_LED_GREEN, LOW);
  pinMode(PIN_LED_ONBOARD, OUTPUT);
  digitalWrite(PIN_LED_ONBOARD, LOW);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 init failed! Check SDA=21 SCL=22 3.3V GND.");
    for (;;) delay(500);
  }

  // Boot Self-Test: Green LED flash + friendly Piezo chirp!
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_ONBOARD, HIGH);
    delay(110);
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_ONBOARD, LOW);
    delay(90);
  }
  playHappyChime();

  // Load saved Home WiFi from NVS Flash
  prefs.begin("facebot", true);
  wifiSsid     = prefs.getString("ssid", wifiSsid);
  wifiPassword = prefs.getString("pass", wifiPassword);
  prefs.end();

  // Initialize Default Alarms
${alarmInitLines.length > 0 ? alarmInitLines.join('\n') : '  alarms[0] = { 7, 0, true, 1, 0, "Good Morning" }; alarmCount = 1;'}

  // Dual-Mode WiFi: Hotspot (AP) + Home WiFi (STA)
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASS);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(4, 6);
  display.println("FaceBot AI Ready");
  display.setCursor(4, 20);
  display.println("AP: " + String(AP_SSID));
  display.setCursor(4, 34);
  display.println("IP: 192.168.4.1");
  display.setCursor(4, 48);
  display.println("WiFi: " + wifiSsid);
  display.display();

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    configTime(utcOffsetSec, 0, "pool.ntp.org", "time.google.com");
    fetchWeather();
    Serial.print("Home WiFi IP: ");
    Serial.println(WiFi.localIP());
    display.clearDisplay();
    display.setCursor(4, 14);
    display.println("WiFi Connected!");
    display.setCursor(4, 30);
    display.println("LAN: " + WiFi.localIP().toString());
    display.setCursor(4, 46);
    display.println("AP : 192.168.4.1");
    display.display();
    delay(1500);
  }

  setupWebServer();
  lastCycleSwitchMs = millis();
}

void loop() {
  server.handleClient();
  updateGreenLed();
  checkAlarms();
  serviceRingingAlarm();

  // Refresh weather every 10 minutes
  if (WiFi.status() == WL_CONNECTED && millis() - lastWeatherFetch > 600000UL) {
    lastWeatherFetch = millis();
    fetchWeather();
  }

  // Automatic Screen Sequencer (when unlocked and not sleeping/alarming)
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
        if (currentFace == 7) currentFace = 8; // skip Sleepy while awake
      }
    }
  }

  // Render OLED at ~5 FPS
  static unsigned long lastFrameMs = 0;
  if (millis() - lastFrameMs >= 200) {
    lastFrameMs = millis();
    frameCount++;

    if (alarmRinging && ringingAlarmIdx >= 0) {
      drawAlarmOled(ringingAlarmIdx, frameCount);
    } else if (activeScreen == "watch") {
      drawWatchOled();
    } else if (activeScreen == "weather") {
      if (liveTempC <= coldThresholdC && (frameCount % 16 < 8)) {
        drawFace(3, frameCount); // Freezing Cold shiver face!
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
  }
}
`;
}
