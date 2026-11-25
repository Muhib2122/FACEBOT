import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  FunctionDeclaration,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body.' });
      return;
    }
    next(err);
  }
);

const FACE_CATALOG = [
  '0: Normal Blink',
  '1: Super Happy',
  '2: Cute Wink',
  '3: Freezing Cold',
  '4: In Love',
  '5: Angry',
  '6: Surprised',
  '7: Sleepy',
  '8: Cool Shades',
  '9: Sad Puppy',
  '10: Crying',
  '11: Dizzy',
  '12: Starry Eyed',
  '13: Skeptical',
  '14: Cheeky Tongue',
  '15: Kawaii Cat',
  '16: Knocked Out',
  '17: Thinking',
  '18: Shy Blushing',
  '19: Angry Shout',
  '20: Cyclops Alien',
  '21: Money Eyes',
  '22: Robot Scan',
  '23: Smug Proud',
  '24: Looking Around',
].join(', ');

function createAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

const ALLOWED_TTS_VOICES = new Set(['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir']);
const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function withTimeoutMs<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Model timeout (${ms}ms)`)), ms)
    ),
  ]);
}

function ensureWavBase64(base64Audio: string, inlineMimeType = ''): string {
  const rawBuf = Buffer.from(base64Audio, 'base64');
  if (
    rawBuf.length >= 12 &&
    rawBuf[0] === 0x52 &&
    rawBuf[1] === 0x49 &&
    rawBuf[2] === 0x46 &&
    rawBuf[3] === 0x46
  ) {
    return base64Audio;
  }

  const rateMatch = String(inlineMimeType).match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = rawBuf.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, rawBuf]).toString('base64');
}

function formatFriendlyGeminiError(err: unknown, fallbackMsg: string): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'Free Gemini API rate limit sesh hoye geche — 20–30 second por abr try koro!',
    };
  }
  if (lower.includes('api_key') || lower.includes('403') || lower.includes('permission_denied')) {
    return {
      status: 403,
      message: 'Gemini API key invalid ba active noy. API key configuration check koro.',
    };
  }
  return { status: 500, message: fallbackMsg };
}

function parseBilingualSearchReply(rawText: string | undefined, userName: string) {
  const clean = String(rawText || '').trim();
  if (!clean) {
    return {
      reply: `Sorry ${userName}, kono info pai ni.`,
      spokenBn: `সরি ${userName}, কোনো তথ্য পাইনি।`,
    };
  }
  const bnMatch = clean.match(/BANGLA:\s*(.+)$/is);
  const bgMatch = clean.match(/BANGLISH:\s*([\s\S]*?)(?=BANGLA:|$)/i);
  if (bgMatch && bnMatch) {
    return {
      reply: bgMatch[1].trim(),
      spokenBn: bnMatch[1].trim(),
    };
  }
  return {
    reply: clean.replace(/^BANGLISH:\s*/i, '').trim(),
    spokenBn: '',
  };
}

// =========================================================================
// 1. CLOUD STATE BRIDGE (/api/bot-state) — Mirrors Vercel Serverless API
// =========================================================================
const deviceStore = new Map<string, Record<string, unknown>>();

app.options('/api/bot-state', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(200).end();
});

const ESP32_OFFLINE_THRESHOLD_MS = 22000;

function createDefaultDeviceState(deviceId: string): Record<string, unknown> {
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

function resolveLiveTimerState(state: Record<string, unknown>, nowMs: number): Record<string, unknown> {
  const blinkUntil = Number(state.ledBlinkUntilMs) || 0;
  if (blinkUntil > 0) {
    if (nowMs < blinkUntil) {
      if (state.greenLed !== 'blink') {
        state.greenLed = 'blink';
        state.updatedAt = Math.max(Number(state.updatedAt) || 0, nowMs);
      }
    } else {
      state.ledBlinkUntilMs = 0;
      if (state.greenLed === 'blink' || state.greenLed === 'auto') {
        state.greenLed = 'off';
      }
      state.updatedAt = Math.max(Number(state.updatedAt) || 0, blinkUntil, nowMs);
    }
  } else if (state.greenLed === 'auto') {
    state.greenLed = 'off';
    state.updatedAt = Math.max(Number(state.updatedAt) || 0, nowMs);
  }

  if (!state.updatedAt || Number(state.updatedAt) <= 0) {
    state.updatedAt = nowMs;
  }

  // WiFi ON 3-second priority page has #1 top priority over timer & every other screen
  if (Number(state.wifiPriorityUntilMs) > nowMs) {
    return state;
  }

  const timerActive = Boolean(state.timerActive);
  const timerEndAtMs = Number(state.timerEndAtMs) || 0;
  if (!timerActive || !timerEndAtMs) {
    return state;
  }

  const remainingSec = Math.max(0, Math.ceil((timerEndAtMs - nowMs) / 1000));
  const label = String(state.timerLabel || 'FOCUS').toUpperCase().slice(0, 10);

  if (remainingSec > 0) {
    const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const ss = String(remainingSec % 60).padStart(2, '0');
    return {
      ...state,
      screen: 'text',
      textLine1: `${label} TIMER`,
      textLine2: `${mm}:${ss}`,
      updatedAt: Math.max(Number(state.updatedAt) || 0, Math.floor(nowMs / 1000) * 1000),
    };
  }

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

app.get('/api/bot-state', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  const nowMs = Date.now();
  const deviceId = String(req.query.device || 'muhib-bot-1').slice(0, 32);
  const isPortalStatusCheck = String(req.query.source || '').toLowerCase() === 'portal';

  let existing = deviceStore.get(deviceId);
  if (!existing) {
    existing = createDefaultDeviceState(deviceId);
    deviceStore.set(deviceId, existing);
  }

  if (!isPortalStatusCheck) {
    const prevSeen = Number(existing.esp32LastSeenAt) || 0;
    const wasOffline = prevSeen === 0 || nowMs - prevSeen >= ESP32_OFFLINE_THRESHOLD_MS;
    existing.esp32LastSeenAt = nowMs;
    existing.esp32PollCount = (Number(existing.esp32PollCount) || 0) + 1;
    if (wasOffline) {
      existing.mode = 'auto';
      existing.screen = 'auto';
      if (existing.greenLed === 'auto' || existing.greenLed === 'blink') {
        existing.greenLed = 'off';
      }
      existing.updatedAt = nowMs;
    }
    deviceStore.set(deviceId, existing);
  }

  const resolved = resolveLiveTimerState(existing, nowMs);
  const esp32LastSeenAt = Number(existing.esp32LastSeenAt) || 0;
  const esp32AgoMs = esp32LastSeenAt > 0 ? Math.max(0, nowMs - esp32LastSeenAt) : -1;
  const esp32Online = esp32LastSeenAt > 0 && esp32AgoMs < ESP32_OFFLINE_THRESHOLD_MS;

  res.json({
    ...resolved,
    esp32Online,
    esp32LastSeenAt,
    esp32AgoSec: esp32AgoMs >= 0 ? Math.floor(esp32AgoMs / 1000) : null,
    serverTimeMs: nowMs,
  });
});

app.post('/api/bot-state', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const nowMs = Date.now();
  const deviceId = String(req.query.device || 'muhib-bot-1').slice(0, 32);
  const body = (req.body || {}) as Record<string, unknown>;
  const prev = deviceStore.get(deviceId) || createDefaultDeviceState(deviceId);
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
    esp32LastSeenAt: Math.max(Number(prev.esp32LastSeenAt) || 0, Number(body.esp32LastSeenAt) || 0),
    esp32PollCount: Math.max(Number(prev.esp32PollCount) || 0, Number(body.esp32PollCount) || 0),
    updatedAt: nowMs,
  };
  deviceStore.set(deviceId, payload);
  const esp32LastSeenAt = Number(payload.esp32LastSeenAt) || 0;
  const esp32Online = esp32LastSeenAt > 0 && nowMs - esp32LastSeenAt < ESP32_OFFLINE_THRESHOLD_MS;
  res.json({
    ok: true,
    updatedAt: payload.updatedAt,
    esp32Online,
    esp32LastSeenAt,
    serverTimeMs: nowMs,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// =========================================================================
// 2. MULTI-TURN BANGLISH AI AGENT CHAT (gemini-4-hydrogen)
// =========================================================================
interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

interface AgentRequestBody {
  message: string;
  history?: ChatHistoryItem[];
  context?: {
    userName?: string;
    city?: string;
    temperatureC?: number | null;
    conditionLabel?: string | null;
    localTime?: string;
    mode?: string;
    isSleeping?: boolean;
    greenLedMode?: string;
    activeScreenKind?: string;
    activeFaceId?: number;
    alarmCount?: number;
    todayInteractions?: number;
    esp32Connected?: boolean;
  };
}

app.post('/api/agent/chat', async (req, res) => {
  try {
    const ai = createAiClient();
    if (!ai) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      return;
    }

    const body = (req.body || {}) as AgentRequestBody;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    const ctx = body.context || {};
    const userName = ctx.userName || 'Muhib';
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

    const systemInstruction = `You are FaceBot, ${userName}'s personal ESP32 voice AI agent (created by Muhib Creation) with a 0.96" SSD1306 OLED, a Piezo Buzzer (GPIO 14), and 1x Green LED (GPIO 26).

STRICT RESPONSE RULES (MUST FOLLOW EVERY TIME):
1. "reply" MUST be natural Banglish (Bengali written in plain English letters, NO Bengali script characters). Keep it SUPER SHORT and conversational — strictly 1 crisp sentence (max 18 words).
2. "spokenBn" MUST be the EXACT same short sentence written in clean, natural Bengali script (বাংলা) so the neural voice speaks with crystal-clear native Bangladeshi pronunciation. Example: reply="Thik ache Muhib, happy face dekhiye dilam!" -> spokenBn="ঠিক আছে মুহিব, হ্যাপি ফেস দেখিয়ে দিলাম!"
3. UNKNOWN / UNABLE FALLBACK: If you do not understand the message or cannot physically do it, ALWAYS start with "Sorry ${userName}" (spokenBn: "সরি মুহিব, এটা আমি বুঝতে পারিনি।") and set faceId to 11 (Dizzy) or 17 (Thinking) and screenKind to "face".
4. Answer general knowledge questions accurately and concisely in Banglish too!

Live Bot Status:
- Owner: ${userName}
- City: ${ctx.city || 'Dhaka'}
- Weather: ${ctx.temperatureC !== null && ctx.temperatureC !== undefined ? `${ctx.temperatureC}C (${ctx.conditionLabel || 'Clear'})` : 'Unknown'}
- Time: ${ctx.localTime || 'Unknown'}
- Mode: ${ctx.mode || 'auto'}
- Sleeping: ${ctx.isSleeping ? 'Yes' : 'No'}
- Green LED (GPIO 26): ${ctx.greenLedMode || 'auto'}
- Active Screen: ${ctx.activeScreenKind || 'face'} (Face ${ctx.activeFaceId ?? 0})
- Alarms: ${ctx.alarmCount ?? 0}
- Today's Interactions: ${ctx.todayInteractions ?? 0}

25 OLED Faces:
${FACE_CATALOG}

Hardware Control Rules:
- Always pick a matching faceId (0-24).
- screenKind: "face", "custom-text" (ASCII <=18 chars oledLine1, <=9 chars oledLine2), "watch", "weather", "greeting", "sleep", "wake", or "none".
- greenLed: "on", "off", "blink", "auto", or "unchanged".
- buzzerSound: "none", "beep", "wake", "happy", or "alarm".
- alarmTime: 24h "HH:MM" ONLY if user asks to set an alarm, else "".
- alarmLabel: short ASCII label (<=16 chars) if alarmTime is set, else "".
- targetMode: "auto", "user", or "unchanged".
- actionSummary: short 2-5 word summary of action taken.`;

    const cleanedContents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
    for (const h of history) {
      const t = typeof h?.text === 'string' ? h.text.trim() : '';
      if (!t) continue;
      const role: 'user' | 'model' = h.role === 'model' ? 'model' : 'user';
      if (cleanedContents.length === 0 && role === 'model') continue;
      if (cleanedContents.length > 0 && cleanedContents[cleanedContents.length - 1].role === role) {
        cleanedContents[cleanedContents.length - 1].parts[0].text += ` ${t}`;
      } else {
        cleanedContents.push({ role, parts: [{ text: t }] });
      }
    }
    if (cleanedContents.length > 0 && cleanedContents[cleanedContents.length - 1].role === 'user') {
      cleanedContents[cleanedContents.length - 1].parts[0].text += `\n${message}`;
    } else {
      cleanedContents.push({ role: 'user', parts: [{ text: message }] });
    }

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        reply: { type: Type.STRING },
        spokenBn: { type: Type.STRING },
        screenKind: {
          type: Type.STRING,
          enum: ['face', 'watch', 'weather', 'greeting', 'custom-text', 'sleep', 'wake', 'none'],
        },
        faceId: { type: Type.INTEGER },
        oledLine1: { type: Type.STRING },
        oledLine2: { type: Type.STRING },
        greenLed: {
          type: Type.STRING,
          enum: ['unchanged', 'on', 'off', 'blink', 'auto'],
        },
        buzzerSound: {
          type: Type.STRING,
          enum: ['none', 'beep', 'wake', 'happy', 'alarm'],
        },
        alarmTime: { type: Type.STRING },
        alarmLabel: { type: Type.STRING },
        targetMode: {
          type: Type.STRING,
          enum: ['unchanged', 'auto', 'user'],
        },
        actionSummary: { type: Type.STRING },
      },
      required: [
        'reply',
        'spokenBn',
        'screenKind',
        'faceId',
        'oledLine1',
        'oledLine2',
        'greenLed',
        'buzzerSound',
        'alarmTime',
        'alarmLabel',
        'targetMode',
        'actionSummary',
      ],
    };

    const runChatModel = async (
      model: string,
      thinkingLevel?: ThinkingLevel,
      timeout = 8500
    ) => {
      const resp = await withTimeoutMs(
        ai.models.generateContent({
          model,
          contents: cleanedContents,
          config: {
            systemInstruction,
            ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        timeout
      );
      const txt = (resp.text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      if (!txt) throw new Error('Empty response from AI Agent.');
      return JSON.parse(txt);
    };

    const chatAttempts: {
      model: string;
      thinking?: ThinkingLevel;
      timeout: number;
      delayMs: number;
    }[] = [
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 4500, delayMs: 200 },
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 4500, delayMs: 0 },
    ];

    let lastChatErr: unknown = null;
    for (let i = 0; i < chatAttempts.length; i++) {
      const attempt = chatAttempts[i];
      try {
        const parsed = await runChatModel(attempt.model, attempt.thinking, attempt.timeout);
        res.json(parsed);
        return;
      } catch (err) {
        lastChatErr = err;
        console.warn(`Chat attempt #${i + 1} (${attempt.model}) failed:`, err instanceof Error ? err.message : err);
        const errMsg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
        if (errMsg.includes('api_key') || errMsg.includes('403') || errMsg.includes('permission_denied')) {
          break;
        }
        if (attempt.delayMs > 0) await waitMs(attempt.delayMs);
      }
    }

    const rawErrStr = (lastChatErr instanceof Error ? lastChatErr.message : String(lastChatErr || '')).toLowerCase();
    if (rawErrStr.includes('api_key') || rawErrStr.includes('403') || rawErrStr.includes('permission_denied')) {
      throw lastChatErr;
    }

    // Smart Banglish NLU fallback when upstream Gemini experiences transient 503 high-demand spikes
    const fallbackResponse = buildSmartBanglishFallbackAction(message, ctx);
    res.json(fallbackResponse);
  } catch (err) {
    console.error('AI Agent error:', err);
    const friendly = formatFriendlyGeminiError(err, 'AI server e ektu busy lagche, abr try koro.');
    res.status(friendly.status).json({ error: friendly.message });
  }
});

function buildSmartBanglishFallbackAction(
  rawMessage: string,
  ctx: {
    userName?: string;
    city?: string;
    temperatureC?: number | null;
    weatherCondition?: string;
    localTime?: string;
    mode?: string;
    greenLedMode?: string;
    activeFaceId?: number;
  }
) {
  const userName = ctx.userName || 'Muhib';
  const city = ctx.city || 'Dhaka';
  const temp = typeof ctx.temperatureC === 'number' ? ctx.temperatureC : 29;
  const localTime = ctx.localTime || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const q = rawMessage.toLowerCase();

  const res = {
    reply: `Ami ekdom bhalo achi ${userName}! Tomar jonno happy face dekhiye dilam.`,
    spokenBn: `আমি একদম ভালো আছি ${userName}! তোমার জন্য হ্যাপি ফেস দেখিয়ে দিলাম।`,
    screenKind: 'face',
    faceId: 1,
    oledLine1: '',
    oledLine2: '',
    greenLed: 'unchanged',
    buzzerSound: 'none',
    alarmTime: '',
    alarmLabel: '',
    targetMode: 'unchanged',
    actionSummary: 'Happy Face Ready',
  };

  // 1. Alarm intent (e.g., "Sokal 7 tay Wake Up alarm set koro", "8:30 alarm")
  if (/\b(alarm|wake\s*up\s*at)\b/i.test(q)) {
    const timeMatch = q.match(/(\d{1,2})(?::(\d{2}))?/);
    let hh = 7;
    let mm = 0;
    if (timeMatch) {
      hh = parseInt(timeMatch[1], 10);
      mm = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if ((q.includes('bikel') || q.includes('raat') || q.includes('pm') || q.includes('evening')) && hh < 12) {
        hh += 12;
      } else if ((q.includes('sokal') || q.includes('am') || q.includes('morning')) && hh === 12) {
        hh = 0;
      }
      hh = Math.max(0, Math.min(23, hh));
      mm = Math.max(0, Math.min(59, mm));
    }
    const formatted = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const labelMatch = rawMessage.match(/for\s+([a-zA-Z0-9 ]{2,15})/i);
    const label = labelMatch ? labelMatch[1].trim().slice(0, 16) : 'Wake Up';
    res.alarmTime = formatted;
    res.alarmLabel = label;
    res.faceId = 12;
    res.buzzerSound = 'beep';
    res.reply = `Done ${userName}! ${formatted} tay "${label}" alarm set kore dilam.`;
    res.spokenBn = `ডান ${userName}! ${formatted} টায় অ্যালার্ম সেট করে দিলাম।`;
    res.actionSummary = `Set Alarm ${formatted}`;
    return res;
  }

  // 2. LED & Buzzer explicit controls (strict word boundaries so "oled" never matches "led")
  if (/\b(led|leds|light|bati|blink|beep|buzzer)\b/i.test(q)) {
    if (/\bblink\b/i.test(q)) {
      res.greenLed = 'blink';
    } else if (/\b(off|bondho|bujhao)\b/i.test(q)) {
      res.greenLed = 'off';
    } else if (/\bauto\b/i.test(q)) {
      res.greenLed = 'auto';
    } else if (/\b(on|jalao|chalu)\b/i.test(q)) {
      res.greenLed = 'on';
    }
    if (/\b(beep|buzzer|sound|ring)\b/i.test(q)) {
      res.buzzerSound = /\balarm\b/i.test(q) ? 'alarm' : /\bhappy\b/i.test(q) ? 'happy' : 'beep';
    }
    res.faceId = 22;
    res.reply = `Done ${userName}! Tomar command onujayi Green LED r Buzzer update kore dilam.`;
    res.spokenBn = `ডান ${userName}! তোমার কমান্ড অনুযায়ী গ্রিন এলইডি আর বাজার আপডেট করে দিলাম।`;
    res.actionSummary = 'Updated LED & Buzzer';
    return res;
  }

  // 3. Weather / Temperature check
  if (/\b(weather|abohawa|temp|temperature|tapmatra|gorom|bristi)\b/i.test(q)) {
    res.screenKind = 'weather';
    res.faceId = temp <= 20 ? 3 : 8;
    res.reply = `Ekhon ${city} te tapmatra ${temp} degree Celsius, OLED te live weather dekhiye dilam!`;
    res.spokenBn = `এখন ${city} তে তাপমাত্রা ${temp} ডিগ্রি সেলসিয়াস, ওএলইডি তে লাইভ ওয়েদার দেখিয়ে দিলাম!`;
    res.actionSummary = `Show ${city} Weather`;
    return res;
  }

  // 4. Clock / Time / Watch check
  if (/\b(time|koyta|baje|ghori|clock|watch|somoy)\b/i.test(q)) {
    res.screenKind = 'watch';
    res.faceId = 0;
    res.reply = `${userName}, ekhon somoy ${localTime}. OLED screen e live digital clock dekhiye dilam!`;
    res.spokenBn = `${userName}, এখন সময় ${localTime}। ওএলইডি স্ক্রিনে লাইভ ডিজিটাল ঘড়ি দেখিয়ে দিলাম!`;
    res.actionSummary = 'Show Live Clock';
    return res;
  }

  // 5. Sleep / Good night
  if (/\b(sleep|sleepy|ghum|ghuma|ghumao)\b/i.test(q) || q.includes('good night') || q.includes('suvo ratri')) {
    res.screenKind = 'sleep';
    res.faceId = 7;
    res.reply = `Good night ${userName}! Ami ekhon sleepy mode e ghumate gelam.`;
    res.spokenBn = `গুড নাইট ${userName}! আমি এখন স্লিপি মোডে ঘুমাতে গেলাম।`;
    res.actionSummary = 'Entered Sleep Mode';
    return res;
  }

  // 6. Wake up / Good morning
  if (/\b(wake|utho|suprovat)\b/i.test(q) || q.includes('good morning')) {
    res.screenKind = 'wake';
    res.faceId = 1;
    res.buzzerSound = 'wake';
    res.reply = `Suprovat ${userName}! Ami ekdom fresh hoye uthechi!`;
    res.spokenBn = `সুপ্রভাত ${userName}! আমি একদম ফ্রেশ হয়ে উঠেছি!`;
    res.actionSummary = 'Woke Up Fresh';
    return res;
  }

  // 7. Mode switching (Auto Mode / User Mode)
  if (q.includes('auto mode')) {
    res.targetMode = 'auto';
    res.faceId = 1;
    res.buzzerSound = 'happy';
    res.greenLed = 'blink';
    res.reply = `Done ${userName}! FaceBot ekhon Auto Mode e chole geche.`;
    res.spokenBn = `ডান ${userName}! ফেসবট এখন অটো মোডে চলে গেছে।`;
    res.actionSummary = 'Switched to Auto Mode';
    return res;
  }
  if (q.includes('user mode') || q.includes('manual mode')) {
    res.targetMode = 'user';
    res.faceId = 22;
    res.reply = `Done ${userName}! FaceBot ekhon User Control Mode e ache.`;
    res.spokenBn = `ডান ${userName}! ফেসবট এখন ইউজার কন্ট্রোল মোডে আছে।`;
    res.actionSummary = 'Switched to User Mode';
    return res;
  }

  // 8. Custom OLED Text ("write", "lekho", "display text")
  const textMatch = rawMessage.match(/(?:write|lekho|show text|oled te lekho)\s+["']?([a-zA-Z0-9 !?._-]{2,26})["']?/i);
  if (textMatch) {
    const cleanText = textMatch[1].trim().toUpperCase();
    res.screenKind = 'custom-text';
    res.oledLine1 = cleanText.slice(0, 18);
    res.oledLine2 = cleanText.length > 18 ? cleanText.slice(18, 27) : 'MUHIB BOT';
    res.faceId = 22;
    res.buzzerSound = 'beep';
    res.reply = `Done ${userName}! OLED display te "${res.oledLine1}" likhe dilam.`;
    res.spokenBn = `ডান ${userName}! ওএলইডি ডিসপ্লে তে টেক্সট লিখে দিলাম।`;
    res.actionSummary = `OLED Text: ${res.oledLine1}`;
    return res;
  }

  // 9. Specific Face / Mood Requests
  if (/\b(wink)\b/i.test(q) || q.includes('chokh maro')) {
    res.faceId = 2;
    res.buzzerSound = 'happy';
    res.reply = `Ei nao ${userName}, tomar jonno cute wink face!`;
    res.spokenBn = `এই নাও ${userName}, তোমার জন্য কিউট উইঙ্ক ফেস!`;
    res.actionSummary = 'Cute Wink Face';
    return res;
  }
  if (/\b(cold|thanda|freezing|sheet)\b/i.test(q)) {
    res.faceId = 3;
    res.reply = `Bapre ${userName}, ki thanda! Freezing cold face dekhiye dilam.`;
    res.spokenBn = `বাপরে ${userName}, কী ঠান্ডা! ফ্রিজিং কোল্ড ফেস দেখিয়ে দিলাম।`;
    res.actionSummary = 'Freezing Cold Face';
    return res;
  }
  if (/\b(love|bhalobasha|heart)\b/i.test(q)) {
    res.faceId = 4;
    res.buzzerSound = 'happy';
    res.reply = `Love you too ${userName}! Heart eyes face dekhiye dilam.`;
    res.spokenBn = `লাভ ইউ টু ${userName}! হার্ট আইজ ফেস দেখিয়ে দিলাম।`;
    res.actionSummary = 'In Love Face';
    return res;
  }
  if (/\b(angry|rag|gussa)\b/i.test(q)) {
    res.faceId = 5;
    res.buzzerSound = 'beep';
    res.reply = `Hmph ${userName}! Ei dekho amar angry face!`;
    res.spokenBn = `হুম ${userName}! এই দেখো আমার অ্যাংরি ফেস!`;
    res.actionSummary = 'Angry Face';
    return res;
  }
  if (/\b(surprise|surprised|obak|wow)\b/i.test(q)) {
    res.faceId = 6;
    res.reply = `Wow ${userName}! Ekdom surprised face dekhiye dilam!`;
    res.spokenBn = `ওয়াও ${userName}! একদম সারপ্রাইজড ফেস দেখিয়ে দিলাম!`;
    res.actionSummary = 'Surprised Face';
    return res;
  }
  if (/\b(cool|sunglass|shades|boss)\b/i.test(q)) {
    res.faceId = 8;
    res.buzzerSound = 'happy';
    res.reply = `Ekdom boss mood ${userName}! Cool shades face on kore dilam.`;
    res.spokenBn = `একদম বস মুড ${userName}! কুল শেডস ফেস অন করে দিলাম।`;
    res.actionSummary = 'Cool Shades Face';
    return res;
  }
  if (/\b(sad|kanna|cry|crying)\b/i.test(q) || q.includes('mon kharap')) {
    res.faceId = /\b(cry|crying|kanna)\b/i.test(q) ? 10 : 9;
    res.reply = `Mon kharap koro na ${userName}, ami tomar sathei achi!`;
    res.spokenBn = `মন খারাপ করো না ${userName}, আমি তোমার সাথেই আছি!`;
    res.actionSummary = 'Sad Puppy Face';
    return res;
  }
  if (/\b(cat|biral|meow|kawaii)\b/i.test(q)) {
    res.faceId = 15;
    res.buzzerSound = 'happy';
    res.reply = `Meow ${userName}! Kawaii cat face dekhiye dilam!`;
    res.spokenBn = `মিউ ${userName}! কাওয়াই ক্যাট ফেস দেখিয়ে দিলাম!`;
    res.actionSummary = 'Kawaii Cat Face';
    return res;
  }
  if (/\b(robot|scan|alien)\b/i.test(q)) {
    res.faceId = /\balien\b/i.test(q) ? 20 : 22;
    res.buzzerSound = 'beep';
    res.reply = `Beep boop ${userName}! Robot scanner face active kore dilam.`;
    res.spokenBn = `বিপ বপ ${userName}! রোবট স্ক্যানার ফেস অ্যাক্টিভ করে দিলাম।`;
    res.actionSummary = 'Robot Scan Face';
    return res;
  }
  if (/\b(money|taka|rich)\b/i.test(q)) {
    res.faceId = 21;
    res.reply = `Taka r taka ${userName}! Money eyes face dekhiye dilam!`;
    res.spokenBn = `টাকা আর টাকা ${userName}! মানি আইজ ফেস দেখিয়ে দিলাম!`;
    res.actionSummary = 'Money Eyes Face';
    return res;
  }

  // 10. Default Greeting / Happy Face ("Hi FaceBot, kemon acho? Happy face dekhao!")
  if (/\b(happy|khushi|haso|smile|hi|hello|salam)\b/i.test(q) || q.includes('kemon acho')) {
    res.faceId = 1;
    res.buzzerSound = /\b(happy|dekhao)\b/i.test(q) ? 'happy' : 'none';
    res.reply = `Ami ekdom bhalo achi ${userName}! Tomar jonno super happy face dekhiye dilam!`;
    res.spokenBn = `আমি একদম ভালো আছি ${userName}! তোমার জন্য সুপার হ্যাপি ফেস দেখিয়ে দিলাম!`;
    res.actionSummary = 'Super Happy Face';
    return res;
  }

  // 11. General Conversational Fallback
  res.faceId = 1;
  res.reply = `Bujhte perechi ${userName}! Ami tomar ESP32 FaceBot, sobsomoy ready achi!`;
  res.spokenBn = `বুঝতে পেরেছি ${userName}! আমি তোমার ইএসপি ৩২ ফেসবট, সবসময় রেডি আছি!`;
  res.actionSummary = 'FaceBot Ready';
  return res;
}

// =========================================================================
// 3. GOOGLE SEARCH GROUNDING (gemini-4-hydrogen + googleSearch tool)
// =========================================================================
app.post('/api/agent/search', async (req, res) => {
  try {
    const ai = createAiClient();
    if (!ai) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      return;
    }

    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const userName = typeof req.body?.userName === 'string' ? req.body.userName : 'Muhib';
    if (!query) {
      res.status(400).json({ error: 'Query is required.' });
      return;
    }

    const searchInstruction = `You are FaceBot, ${userName}'s smart assistant.
Answer concisely in 1–2 short, clear sentences.
ALWAYS output strictly in these 2 lines:
BANGLISH: <same answer in natural Banglish using plain English letters>
BANGLA: <exact same answer in clean Bengali script for clear voice pronunciation>
If not found, output:
BANGLISH: Sorry ${userName}, eta khuje pai ni.
BANGLA: সরি মুহিব, এটা খুঁজে পাইনি।`;

    const searchAttempts: {
      model: string;
      useSearchTool: boolean;
      thinking?: ThinkingLevel;
      fallback: boolean;
      timeout: number;
      delayMs: number;
    }[] = [
      { model: 'gemini-4-hydrogen', useSearchTool: true, thinking: ThinkingLevel.LOW, fallback: false, timeout: 7500, delayMs: 300 },
      { model: 'gemini-4-hydrogen', useSearchTool: true, thinking: ThinkingLevel.LOW, fallback: false, timeout: 7500, delayMs: 400 },
      { model: 'gemini-4-hydrogen', useSearchTool: false, thinking: ThinkingLevel.LOW, fallback: true, timeout: 6500, delayMs: 300 },
      { model: 'gemini-3.1-flash-lite', useSearchTool: false, thinking: ThinkingLevel.MINIMAL, fallback: true, timeout: 4500, delayMs: 0 },
    ];

    let response;
    let searchFallback = false;
    let lastSearchErr: unknown = null;

    for (let i = 0; i < searchAttempts.length; i++) {
      const a = searchAttempts[i];
      try {
        response = await withTimeoutMs(
          ai.models.generateContent({
            model: a.model,
            contents: query,
            config: {
              systemInstruction: searchInstruction,
              ...(a.thinking ? { thinkingConfig: { thinkingLevel: a.thinking } } : {}),
              ...(a.useSearchTool ? { tools: [{ googleSearch: {} }] } : {}),
            },
          }),
          a.timeout
        );
        searchFallback = a.fallback;
        break;
      } catch (err) {
        lastSearchErr = err;
        console.warn(`Search attempt #${i + 1} (${a.model}) failed:`, err instanceof Error ? err.message : err);
        if (a.delayMs > 0) await waitMs(a.delayMs);
      }
    }

    if (!response) throw lastSearchErr || new Error('All search attempts failed.');

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = rawChunks
      .filter((c) => Boolean(c?.web?.uri))
      .slice(0, 4)
      .map((c) => ({
        title: c.web?.title || c.web?.uri || 'Source',
        uri: c.web?.uri || '',
      }));

    const { reply, spokenBn } = parseBilingualSearchReply(response.text, userName);

    res.json({
      reply,
      spokenBn,
      sources,
      searchFallback,
    });
  } catch (err) {
    console.error('Search Grounding error:', err);
    const friendly = formatFriendlyGeminiError(err, 'Web search korte ektu problem holo, abr try koro.');
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// =========================================================================
// 4. AUDIO TRANSCRIPTION (gemini-3.5-transcribe with multimodal fallback)
// =========================================================================
app.post('/api/agent/transcribe', async (req, res) => {
  try {
    const ai = createAiClient();
    if (!ai) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      return;
    }

    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'audio/webm';
    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64 is required.' });
      return;
    }

    const parts = [
      {
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      },
      {
        text: 'Transcribe this audio accurately. If spoken in Bengali/Banglish or English, return only the clean spoken text.',
      },
    ];

    const transcribeAttempts: { model: string; thinking?: ThinkingLevel; timeout: number }[] = [
      { model: 'gemini-3.5-transcribe', timeout: 7500 },
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 7500 },
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 7500 },
      { model: 'gemini-3.1-flash-lite', thinking: ThinkingLevel.MINIMAL, timeout: 5500 },
    ];

    let response;
    let lastTranscribeErr: unknown = null;
    for (const attempt of transcribeAttempts) {
      try {
        response = await withTimeoutMs(
          ai.models.generateContent({
            model: attempt.model,
            contents: { parts },
            ...(attempt.thinking
              ? { config: { thinkingConfig: { thinkingLevel: attempt.thinking } } }
              : {}),
          }),
          attempt.timeout
        );
        break;
      } catch (err) {
        lastTranscribeErr = err;
        console.warn(`Transcribe attempt ${attempt.model} failed:`, err);
      }
    }

    if (!response) throw lastTranscribeErr || new Error('All transcribe models failed.');

    res.json({ text: (response.text || '').trim() });
  } catch (err) {
    console.error('Transcribe error:', err);
    const friendly = formatFriendlyGeminiError(err, 'Voice transcribe korte problem holo — aro clear kore bolo.');
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// =========================================================================
// 4B. CRYSTAL-CLEAR NEURAL TTS (gemini-3.8-flash-lite-tts · Free Tier WAV)
// =========================================================================
app.post('/api/agent/tts', async (req, res) => {
  try {
    const ai = createAiClient();
    if (!ai) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      return;
    }

    const spokenBn = typeof req.body?.spokenBn === 'string' ? req.body.spokenBn.trim() : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const speechText = (spokenBn || text).slice(0, 420);
    if (!speechText) {
      res.status(400).json({ error: 'Text is required.' });
      return;
    }

    const requestedVoice = typeof req.body?.voiceName === 'string' ? req.body.voiceName : 'Kore';
    const voiceName = ALLOWED_TTS_VOICES.has(requestedVoice) ? requestedVoice : 'Kore';

    const ttsAttempts: { model: string; contents: unknown[]; timeout: number }[] = [
      {
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: speechText,
                speechMetadata: {
                  style:
                    'Crystal-clear, warm, friendly Bangladeshi Bengali and English voice assistant speaking calmly at a steady pace',
                },
              },
            ],
          },
        ],
        timeout: 6500,
      },
      {
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{ role: 'user', parts: [{ text: speechText }] }],
        timeout: 6500,
      },
      {
        model: 'gemini-3.8-flash-tts',
        contents: [{ role: 'user', parts: [{ text: speechText }] }],
        timeout: 7000,
      },
      {
        model: 'gemini-2.5-flash-preview-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text: `Speak clearly and warmly: ${speechText}` }],
          },
        ],
        timeout: 8000,
      },
    ];

    let inlineData: { data?: string; mimeType?: string } | null = null;
    let lastTtsErr: unknown = null;
    for (const attempt of ttsAttempts) {
      try {
        const response = await withTimeoutMs(
          ai.models.generateContent({
            model: attempt.model,
            contents: attempt.contents as never,
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
          attempt.timeout
        );
        const found = response.candidates?.[0]?.content?.parts?.find(
          (p) => Boolean(p?.inlineData?.data)
        )?.inlineData;
        if (found?.data) {
          inlineData = found;
          break;
        }
      } catch (err) {
        lastTtsErr = err;
        console.warn(`TTS attempt ${attempt.model} failed:`, err);
      }
    }

    const base64Audio = inlineData?.data;
    if (!base64Audio) {
      if (lastTtsErr) throw lastTtsErr;
      res.status(502).json({ error: 'No audio returned by Gemini TTS.' });
      return;
    }

    const wavBase64 = ensureWavBase64(base64Audio, inlineData?.mimeType || '');

    res.json({
      audioBase64: wavBase64,
      mimeType: 'audio/wav',
      voiceName,
    });
  } catch (err) {
    console.error('TTS error:', err);
    const friendly = formatFriendlyGeminiError(err, 'Neural TTS temporarily unavailable.');
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// =========================================================================
// 5. REAL-TIME LIVE VOICE CONVERSATION WEBSOCKET (gemini-3.8-live)
// =========================================================================
const controlFaceBotDeclaration: FunctionDeclaration = {
  name: 'controlFaceBot',
  description:
    'Updates the ESP32 0.96-inch OLED face/screen, Green LED (GPIO 26), Piezo Buzzer (GPIO 14), or sets an alarm whenever Muhib gives a command or changes mood.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      screenKind: {
        type: Type.STRING,
        enum: ['face', 'watch', 'weather', 'greeting', 'custom-text', 'sleep', 'wake', 'none'],
      },
      faceId: {
        type: Type.INTEGER,
        description: 'Face ID 0..24 matching mood.',
      },
      oledLine1: { type: Type.STRING },
      oledLine2: { type: Type.STRING },
      greenLed: {
        type: Type.STRING,
        enum: ['unchanged', 'on', 'off', 'blink', 'auto'],
      },
      buzzerSound: {
        type: Type.STRING,
        enum: ['none', 'beep', 'wake', 'happy', 'alarm'],
      },
      alarmTime: { type: Type.STRING },
      alarmLabel: { type: Type.STRING },
    },
    required: ['screenKind', 'faceId'],
  },
};

function attachLiveVoiceWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '';
    if (reqUrl.startsWith('/ws/live')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const ai = createAiClient();
    if (!ai) {
      clientWs.send(JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server.' }));
      clientWs.close();
      return;
    }

    const urlObj = new URL(req.url || '/ws/live', `http://${req.headers.host || 'localhost'}`);
    const userName = (urlObj.searchParams.get('user') || 'Muhib').slice(0, 24);
    const city = (urlObj.searchParams.get('city') || 'Dhaka').slice(0, 24);
    const requestedVoice = urlObj.searchParams.get('voice') || 'Kore';
    const voiceName = ALLOWED_TTS_VOICES.has(requestedVoice) ? requestedVoice : 'Kore';

    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [controlFaceBotDeclaration] }],
          systemInstruction: `You are FaceBot, ${userName}'s friendly ESP32 voice companion living in ${city} (by Muhib Creation).
SPEECH CLARITY RULES:
- Speak clearly, calmly, and distinctly at a natural, unhurried pace with crisp Bangladeshi Bengali/Banglish pronunciation so every single word is super easy to understand.
- Keep replies concise (1 short sentence max).
- Whenever ${userName} asks to change face, show clock/weather/text on OLED, control Green LED, ring buzzer, sleep, wake up, or set an alarm, ALWAYS call the controlFaceBot tool right away.
- If you don't understand or cannot do something, politely say "Sorry ${userName}, eta ami bujhte parini" or "Sorry ${userName}, eta ami korte parbo na."`,
        },
        callbacks: {
          onopen: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ ready: true }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ inputTranscript: content.inputTranscription.text })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ outputTranscript: content.outputTranscription.text })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }

            const calls = message.toolCall?.functionCalls;
            if (calls && calls.length > 0 && liveSession) {
              for (const call of calls) {
                if (call.name === 'controlFaceBot') {
                  clientWs.send(JSON.stringify({ toolAction: call.args || {} }));
                  liveSession.sendToolResponse({
                    functionResponses: [
                      {
                        id: call.id,
                        name: call.name,
                        response: { result: 'ESP32 hardware updated successfully.' },
                      },
                    ],
                  });
                }
              }
            }
          },
          onerror: (err) => {
            console.error('Gemini Live error:', err);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({ error: 'Gemini Live connection error occurred.' })
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          },
        },
      });
    } catch (err) {
      console.error('Failed to connect Gemini Live:', err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Failed to start Gemini Live session.',
          })
        );
        clientWs.close();
      }
      return;
    }

    clientWs.on('message', (raw) => {
      if (!liveSession) return;
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.audio) {
          liveSession.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (parsed.text) {
          liveSession.sendRealtimeInput({ text: String(parsed.text) });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    clientWs.on('close', () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  });
}

async function startServer() {
  const httpServer = http.createServer(app);
  attachLiveVoiceWebSocket(httpServer);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`FaceBot AI Portal + Live Voice + Cloud Sync running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
