// Vercel Serverless Function: /api/bot-state
// Bridges the published Vercel Web Portal (HTTPS) with your ESP32 over Home WiFi from anywhere.
// - Portal POSTs live state (face, screen, text, greenLed, buzzerSeq, bitmapHex, alarms, timerEndAtMs, OTA trigger)
// - ESP32 Core-0 background task polls GET /api/bot-state?device=<id> every ~1.2s -> tracks REAL esp32LastSeenAt / esp32Online!
// - Portal polls GET /api/bot-state?device=<id>&source=portal to inspect live ESP32 Online/Offline status without faking a heartbeat.
// - Server computes smooth live Focus Timer MM:SS from timerEndAtMs on every ESP32 GET so ESP32 never freezes even if browser sleeps!

const deviceStore = new Map();
const ESP32_OFFLINE_THRESHOLD_MS = 30000; // 30s grace window prevents false 10s timeouts during TLS/weather fetches

function createDefaultState(deviceId) {
  return {
    deviceId,
    mode: 'auto',
    screen: 'face',
    faceId: 0,
    textLine1: '',
    textLine2: '',
    userName: 'Muhib',
    city: 'Dhaka',
    greenLed: 'auto',
    buzzerSeq: 0,
    buzzerMode: 'tone',
    bitmapSeq: 0,
    bitmapHex: '',
    alarms: [],
    alarmDismissSeq: 0,
    alarmTestSeq: 0,
    alarmTestSlot: 0,
    otaTriggerSeq: 0,
    timerActive: false,
    timerLabel: 'FOCUS',
    timerEndAtMs: 0,
    timerEndEpochSec: 0,
    timerDurationSec: 0,
    wifiOfflineAuto: true,
    wifiPriorityUntilMs: 0,
    esp32LastSeenAt: 0,
    esp32PollCount: 0,
    updatedAt: 0,
  };
}

function resolveLiveTimerState(state, nowMs) {
  // WiFi ON / OFF 5-second page has #1 top priority over timer & every other screen
  if (Number(state.wifiPriorityUntilMs) > nowMs) {
    return state;
  }

  if (!state.timerActive || !state.timerEndAtMs) {
    return state;
  }

  const remainingSec = Math.max(0, Math.ceil((state.timerEndAtMs - nowMs) / 1000));
  const label = String(state.timerLabel || 'FOCUS').toUpperCase().slice(0, 10);

  if (remainingSec > 0) {
    const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const ss = String(remainingSec % 60).padStart(2, '0');
    return {
      ...state,
      screen: 'text',
      textLine1: `${label} TIMER`,
      textLine2: `${mm}:${ss}`,
      // Change updatedAt strictly once per remaining second so ESP32 updates cleanly without jitter
      updatedAt: Math.max(state.updatedAt || 0, Math.floor(nowMs / 1000) * 1000),
    };
  }

  // Timer reached 00:00 -> auto-complete on server & trigger ESP32 completion buzzer!
  state.timerActive = false;
  state.timerEndAtMs = 0;
  state.timerEndEpochSec = 0;
  state.screen = 'text';
  state.textLine1 = `${label} DONE!`;
  state.textLine2 = 'NICE JOB!';
  state.buzzerSeq = (Number(state.buzzerSeq) || 0) + 1;
  state.buzzerMode = 'happy';
  state.updatedAt = nowMs;
  return state;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const nowMs = Date.now();
  const deviceId = String((req.query && req.query.device) || 'muhib-bot-1').slice(0, 32);

  if (req.method === 'POST') {
    let body = {};
    try {
      const parsed = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed;
      } else {
        return res.status(400).json({ error: 'Invalid JSON payload object.' });
      }
    } catch {
      return res.status(400).json({ error: 'Malformed JSON body.' });
    }

    const prev = deviceStore.get(deviceId) || createDefaultState(deviceId);
    const payload = {
      ...prev,
      ...body,
      deviceId,
      // Preserve real ESP32 hardware heartbeat metadata across portal POSTs
      esp32LastSeenAt: prev.esp32LastSeenAt || 0,
      esp32PollCount: prev.esp32PollCount || 0,
      updatedAt: nowMs,
    };
    deviceStore.set(deviceId, payload);

    const esp32Online =
      payload.esp32LastSeenAt > 0 && nowMs - payload.esp32LastSeenAt < ESP32_OFFLINE_THRESHOLD_MS;

    return res.status(200).json({
      ok: true,
      updatedAt: payload.updatedAt,
      esp32Online,
      esp32LastSeenAt: payload.esp32LastSeenAt,
      serverTimeMs: nowMs,
    });
  }

  const source = String((req.query && req.query.source) || '').toLowerCase();
  const isPortalStatusCheck = source === 'portal';

  let existing = deviceStore.get(deviceId);
  if (!existing) {
    existing = createDefaultState(deviceId);
    deviceStore.set(deviceId, existing);
  }

  // Record REAL ESP32 heartbeat ONLY when the ESP32 hardware polls (not portal status checks)
  if (!isPortalStatusCheck) {
    existing.esp32LastSeenAt = nowMs;
    existing.esp32PollCount = (existing.esp32PollCount || 0) + 1;
    deviceStore.set(deviceId, existing);
  }

  const resolved = resolveLiveTimerState(existing, nowMs);
  const esp32LastSeenAt = existing.esp32LastSeenAt || 0;
  const esp32AgoMs = esp32LastSeenAt > 0 ? Math.max(0, nowMs - esp32LastSeenAt) : -1;
  const esp32Online = esp32LastSeenAt > 0 && esp32AgoMs < ESP32_OFFLINE_THRESHOLD_MS;

  return res.status(200).json({
    ...resolved,
    esp32Online,
    esp32LastSeenAt,
    esp32AgoSec: esp32AgoMs >= 0 ? Math.floor(esp32AgoMs / 1000) : null,
    serverTimeMs: nowMs,
  });
}
