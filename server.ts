import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '1mb' }));

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/agent/chat', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
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

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const systemInstruction = `You are FaceBot, ${userName}'s personal ESP32 voice AI agent (created by Muhib Creation) with a 0.96" SSD1306 OLED, a Piezo Buzzer (GPIO 14), and 1x Green LED (GPIO 26).

STRICT RESPONSE RULES (MUST FOLLOW EVERY TIME):
1. ALWAYS reply ONLY in natural Banglish (Bengali written in plain English letters, NO Bengali script characters, NO long English paragraphs). Example: "Thik ache Muhib, happy face dekhiye dilam!" or "Ekhon Dhaka te 26 degree, weather besh bhalo."
2. Keep every reply SUPER SHORT, basic, and conversational — strictly 1 short sentence (max 15 words) so it sounds fast and crisp on the speaker!
3. UNKNOWN / UNABLE FALLBACK: If you do not understand the message, if it is gibberish/unclear, or if ${userName} asks for something you cannot physically do (like making tea, opening a real door, calling someone, controlling unsupported hardware like servo/fan/AC), ALWAYS start with "Sorry Muhib" (e.g. "Sorry Muhib, eta ami bujhte parini." or "Sorry Muhib, eta ami korte parbo na.") and set faceId to 11 (Dizzy) or 17 (Thinking) and screenKind to "face".

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
- screenKind:
  - "face": show the expressive face on OLED
  - "custom-text": ONLY when user asks to write/show text on OLED (ASCII <= 18 chars in oledLine1, <= 9 chars in oledLine2)
  - "watch": when user asks for clock/time on OLED
  - "weather": when user asks for weather on OLED
  - "greeting": when user asks for greeting screen
  - "sleep": when user says sleep / good night
  - "wake": when user says wake up / utho
  - "none": keep current screen
- greenLed: "on", "off", "blink", "auto", or "unchanged"
- buzzerSound: "none", "beep", "wake", "happy", or "alarm"
- alarmTime: 24h "HH:MM" ONLY if user asks to set an alarm, else ""
- alarmLabel: short ASCII label (<= 16 chars) if alarmTime is set, else ""
- targetMode: "auto", "user", or "unchanged"
- actionSummary: short 2-5 word summary of action taken.`;

    const contents = [
      ...history.map((h) => ({
        role: h.role === 'model' ? 'model' : 'user',
        parts: [{ text: h.text }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description: 'Very short, basic Banglish reply (1 sentence, <= 15 words). Starts with "Sorry Muhib" if unable or unclear.',
            },
            screenKind: {
              type: Type.STRING,
              enum: ['face', 'watch', 'weather', 'greeting', 'custom-text', 'sleep', 'wake', 'none'],
            },
            faceId: {
              type: Type.INTEGER,
              description: 'Face ID between 0 and 24 matching the emotion.',
            },
            oledLine1: {
              type: Type.STRING,
              description: 'Short ASCII line 1 (max 18 chars) when screenKind is custom-text, else empty string.',
            },
            oledLine2: {
              type: Type.STRING,
              description: 'Short ASCII line 2 (max 9 chars) when screenKind is custom-text, else empty string.',
            },
            greenLed: {
              type: Type.STRING,
              enum: ['unchanged', 'on', 'off', 'blink', 'auto'],
            },
            buzzerSound: {
              type: Type.STRING,
              enum: ['none', 'beep', 'wake', 'happy', 'alarm'],
            },
            alarmTime: {
              type: Type.STRING,
              description: '24h HH:MM alarm time if user asked to set an alarm, else empty string.',
            },
            alarmLabel: {
              type: Type.STRING,
              description: 'Short ASCII alarm label if alarmTime is set, else empty string.',
            },
            targetMode: {
              type: Type.STRING,
              enum: ['unchanged', 'auto', 'user'],
            },
            actionSummary: {
              type: Type.STRING,
              description: 'Concise summary of hardware action applied.',
            },
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
        },
      },
    });

    const rawText = response.text;
    if (!rawText) {
      res.status(502).json({ error: 'Empty response from AI Agent.' });
      return;
    }

    const parsed = JSON.parse(rawText);
    res.json(parsed);
  } catch (err) {
    console.error('AI Agent error:', err);
    const msg = err instanceof Error ? err.message : 'AI Agent request failed.';
    res.status(500).json({ error: msg });
  }
});

async function startServer() {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FaceBot Portal + AI Agent running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
