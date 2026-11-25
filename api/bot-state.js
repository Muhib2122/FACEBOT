// Vercel Serverless Function: /api/bot-state
// Bridges the published Vercel Web Portal (HTTPS) with your ESP32 over Home WiFi from anywhere.
// - Portal POSTs live state (face, screen, text, greenLed, buzzerSeq, bitmapHex, alarms, timerEndAtMs, OTA trigger)
// - ESP32 Core-0 background task polls GET /api/bot-state?device=<id> every ~1.2s -> tracks REAL esp32LastSeenAt / esp32Online!
// - Portal polls GET /api/bot-state?device=<id>&source=portal to inspect live ESP32 Online/Offline status without faking a heartbeat.
// - Server computes smooth live Focus Timer MM:SS from timerEndAtMs on every ESP32 GET so ESP32 never freezes even if browser sleeps!

import fs from 'node:fs';

const deviceStore = new Map();
const ESP32_OFFLINE_THRESHOLD_MS = 22000; // 22s grace window (~11 polls at 2.0s): zero false timeouts, clean WiFi OFF detection

function getTmpStatePath(deviceId) {
  const safe = String(deviceId || 'muhib-bot-1').replace(/[^a-zA-Z0-9_-]/g, '');
  return `/tmp/facebot_state_${safe || 'default'}.json`;
}

function loadDeviceState(deviceId) {
  const mem = deviceStore.get(deviceId);
  if (mem) return mem;
  try {
    const raw = fs.readFileSync(getTmpStatePath(deviceId), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      deviceStore.set(deviceId, parsed);
      return parsed;
    }
  } catch {
    // Cold start or no cached file yet
  }
  return null;
}

function saveDeviceState(deviceId, state) {
  deviceStore.set(deviceId, state);
  try {
    fs.writeFileSync(getTmpStatePath(deviceId), JSON.stringify(state), 'utf8');
  } catch {
    // Ignore read-only fs errors
  }
}

function createDefaultState(deviceId) {
  return {
    deviceId,
    mode: 'auto',
    modeSeq: 0,
    screen: 'auto',
    faceId: 0,
    textLine1: '',
    textLine2: '',
    userName: 'Muhib',
    city: 'Dhaka',
    greenLed: 'off',
    ledBlinkUntilMs: 0,
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
    updatedAt: Date.now(),
  };
}

function resolveLiveTimerState(state, nowMs) {
  let stateMutated = false;

  // 1. Enforce 3-second Auto Mode LED blink window:
  //    - While ledBlinkUntilMs > nowMs: send greenLed = 'blink'
  //    - Once ledBlinkUntilMs expires (or if greenLed was 'auto'): send greenLed = 'off' & bump updatedAt
  //      so already-flashed ESP32 v4.4.0 immediately sets greenLedMode = "off" and stops endless blinking!
  const blinkUntil = Number(state.ledBlinkUntilMs) || 0;
  if (blinkUntil > 0) {
    if (nowMs < blinkUntil) {
      if (state.greenLed !== 'blink') {
        state.greenLed = 'blink';
        state.updatedAt = Math.max(Number(state.updatedAt) || 0, nowMs);
        stateMutated = true;
      }
    } else {
      state.ledBlinkUntilMs = 0;
      if (state.greenLed === 'blink' || state.greenLed === 'auto') {
        state.greenLed = 'off';
      }
      state.updatedAt = Math.max(Number(state.updatedAt) || 0, blinkUntil, nowMs);
      stateMutated = true;
    }
  } else if (state.greenLed === 'auto') {
    state.greenLed = 'off';
    state.updatedAt = Math.max(Number(state.updatedAt) || 0, nowMs);
    stateMutated = true;
  }

  if (!state.updatedAt || Number(state.updatedAt) <= 0) {
    state.updatedAt = nowMs;
    stateMutated = true;
  }

  // WiFi ON 3-second priority page has #1 top priority over timer & every other screen
  if (Number(state.wifiPriorityUntilMs) > nowMs) {
    return { resolved: state, stateMutated };
  }

  if (!state.timerActive || !state.timerEndAtMs) {
    return { resolved: state, stateMutated };
  }

  const remainingSec = Math.max(0, Math.ceil((state.timerEndAtMs - nowMs) / 1000));
  const label = String(state.timerLabel || 'FOCUS').toUpperCase().slice(0, 10);

  if (remainingSec > 0) {
    const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const ss = String(remainingSec % 60).padStart(2, '0');
    return {
      resolved: {
        ...state,
        screen: 'text',
        textLine1: `${label} TIMER`,
        textLine2: `${mm}:${ss}`,
        // Change updatedAt strictly once per remaining second so ESP32 updates cleanly without jitter
        updatedAt: Math.max(state.updatedAt || 0, Math.floor(nowMs / 1000) * 1000),
      },
      stateMutated,
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
  return { resolved: state, stateMutated: true };
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

    const prev = loadDeviceState(deviceId) || createDefaultState(deviceId);
    const incomingBlinkUntil = Number(body.ledBlinkUntilMs) || 0;
    const isBlinkActive = incomingBlinkUntil > nowMs;
    const rawGreenLed = String(body.greenLed ?? prev.greenLed ?? 'off');
    const normalizedGreenLed = isBlinkActive
      ? 'blink'
      : rawGreenLed === 'auto'
        ? 'off'
        : rawGreenLed;

    const payload = {
      ...prev,
      ...body,
      deviceId,
      greenLed: normalizedGreenLed,
      ledBlinkUntilMs: isBlinkActive ? incomingBlinkUntil : 0,
      // Preserve real ESP32 hardware heartbeat metadata across portal POSTs
      esp32LastSeenAt: Math.max(Number(prev.esp32LastSeenAt) || 0, Number(body.esp32LastSeenAt) || 0),
      esp32PollCount: Math.max(Number(prev.esp32PollCount) || 0, Number(body.esp32PollCount) || 0),
      updatedAt: nowMs,
    };
    saveDeviceState(deviceId, payload);

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

  let existing = loadDeviceState(deviceId);
  if (!existing) {
    existing = createDefaultState(deviceId);
    saveDeviceState(deviceId, existing);
  }

  // Record REAL ESP32 heartbeat ONLY when the ESP32 hardware polls (not portal status checks)
  if (!isPortalStatusCheck) {
    const prevSeen = Number(existing.esp32LastSeenAt) || 0;
    const wasOffline = prevSeen === 0 || nowMs - prevSeen >= ESP32_OFFLINE_THRESHOLD_MS;
    existing.esp32LastSeenAt = nowMs;
    existing.esp32PollCount = (existing.esp32PollCount || 0) + 1;
    // When ESP32 first connects/reconnects in Auto Mode, ensure updatedAt is bumped & greenLed is 'off' after 3s
    if (wasOffline) {
      existing.mode = 'auto';
      existing.screen = 'auto';
      if (existing.greenLed === 'auto' || existing.greenLed === 'blink') {
        existing.greenLed = 'off';
      }
      existing.updatedAt = nowMs;
    }
    saveDeviceState(deviceId, existing);
  }

  const { resolved, stateMutated } = resolveLiveTimerState(existing, nowMs);
  if (stateMutated) {
    saveDeviceState(deviceId, existing);
  }
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
