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
 * ESP32 Mini Face Bot — Dual Mode (Home WiFi + Built-In Hotspot Web Portal)
 * Generated for: ${safeUser} (${location.city}, ${location.country})
 * =========================================================================
 * HOW TO CONNECT (Zero Hassle!):
 *   1. ESP32 connects to Home WiFi ("${safeSsid}" / "${safePass}") for live Weather & Time.
 *   2. AT THE SAME TIME, ESP32 creates its own WiFi Hotspot:
 *        Hotspot Name : ${safeApName}
 *        Password     : 12345678
 *   3. Connect your Phone/PC to "${safeApName}" and open:
 *        http://192.168.4.1
 *      (Full built-in Web Portal with 25 Faces, Touchpad, Servo, HC-SR04,
 *       Alarms, Weather, Watch UI, and Home WiFi Admin Settings!)
 *
 * Required Arduino Libraries:
 *   1. Adafruit SSD1306
 *   2. Adafruit GFX Library
 *   3. ESP32Servo (by Kevin Harrington)
 *   4. ArduinoJson (v7+)
 *
 * Pinout Wiring:
 *   - 0.96" SSD1306 OLED (I2C): SDA -> GPIO 21, SCL -> GPIO 22, VCC -> 3.3V, GND -> GND
 *   - SG90 Servo Motor (Head) : Signal -> GPIO 13, VCC -> 5V (VIN), GND -> GND
 *   - Piezo Buzzer            : (+) -> GPIO 14, (-) -> GND
 *   - HC-SR04 Ultrasonic      : TRIG -> GPIO 5, ECHO -> GPIO 18 (1k/2k divider), VCC -> 5V, GND -> GND
 *   - Green Status LED        : Anode -> GPIO 26 (220 ohm), Cathode -> GND
 *   - Red Alert LED           : Anode -> GPIO 27 (220 ohm), Cathode -> GND
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>
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

// -------- Bot State, Auto/User Mode, Servo Tracking & Idle Auto-Off --------
String botMode            = "auto"; // "auto" or "user"
String activeScreen       = "face"; // "face", "watch", "weather", "greeting", "text", "bitmap"
String customLine1        = "Hi ${safeUser}!";
String customLine2        = "";
int    currentFace        = 0;
int    frameCount         = 0;
bool   screenLocked       = false;
bool   isSleeping         = false;
bool   ultrasonicOn       = ${hardware.ultrasonicEnabled ? 'true' : 'false'};
bool   trackingEnabled    = ${hardware.trackingEnabled ? 'true' : 'false'};
bool   servoOffWhenIdle   = ${hardware.servoPowerOffWhenIdle ? 'true' : 'false'};
int    wakeDistCm         = ${hardware.wakeDistanceCm};
int    trackRangeCm       = ${hardware.trackingRangeCm};
int    servoAngle         = 90;
int    trackedUserAngle   = 90;
float  lastDistanceCm     = 999.0;
bool   objectLocked       = false;
bool   servoAttached      = false;
bool   manualServo        = false;
bool   manualLed          = false;
bool   greenLedState      = false;
bool   redLedState        = false;
bool   buzzerActiveMode   = false; // false = Passive Buzzer (melody), true = Active Buzzer (DC HIGH)
unsigned long lastObjectSeenMs  = 0;
unsigned long lastSensorReadMs  = 0;
unsigned long lastServoMoveMs   = 0;
unsigned long lastGreetMs       = 0;

// Screen durations (seconds) customizable via Built-in Web Portal
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

// Custom 128x64 Touchpad Bitmap (RAM so phone touchpad updates live!)
${customBitmapBlock}

// =========================================================================
// BUILT-IN MOBILE WEB PORTAL (Served directly at http://192.168.4.1)
// =========================================================================
const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>FaceBot Portal</title>
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
  .stat{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:10px;color:#38bdf8;font-family:monospace}
  canvas{width:100%;max-width:384px;aspect-ratio:2/1;background:#020617;border:2px solid #38bdf8;border-radius:8px;touch-action:none;display:block;margin:8px auto}
  .toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#2563eb;color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;display:none;z-index:99}
</style>
</head>
<body>
<div class="wrap">
  <h1>FaceBot ESP32 Portal</h1>
  <div class="sub" id="statusLine">Connected to Hotspot (192.168.4.1)</div>

  <!-- Live Hardware Controls: Servo, HC-SR04, LEDs, Buzzer -->
  <div class="card">
    <h2>Hardware Control &amp; Live Sensor</h2>
    <div class="stat" id="hwStat">HC-SR04: Reading... | Servo: 90&deg; | LEDs: G:OFF R:OFF</div>

    <span class="lbl">SG90 Servo Head Angle (GPIO 13): <b id="angLbl">90</b>&deg;</span>
    <input id="angSlider" type="range" min="15" max="165" value="90" oninput="angLbl.innerText=this.value" onchange="cmd('/api/servo?angle='+this.value,'Servo '+this.value+' deg')"/>
    <div class="row" style="margin-top:8px">
      <button class="sec" onclick="setAng(45)">Left 45&deg;</button>
      <button class="sec" onclick="setAng(90)">Center 90&deg;</button>
      <button class="sec" onclick="setAng(135)">Right 135&deg;</button>
      <button class="ok" onclick="cmd('/api/servo?test=1','Servo Sweeping!')">Sweep Test</button>
      <button class="sec" onclick="cmd('/api/servo?auto=1','Auto Head Sync ON')">Auto Sync</button>
      <button class="sec" onclick="cmd('/api/servo?idleoff=1','Idle Servo OFF enabled')">Idle Off ON</button>
      <button class="sec" onclick="cmd('/api/servo?idleoff=0','Idle Servo OFF disabled')">Idle Off OFF</button>
    </div>

    <span class="lbl" style="margin-top:10px">HC-SR04 Ultrasonic (TRIG 5 / ECHO 18)</span>
    <div class="row">
      <button class="ok" onclick="cmd('/api/sensor?ultrasonic=1&tracking=1','HC-SR04 + Tracking ON')">Sensor + Track ON</button>
      <button class="sec" onclick="cmd('/api/sensor?ultrasonic=0','HC-SR04 OFF')">Sensor OFF</button>
    </div>

    <span class="lbl" style="margin-top:10px">Red &amp; Green LEDs (GPIO 26 / 27) &amp; Buzzer (GPIO 14)</span>
    <div class="row">
      <button class="ok" onclick="cmd('/api/led?green=1','Green LED ON')">Green ON</button>
      <button class="sec" onclick="cmd('/api/led?green=0','Green LED OFF')">Green OFF</button>
      <button class="red" onclick="cmd('/api/led?red=1','Red LED ON')">Red ON</button>
      <button class="sec" onclick="cmd('/api/led?red=0','Red LED OFF')">Red OFF</button>
      <button class="sec" onclick="cmd('/api/led?test=1','LED Blink Test')">Blink Test</button>
      <button class="sec" onclick="cmd('/api/led?auto=1','LED Auto Sync ON')">LED Auto</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button onclick="cmd('/api/buzzer?mode=tone','Passive Melody Beep')">Beep Melody</button>
      <button class="sec" onclick="cmd('/api/buzzer?mode=dc','Active DC Beep')">Beep DC (Active)</button>
      <button class="sec" onclick="cmd('/api/buzzer?type=passive','Set Passive Buzzer')">Use Passive</button>
      <button class="sec" onclick="cmd('/api/buzzer?type=active','Set Active Buzzer')">Use Active</button>
    </div>
  </div>

  <!-- Mode & Quick Screens -->
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
function setAng(a){
  document.getElementById('angSlider').value=a;
  document.getElementById('angLbl').textContent=a;
  cmd('/api/servo?angle='+a,'Servo '+a+' deg');
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
    const distTxt = d.dist > 400 ? 'No Echo (>400cm)' : (d.dist.toFixed(1)+' cm'+(d.locked?' [LOCKED]':''));
    document.getElementById('hwStat').textContent=
      'HC-SR04: '+distTxt+' | Servo: '+d.servo+'deg ('+(d.servoOn?'ON':'OFF')+') | G:'+(d.green?'ON':'OFF')+' R:'+(d.red?'ON':'OFF')+' | Buz:'+d.buz;
    if(fillInputs){
      document.getElementById('uName').value=d.user;
      document.getElementById('uCity').value=d.city;
      document.getElementById('wSsid').value=d.ssid;
    }
  }).catch(()=>{});
}
pollStatus(true);
setInterval(()=>pollStatus(false), 1200);
</script>
</body>
</html>
)rawliteral";

// -------- Zero-Conflict Buzzer Driver (Works with Passive & Active Buzzers, NEVER conflicts with ESP32Servo LEDC!) --------
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

// -------- LED Control Helpers --------
void setLeds(bool greenOn, bool redOn) {
  greenLedState = greenOn;
  redLedState = redOn;
  digitalWrite(PIN_LED_GREEN, greenOn ? HIGH : LOW);
  digitalWrite(PIN_LED_RED, redOn ? HIGH : LOW);
}

void updateLedsForFace(int faceType) {
  if (manualLed || alarmRinging) return;
  if (faceType == 3 || faceType == 5 || faceType == 16 || faceType == 19) {
    setLeds(false, true);  // Red LED for Cold / Angry / Alert
  } else if (objectLocked || faceType == 1 || faceType == 4 || faceType == 12) {
    setLeds(true, false);  // Green LED for Happy / Love / User Detected
  } else {
    setLeds(WiFi.status() == WL_CONNECTED, WiFi.status() != WL_CONNECTED);
  }
}

// -------- SG90 Servo Safe Power Management (Dedicated 50Hz PWM, Attach / Move / Idle Auto-Off) --------
bool isExpressiveFace(int faceType) {
  return (faceType == 1 || faceType == 4 || faceType == 5 || faceType == 6 ||
          faceType == 7 || faceType == 9 || faceType == 12 || faceType == 19 ||
          faceType == 24);
}

void moveServoSmooth(int targetAngle) {
  targetAngle = constrain(targetAngle, 15, 165);
  if (!servoAttached) {
    headServo.setPeriodHertz(50);
    headServo.attach(PIN_SERVO, 500, 2400);
    servoAttached = true;
    delay(15);
  }
  headServo.write(targetAngle);
  if (targetAngle != servoAngle) {
    servoAngle = targetAngle;
    lastServoMoveMs = millis();
  }
}

void parkAndPowerOffServo() {
  if (manualServo) return;
  if (servoAngle != 90) {
    moveServoSmooth(90);
    return; // Let servo finish moving to 90 deg before detaching on next tick
  }
  if (servoOffWhenIdle && servoAttached && (millis() - lastServoMoveMs > 450)) {
    headServo.detach();
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

// -------- Watch, Weather, Greeting, Text & Bitmap OLED Screens --------
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

// -------- HC-SR04 Ultrasonic Distance Reading (Filtered & Noise-Resistant) --------
float readSingleDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(12);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long duration = pulseIn(PIN_ECHO, HIGH, 30000UL);
  if (duration == 0) return 999.0;
  float cm = (duration * 0.0343f) / 2.0f;
  if (cm < 2.0f || cm > 400.0f) return 999.0;
  return cm;
}

float readDistanceCm() {
  float sum = 0;
  int valid = 0;
  for (int i = 0; i < 3; i++) {
    float d = readSingleDistanceCm();
    if (d < 400.0f) {
      sum += d;
      valid++;
    }
    delay(12);
  }
  if (valid == 0) return 999.0;
  return sum / valid;
}

void playWakeSound() {
  playToneSafe(523, 85); delay(25);
  playToneSafe(659, 85); delay(25);
  playToneSafe(784, 120);
}

void updateServoForFace(int faceType, int frame);

void showWakeGreeting() {
  if (!manualLed) setLeds(true, false);
  playWakeSound();
  for (int i = 0; i < 6; i++) {
    drawFace((i % 2 == 0) ? 1 : 4, i);
    if (!manualServo) moveServoSmooth((i % 2 == 0) ? trackedUserAngle - 20 : trackedUserAngle + 20);
    server.handleClient();
    delay(200);
  }
  if (!manualServo) moveServoSmooth(trackedUserAngle);
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(14, 24);
  display.print("Hi " + userName + "!");
  display.display();
  for (int k = 0; k < 15; k++) {
    server.handleClient();
    delay(100);
  }
}

// -------- HC-SR04 + OLED Co-Mounted User Tracking & Idle Servo Power-Off --------
void updateUltrasonicTracking() {
  if (millis() - lastSensorReadMs < 180) return;
  lastSensorReadMs = millis();

  float dist = readDistanceCm();
  lastDistanceCm = dist;

  if (!ultrasonicOn) return;

  // User / Object detected within tracking range!
  if (dist > 2.0f && dist <= (float)trackRangeCm) {
    bool newlyArrived = !objectLocked;
    objectLocked = true;
    lastObjectSeenMs = millis();
    if (!manualLed) setLeds(true, false);

    // Wake up from sleep OR greet user when they walk up within wakeDistCm (25cm)
    if (dist <= (float)wakeDistCm && (isSleeping || (newlyArrived && millis() - lastGreetMs > 12000UL))) {
      isSleeping = false;
      screenLocked = false;
      lastGreetMs = millis();
      showWakeGreeting();
    }
    return;
  }

  // If user stepped slightly left/right while locked, sweep head to follow them!
  if (trackingEnabled && !manualServo && objectLocked && (millis() - lastObjectSeenMs < 3500UL)) {
    int offsets[4] = { -22, 22, -44, 44 };
    for (int i = 0; i < 4; i++) {
      int candidate = constrain(trackedUserAngle + offsets[i], 30, 150);
      moveServoSmooth(candidate);
      delay(160);
      server.handleClient();
      float d = readSingleDistanceCm();
      lastDistanceCm = d;
      if (d > 2.0f && d <= (float)trackRangeCm) {
        trackedUserAngle = candidate;
        lastObjectSeenMs = millis();
        return;
      }
    }
  }

  // No object found for 4 seconds -> return to straight (90 deg) and power Servo OFF if not animating
  if (millis() - lastObjectSeenMs > 4000UL) {
    objectLocked = false;
    trackedUserAngle = 90;
    bool animatingFace = (!isSleeping && activeScreen == "face" && isExpressiveFace(currentFace));
    if (!manualServo && !animatingFace) {
      parkAndPowerOffServo();
    }
  }
}

void updateServoForFace(int faceType, int frame) {
  if (manualServo) {
    moveServoSmooth(servoAngle);
    return;
  }

  int base = objectLocked ? trackedUserAngle : 90;
  if (faceType == 1 || faceType == 4 || faceType == 12) {
    moveServoSmooth((frame % 4 < 2) ? base - 20 : base + 20);
  } else if (faceType == 6) {
    moveServoSmooth(base + 26);
  } else if (faceType == 5 || faceType == 19) {
    moveServoSmooth((frame % 2 == 0) ? base - 18 : base + 18);
  } else if (faceType == 7 || faceType == 9) {
    moveServoSmooth(base + 16);
  } else if (faceType == 24) {
    int offset[3] = {-25, 0, 25};
    moveServoSmooth(base + offset[(frame / 3) % 3]);
  } else if (objectLocked) {
    moveServoSmooth(trackedUserAngle);
  } else {
    parkAndPowerOffServo();
  }
}

void playAlarmBeepTick(int melody, int frame) {
  if (melody == 1) {
    int notes[3] = {523, 659, 784};
    playToneSafe(notes[frame % 3], 110);
  } else if (melody == 2) {
    playToneSafe((frame % 2 == 0) ? 2200 : 1400, 100);
  } else {
    playToneSafe((frame % 4 == 3) ? 2093 : 1760, 110);
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
  String url = "http://api.open-meteo.com/v1/forecast?latitude=" + String(locLat, 4) +
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

// -------- Built-In Web Portal + REST API Routes --------
void setupWebPortalRoutes() {
  server.enableCORS(true);

  server.on("/", HTTP_GET, []() {
    server.send_P(200, "text/html", PORTAL_HTML);
  });

  server.on("/api/status", HTTP_GET, []() {
    String json = "{\\"wifi\\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") +
                  ",\\"staIp\\":\\"" + WiFi.localIP().toString() +
                  "\\",\\"temp\\":" + String(liveTempC, 1) +
                  ",\\"mode\\":\\"" + botMode +
                  "\\",\\"user\\":\\"" + userName +
                  "\\",\\"city\\":\\"" + cityName +
                  "\\",\\"ssid\\":\\"" + wifiSsid +
                  "\\",\\"dist\\":" + String(lastDistanceCm, 1) +
                  ",\\"locked\\":" + String(objectLocked ? "true" : "false") +
                  ",\\"servo\\":" + String(servoAngle) +
                  ",\\"servoOn\\":" + String(servoAttached ? "true" : "false") +
                  ",\\"green\\":" + String(greenLedState ? "true" : "false") +
                  ",\\"red\\":" + String(redLedState ? "true" : "false") +
                  ",\\"buz\\":\\"" + String(buzzerActiveMode ? "Active" : "Passive") + "\\"}";
    server.send(200, "application/json", json);
  });

  server.on("/api/wifi", HTTP_GET, []() {
    if (server.hasArg("ssid") && server.hasArg("pass")) {
      wifiSsid = server.arg("ssid");
      wifiPassword = server.arg("pass");
      prefs.begin("facebot", false);
      prefs.putString("ssid", wifiSsid);
      prefs.putString("pass", wifiPassword);
      prefs.end();
      server.send(200, "application/json", "{\\"ok\\":true}");
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
      screenLocked = true;
      isSleeping = (currentFace == 7);
      manualServo = false; // Allow face-synced head movement right away!
      drawFace(currentFace, frameCount);
      updateServoForFace(currentFace, frameCount);
      updateLedsForFace(currentFace);
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/screen", HTTP_GET, []() {
    if (server.hasArg("kind")) {
      activeScreen = server.arg("kind");
      screenLocked = true;
      isSleeping = false;
    }
    if (server.hasArg("l1")) customLine1 = server.arg("l1");
    if (server.hasArg("l2")) customLine2 = server.arg("l2");
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/bitmap", HTTP_POST, []() {
    String hex = server.arg("plain");
    if (hex.length() >= 2048) {
      for (int i = 0; i < 1024; i++) {
        char buf[3] = { hex[i * 2], hex[i * 2 + 1], 0 };
        customTouchpadBitmap[i] = (unsigned char)strtol(buf, NULL, 16);
      }
      activeScreen = "bitmap";
      screenLocked = true;
      isSleeping = false;
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/durations", HTTP_GET, []() {
    if (server.hasArg("watch"))   watchDurSec   = constrain(server.arg("watch").toInt(), 2, 120);
    if (server.hasArg("weather")) weatherDurSec = constrain(server.arg("weather").toInt(), 2, 120);
    if (server.hasArg("face"))    faceDurSec    = constrain(server.arg("face").toInt(), 2, 120);
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/servo", HTTP_GET, []() {
    if (server.hasArg("test")) {
      manualServo = true;
      moveServoSmooth(45);  delay(350);
      moveServoSmooth(135); delay(420);
      moveServoSmooth(90);  delay(320);
    }
    if (server.hasArg("angle")) {
      manualServo = true;
      moveServoSmooth(server.arg("angle").toInt());
    }
    if (server.hasArg("auto"))    manualServo = (server.arg("auto") == "0");
    if (server.hasArg("idleoff")) servoOffWhenIdle = (server.arg("idleoff") == "1");
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/sensor", HTTP_GET, []() {
    if (server.hasArg("ultrasonic")) ultrasonicOn = (server.arg("ultrasonic") == "1");
    if (server.hasArg("tracking"))   trackingEnabled = (server.arg("tracking") == "1");
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/led", HTTP_GET, []() {
    if (server.hasArg("auto") && server.arg("auto") == "1") {
      manualLed = false;
      updateLedsForFace(currentFace);
    } else if (server.hasArg("test")) {
      manualLed = true;
      for (int i = 0; i < 3; i++) {
        setLeds(true, false);  delay(160);
        setLeds(false, true);  delay(160);
      }
      setLeds(true, false);
    } else {
      manualLed = true;
      bool g = server.hasArg("green") ? (server.arg("green") == "1") : greenLedState;
      bool r = server.hasArg("red")   ? (server.arg("red") == "1")   : redLedState;
      setLeds(g, r);
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/buzzer", HTTP_GET, []() {
    if (server.hasArg("type")) {
      buzzerActiveMode = (server.arg("type") == "active");
    }
    if (server.hasArg("mode")) {
      if (server.arg("mode") == "dc") {
        playToneSafe(0, 220, true);
      } else {
        playWakeSound();
      }
    }
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/mode", HTTP_GET, []() {
    if (server.hasArg("mode")) {
      botMode = server.arg("mode");
      screenLocked = false;
      isSleeping = false;
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
    stopBuzzer();
    manualLed = false;
    setLeds(true, false);
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/alarm/test", HTTP_GET, []() {
    if (alarmCount == 0) {
      alarms[0] = { 7, 0, true, 1, 0, "Test Alarm" };
      alarmCount = 1;
    }
    alarmRinging = true;
    ringingAlarmIdx = 0;
    isSleeping = false;
    server.send(200, "application/json", "{\\"ok\\":true}");
  });

  server.on("/api/config", HTTP_GET, []() {
    if (server.hasArg("name")) userName = server.arg("name");
    if (server.hasArg("city")) cityName = server.arg("city");
    if (server.hasArg("lat"))  locLat = server.arg("lat").toFloat();
    if (server.hasArg("lon"))  locLon = server.arg("lon").toFloat();
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
  digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  setLeds(false, false);

  // Allocate ESP32 PWM timers cleanly for SG90 Servo (50Hz)
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  headServo.setPeriodHertz(50);

  // Boot Hardware Self-Test: LEDs + Buzzer + Servo Wave (proves all wiring on power-up!)
  setLeds(true, false);  delay(200);
  setLeds(false, true);  delay(200);
  setLeds(true, true);
  playToneSafe(1047, 90); delay(40);
  playToneSafe(1568, 110);
  moveServoSmooth(65);  delay(280);
  moveServoSmooth(115); delay(320);
  moveServoSmooth(90);  delay(280);
  setLeds(false, false);

  // Load saved Home WiFi from NVS (default: muhib / 12345678)
  prefs.begin("facebot", true);
  wifiSsid     = prefs.getString("ssid", wifiSsid);
  wifiPassword = prefs.getString("pass", wifiPassword);
  prefs.end();

${alarmInitLines.join('\n')}

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 OLED not found!");
    for (;;);
  }

  // Dual Mode: Broadcast ESP32 Hotspot + Connect to Home WiFi simultaneously!
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASS);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  // Show Hotspot Info directly on 0.96" OLED
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 4);  display.print("Hotspot:");
  display.setCursor(0, 15); display.print(AP_SSID);
  display.setCursor(0, 28); display.print("Pass: 12345678");
  display.setCursor(0, 41); display.print("Open: 192.168.4.1");
  display.setCursor(0, 54); display.print("Home WiFi...");
  display.display();

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(400);
    tries++;
  }

  setupWebPortalRoutes();

  if (WiFi.status() == WL_CONNECTED) {
    setLeds(true, false);
    configTime(utcOffsetSec, 0, "pool.ntp.org");
    fetchWeatherFromOpenMeteo();
    Serial.println("Home WiFi Connected! IP: " + WiFi.localIP().toString());
  } else {
    setLeds(false, true);
    Serial.println("Home WiFi offline — Hotspot Portal active at 192.168.4.1");
  }
  Serial.println("Hotspot Portal: http://192.168.4.1");
}

void loop() {
  server.handleClient();
  checkScheduledAlarms();

  // Active Alarm Ringing
  if (alarmRinging && ringingAlarmIdx >= 0) {
    drawAlarmOled(ringingAlarmIdx, frameCount);
    playAlarmBeepTick(alarms[ringingAlarmIdx].melody, frameCount);
    setLeds(false, (frameCount % 2 == 0));
    updateServoForFace(19, frameCount);
    frameCount++;
    delay(160);
    return;
  }

  // HC-SR04 Proximity Wake-Up + Co-Mounted User Tracking + Idle Servo Auto-Off
  updateUltrasonicTracking();

  // Refresh live weather every 10 minutes
  if (millis() - lastWeatherFetch > 600000) {
    fetchWeatherFromOpenMeteo();
    lastWeatherFetch = millis();
  }

  // Auto/User Mode Automatic Screen Cycling (unless locked from portal)
  if (!isSleeping && !screenLocked) {
    unsigned long holdMs = (activeScreen == "watch") ? (watchDurSec * 1000UL)
                         : (activeScreen == "weather") ? (weatherDurSec * 1000UL)
                         : (faceDurSec * 1000UL);
    if (millis() - lastCycleSwitchMs > holdMs) {
      lastCycleSwitchMs = millis();
      cycleStep++;
      if (cycleStep % 5 == 0)      activeScreen = "watch";
      else if (cycleStep % 5 == 1) activeScreen = "weather";
      else if (cycleStep % 5 == 2) activeScreen = "greeting";
      else {
        activeScreen = "face";
        currentFace = (currentFace + 1) % 25;
        if (currentFace == 7) currentFace = 8; // skip Sleepy while awake
      }
    }
  }

  // Render Active Screen on 0.96" OLED
  if (isSleeping) {
    drawFace(7, frameCount);
    if (!objectLocked) parkAndPowerOffServo();
  } else if (activeScreen == "watch") {
    drawWatchOled();
    if (!objectLocked) parkAndPowerOffServo();
  } else if (activeScreen == "weather") {
    if (liveTempC <= coldThresholdC && frameCount % 8 >= 4) {
      drawFace(3, frameCount);
      display.fillRect(0, 0, 128, 12, SSD1306_BLACK);
      display.setTextSize(1);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(10, 2);
      display.print("Today is too cold!");
      display.display();
      if (!manualLed) setLeds(false, true);
    } else {
      drawWeatherOled();
    }
    if (!objectLocked) parkAndPowerOffServo();
  } else if (activeScreen == "greeting") {
    drawGreetingOled();
    if (!objectLocked) parkAndPowerOffServo();
  } else if (activeScreen == "text") {
    drawCustomTextOled();
  } else if (activeScreen == "bitmap") {
    display.clearDisplay();
    display.drawBitmap(0, 0, customTouchpadBitmap, 128, 64, SSD1306_WHITE);
    display.display();
  } else {
    drawFace(currentFace, frameCount);
    updateServoForFace(currentFace, frameCount);
    updateLedsForFace(currentFace);
  }

  frameCount++;
  delay(180);
}
`;
}
