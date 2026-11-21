// Vercel Serverless Function: /api/bot-state
// Bridges the published Vercel Web Portal (HTTPS) with your ESP32 over Home WiFi from anywhere.
// Portal POSTs live state (face, screen, text, greenLed, buzzerSeq, bitmapHex, alarms, OTA trigger);
// ESP32 Core-0 background task polls GET every 1.2s over HTTPS with zero OLED stutter.

const deviceStore = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
    const prev = deviceStore.get(deviceId) || {};
    const payload = {
      ...prev,
      ...body,
      deviceId,
      updatedAt: Date.now(),
    };
    deviceStore.set(deviceId, payload);
    return res.status(200).json({ ok: true, updatedAt: payload.updatedAt });
  }

  const existing = deviceStore.get(deviceId) || {
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
    timerEndEpochSec: 0,
    timerDurationSec: 0,
    wifiOfflineAuto: true,
    updatedAt: 0,
  };

  return res.status(200).json(existing);
}
