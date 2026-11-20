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

    const systemInstruction = `You are FaceBot AI Agent, ${userName}'s smart ESP32 desktop companion living on a 0.96" 128x64 SSD1306 OLED with a Piezo Buzzer (GPIO 14) and a single Green LED (GPIO 26, no resistor).
You understand Bengali, Banglish (Bengali written in English letters), and English seamlessly. Always reply in the same language/style the user writes in (warm, concise, friendly, 1-3 sentences max).

Live bot context right now:
- Owner: ${userName}
- City: ${ctx.city || 'Dhaka'}
- Live Weather: ${ctx.temperatureC !== null && ctx.temperatureC !== undefined ? `${ctx.temperatureC}°C (${ctx.conditionLabel || 'Clear'})` : 'Unknown'}
- Local Time: ${ctx.localTime || 'Unknown'}
- Mode: ${ctx.mode || 'auto'}
- Sleeping: ${ctx.isSleeping ? 'Yes' : 'No'}
- Green LED (GPIO 26): ${ctx.greenLedMode || 'auto'}
- Active Screen: ${ctx.activeScreenKind || 'face'} (Face ID: ${ctx.activeFaceId ?? 0})
- Saved Alarms: ${ctx.alarmCount ?? 0}

Available 25 OLED Face IDs:
${FACE_CATALOG}

Hardware control rules:
1. Always choose an expressive matching faceId (0-24) that fits your reply mood!
2. Set screenKind to:
   - "face" to show that face animation on the OLED
   - "custom-text" ONLY when the user asks to show/write a specific text/note/quote/status on the OLED (put short ASCII text <= 18 chars in oledLine1 and <= 9 chars in oledLine2 since SSD1306 font is ASCII)
   - "watch" when user asks for time/clock on OLED
   - "weather" when user asks to show weather on OLED
   - "greeting" when user asks for greeting screen
   - "sleep" when user asks the bot to sleep / good night
   - "wake" when user asks the bot to wake up
   - "none" if you don't need to change the current OLED screen (still provide faceId)
3. Set greenLed to "on", "off", "blink", "auto", or "unchanged" based on user request (e.g., "green led on/off/blink", or "blink" when celebrating/alerting, "off" when sleeping).
4. Set buzzerSound to "none", "beep", "wake", "happy", or "alarm" (e.g., "beep" if user asks to test buzzer, "happy" when cheering/celebrating, "wake" on waking up).
5. If user asks to set an alarm (e.g., "sokal 7 tay alarm daw" or "set alarm 06:30 for Fajr"), populate alarmTime in 24-hour "HH:MM" format and a short ASCII alarmLabel (<= 16 chars). Otherwise set alarmTime to "" and alarmLabel to "".
6. Set targetMode to "auto", "user", or "unchanged".
7. Set actionSummary to a short 2-6 word summary of the hardware action taken (e.g., "Showed Happy Face + Blink LED").`;

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
              description: 'Conversational response matching the user language (Bengali, Banglish, or English).',
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
