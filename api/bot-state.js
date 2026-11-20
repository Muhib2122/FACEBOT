// Vercel Serverless Function: /api/bot-state
// Bridges the published Vercel Web Portal (HTTPS) with your ESP32 over WiFi.
// Portal POSTs live state (face, mode, alarms, servo, text, OTA trigger);
// ESP32 GETs the latest JSON every 2-3 seconds over HTTPS.

const deviceStore = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const deviceId = String((req.query && req.query.device) || 'muhib-bot-1').slice(0, 32);

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const payload = {
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
    userName: 'Muhib',
    city: 'Dhaka',
    manualServo: false,
    servoAngle: 90,
    ultrasonicOn: true,
    trackingOn: true,
    servoIdleOff: true,
    alarmDismissSeq: 0,
    otaTriggerSeq: 0,
    updatedAt: 0,
  };

  return res.status(200).json(existing);
}
