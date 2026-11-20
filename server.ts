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

app.get('/api/bot-state', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const deviceId = String(req.query.device || 'muhib-bot-1').slice(0, 32);
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
    otaTriggerSeq: 0,
    updatedAt: 0,
  };
  res.json(existing);
});

app.post('/api/bot-state', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const deviceId = String(req.query.device || 'muhib-bot-1').slice(0, 32);
  const body = (req.body || {}) as Record<string, unknown>;
  const prev = deviceStore.get(deviceId) || {};
  const payload = {
    ...prev,
    ...body,
    deviceId,
    updatedAt: Date.now(),
  };
  deviceStore.set(deviceId, payload);
  res.json({ ok: true, updatedAt: payload.updatedAt });
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

    const runChatModel = async (model: string, minimalThinking: boolean) => {
      const resp = await ai.models.generateContent({
        model,
        contents: cleanedContents,
        config: {
          systemInstruction,
          maxOutputTokens: 280,
          ...(minimalThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      const txt = (resp.text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      if (!txt) throw new Error('Empty response from AI Agent.');
      return JSON.parse(txt);
    };

    try {
      const parsed = await runChatModel('gemini-4-hydrogen', true);
      res.json(parsed);
    } catch (primaryErr) {
      console.warn('Primary chat failed, falling back to gemini-3.1-flash-lite:', primaryErr);
      const fallback = await runChatModel('gemini-3.1-flash-lite', false);
      res.json(fallback);
    }
  } catch (err) {
    console.error('AI Agent error:', err);
    const msg = err instanceof Error ? err.message : 'AI Agent request failed.';
    res.status(500).json({ error: msg });
  }
});

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

    const searchInstruction = `You are FaceBot, ${userName}'s desktop AI agent. Answer the user's real-time web query using Google Search results ONLY in very short, simple Banglish (1-2 crisp sentences, plain English letters, no Bengali script). If you cannot find the answer, say "Sorry ${userName}, eta Google e khuje pai ni."`;

    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: query,
        config: {
          systemInstruction: searchInstruction,
          maxOutputTokens: 220,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          tools: [{ googleSearch: {} }],
        },
      });
    } catch {
      response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: query,
        config: {
          systemInstruction: searchInstruction,
          maxOutputTokens: 220,
          tools: [{ googleSearch: {} }],
        },
      });
    }

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = rawChunks
      .filter((c) => Boolean(c?.web?.uri))
      .slice(0, 4)
      .map((c) => ({
        title: c.web?.title || c.web?.uri || 'Source',
        uri: c.web?.uri || '',
      }));

    res.json({
      reply: (response.text || `Sorry ${userName}, kono info pai ni.`).trim(),
      sources,
    });
  } catch (err) {
    console.error('Search Grounding error:', err);
    const msg = err instanceof Error ? err.message : 'Google Search grounding failed.';
    res.status(500).json({ error: msg });
  }
});

// =========================================================================
// 4. AUDIO TRANSCRIPTION (gemini-3.5-transcribe)
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
          {
            text: 'Transcribe this audio accurately. If spoken in Bengali/Banglish or English, return only the clean spoken text.',
          },
        ],
      },
    });

    res.json({ text: (response.text || '').trim() });
  } catch (err) {
    console.error('Transcribe error:', err);
    const msg = err instanceof Error ? err.message : 'Audio transcription failed.';
    res.status(500).json({ error: msg });
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

    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [controlFaceBotDeclaration] }],
          systemInstruction: `You are FaceBot, ${userName}'s friendly ESP32 voice companion living in ${city} (by Muhib Creation).
Speak ONLY in very short, natural Bengali/Banglish sentences (1 short sentence max!).
Whenever ${userName} asks to change face, show clock/weather/text on OLED, control Green LED, ring buzzer, sleep, wake up, or set an alarm, ALWAYS call the controlFaceBot tool right away.
If you don't understand or cannot do something, politely say "Sorry ${userName}, eta ami bujhte parini" or "Sorry ${userName}, eta ami korte parbo na."`,
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
