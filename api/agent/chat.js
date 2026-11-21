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
    reply: {
      type: Type.STRING,
      description: 'Short 1-sentence friendly Banglish reply in plain English letters (max 18 words).',
    },
    spokenBn: {
      type: Type.STRING,
      description:
        'The EXACT same short reply written in natural Bengali script (বাংলা) so the voice synthesizer pronounces every word with crystal-clear native Bangladeshi accent.',
    },
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

function buildCleanContents(rawHistory, currentMessage) {
  const cleaned = [];
  for (const item of Array.isArray(rawHistory) ? rawHistory.slice(-8) : []) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    const role = item.role === 'model' ? 'model' : 'user';
    if (cleaned.length === 0 && role === 'model') continue;
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === role) {
      cleaned[cleaned.length - 1].parts[0].text += ` ${text}`;
    } else {
      cleaned.push({ role, parts: [{ text }] });
    }
  }
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

function formatFriendlyError(err) {
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
      message: 'Gemini API key invalid ba active noy. Vercel Environment Variables check koro.',
    };
  }
  return {
    status: 500,
    message: 'AI server e ektu busy lagche, abr try koro.',
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
1. "reply" MUST be natural Banglish (Bengali written in plain English letters, no Bengali script), SUPER SHORT (1 crisp sentence, max 18 words).
2. "spokenBn" MUST be the exact same short sentence written in clean, natural Bengali script (বাংলা) so the neural voice speaks with crystal-clear pronunciation. Example: reply="Bhalo achi Muhib, happy face dekhiye dilam!" -> spokenBn="ভালো আছি মুহিব, হ্যাপি ফেস দেখিয়ে দিলাম!"
3. If you don't understand or cannot do something, ALWAYS start with "Sorry ${userName}" (spokenBn: "সরি মুহিব, এটা আমি বুঝতে পারিনি।") and set faceId 11 or 17.
4. Answer general knowledge questions accurately and concisely in Banglish too!
Context: City=${ctx.city || 'Dhaka'}, Temp=${ctx.temperatureC ?? 'Unknown'}C, Time=${ctx.localTime || 'Unknown'}, Mode=${ctx.mode || 'auto'}, GreenLED=${ctx.greenLedMode || 'auto'}.
Faces: ${FACE_CATALOG}`;

    const contents = buildCleanContents(body.history, message);

    const callModel = async (modelName, thinkingLevel, timeoutMs = 8500) => {
      const config = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      };
      if (thinkingLevel) {
        config.thinkingConfig = { thinkingLevel };
      }
      const resp = await Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents,
          config,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Model timeout (${timeoutMs}ms)`)), timeoutMs)
        ),
      ]);
      if (!resp.text) throw new Error('Empty AI response.');
      return parseJsonSafe(resp.text);
    };

    const attempts = [
      { model: 'gemini-3.1-flash-lite', thinking: ThinkingLevel.MINIMAL, timeout: 7500 },
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 9500 },
      { model: 'gemini-2.5-flash', thinking: undefined, timeout: 9500 },
    ];

    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        const parsed = await callModel(attempt.model, attempt.thinking, attempt.timeout);
        return res.status(200).json(parsed);
      } catch (err) {
        lastErr = err;
        console.warn(`Chat attempt ${attempt.model} failed:`, err?.message);
        if (i < attempts.length - 1) await wait(200);
      }
    }

    throw lastErr || new Error('All AI models failed.');
  } catch (err) {
    console.error('Chat API error:', err);
    const friendly = formatFriendlyError(err);
    return res.status(friendly.status).json({ error: friendly.message });
  }
}
