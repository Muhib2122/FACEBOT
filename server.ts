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
    alarmTestSeq: 0,
    alarmTestSlot: 0,
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

    const chatAttempts: { model: string; thinking?: ThinkingLevel; timeout: number }[] = [
      { model: 'gemini-3.1-flash-lite', thinking: ThinkingLevel.MINIMAL, timeout: 7500 },
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 9500 },
      { model: 'gemini-2.5-flash', thinking: undefined, timeout: 9500 },
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
        console.warn(`Chat attempt ${attempt.model} failed:`, err);
        if (i < chatAttempts.length - 1) await waitMs(200);
      }
    }
    throw lastChatErr || new Error('All AI models failed.');
  } catch (err) {
    console.error('AI Agent error:', err);
    const friendly = formatFriendlyGeminiError(err, 'AI server e ektu busy lagche, abr try koro.');
    res.status(friendly.status).json({ error: friendly.message });
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
    }[] = [
      { model: 'gemini-3.1-flash-lite', useSearchTool: true, fallback: false, timeout: 8000 },
      { model: 'gemini-4-hydrogen', useSearchTool: true, thinking: ThinkingLevel.LOW, fallback: false, timeout: 9500 },
      { model: 'gemini-2.5-flash', useSearchTool: true, fallback: false, timeout: 9500 },
      { model: 'gemini-3.1-flash-lite', useSearchTool: false, thinking: ThinkingLevel.MINIMAL, fallback: true, timeout: 7500 },
      { model: 'gemini-2.5-flash', useSearchTool: false, fallback: true, timeout: 7500 },
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
        console.warn(`Search attempt ${a.model} failed:`, err);
        if (i < searchAttempts.length - 1) await waitMs(200);
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

    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: { parts },
      });
    } catch {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
    }

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

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: speechText,
              speechMetadata: {
                style:
                  'Crystal-clear, warm, friendly Bangladeshi Bengali and English voice assistant speaking calmly at a steady, easy-to-understand pace with crisp enunciation',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(502).json({ error: 'No audio returned by Gemini TTS.' });
      return;
    }

    res.json({
      audioBase64: base64Audio,
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
