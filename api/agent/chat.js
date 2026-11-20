import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const FACE_CATALOG = [
  '0: Normal Blink', '1: Super Happy', '2: Cute Wink', '3: Freezing Cold', '4: In Love',
  '5: Angry', '6: Surprised', '7: Sleepy', '8: Cool Shades', '9: Sad Puppy',
  '10: Crying', '11: Dizzy', '12: Starry Eyed', '13: Skeptical', '14: Cheeky Tongue',
  '15: Kawaii Cat', '16: Knocked Out', '17: Thinking', '18: Shy Blushing', '19: Angry Shout',
  '20: Cyclops Alien', '21: Money Eyes', '22: Robot Scan', '23: Smug Proud', '24: Looking Around',
].join(', ');

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    screenKind: {
      type: Type.STRING,
      enum: ['face', 'watch', 'weather', 'greeting', 'custom-text', 'sleep', 'wake', 'none'],
    },
    faceId: { type: Type.INTEGER },
    oledLine1: { type: Type.STRING },
    oledLine2: { type: Type.STRING },
    greenLed: { type: Type.STRING, enum: ['unchanged', 'on', 'off', 'blink', 'auto'] },
    buzzerSound: { type: Type.STRING, enum: ['none', 'beep', 'wake', 'happy', 'alarm'] },
    alarmTime: { type: Type.STRING },
    alarmLabel: { type: Type.STRING },
    targetMode: { type: Type.STRING, enum: ['unchanged', 'auto', 'user'] },
    actionSummary: { type: Type.STRING },
  },
  required: [
    'reply',
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

// Enforce strict alternating user -> model -> user conversation contents (never start with model!)
function buildCleanContents(rawHistory, currentMessage) {
  const cleaned = [];
  for (const item of Array.isArray(rawHistory) ? rawHistory.slice(-8) : []) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    const role = item.role === 'model' ? 'model' : 'user';
    // Never start conversation history with a synthetic model greeting
    if (cleaned.length === 0 && role === 'model') continue;
    // Merge consecutive same-role turns so alternation is guaranteed
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === role) {
      cleaned[cleaned.length - 1].parts[0].text += ` ${text}`;
    } else {
      cleaned.push({ role, parts: [{ text }] });
    }
  }
  // If last history item is already 'user', append to it; otherwise push new user turn
  if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'user') {
    cleaned[cleaned.length - 1].parts[0].text += `\n${currentMessage}`;
  } else {
    cleaned.push({ role: 'user', parts: [{ text: currentMessage }] });
  }
  return cleaned;
}

function parseJsonSafe(rawText) {
  const stripped = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(stripped);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    const ctx = body.context || {};
    const userName = ctx.userName || 'Muhib';

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const systemInstruction = `You are FaceBot, ${userName}'s personal ESP32 voice AI agent (created by Muhib Creation) with a 0.96" SSD1306 OLED, a Piezo Buzzer (GPIO 14), and 1x Green LED (GPIO 26).
STRICT RULES:
1. ALWAYS reply ONLY in natural Banglish (Bengali written in plain English letters, no Bengali script).
2. Keep every reply SUPER SHORT and basic — strictly 1 short sentence (max 15 words).
3. If you don't understand or cannot do it, ALWAYS start with "Sorry Muhib" (e.g. "Sorry Muhib, eta ami bujhte parini.") and set faceId 11 or 17.
Context: City=${ctx.city || 'Dhaka'}, Temp=${ctx.temperatureC ?? 'Unknown'}C, Time=${ctx.localTime || 'Unknown'}, Mode=${ctx.mode || 'auto'}, GreenLED=${ctx.greenLedMode || 'auto'}.
Faces: ${FACE_CATALOG}`;

    const contents = buildCleanContents(body.history, message);

    const callModel = async (modelName, useMinimalThinking) => {
      const config = {
        systemInstruction,
        maxOutputTokens: 280,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      };
      if (useMinimalThinking) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
      }
      const resp = await ai.models.generateContent({
        model: modelName,
        contents,
        config,
      });
      if (!resp.text) throw new Error('Empty AI response.');
      return parseJsonSafe(resp.text);
    };

    try {
      const parsed = await callModel('gemini-4-hydrogen', true);
      return res.status(200).json(parsed);
    } catch (primaryErr) {
      // Fast automatic fallback to free gemini-3.1-flash-lite if primary hits transient 429/503/timeout
      console.warn('Primary gemini-4-hydrogen failed, trying gemini-3.1-flash-lite:', primaryErr?.message);
      const fallbackParsed = await callModel('gemini-3.1-flash-lite', false);
      return res.status(200).json(fallbackParsed);
    }
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Agent error' });
  }
}
