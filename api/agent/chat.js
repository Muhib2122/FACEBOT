import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const FACE_CATALOG = [
  '0: Normal Blink', '1: Super Happy', '2: Cute Wink', '3: Freezing Cold', '4: In Love',
  '5: Angry', '6: Surprised', '7: Sleepy', '8: Cool Shades', '9: Sad Puppy',
  '10: Crying', '11: Dizzy', '12: Starry Eyed', '13: Skeptical', '14: Cheeky Tongue',
  '15: Kawaii Cat', '16: Knocked Out', '17: Thinking', '18: Shy Blushing', '19: Angry Shout',
  '20: Cyclops Alien', '21: Money Eyes', '22: Robot Scan', '23: Smug Proud', '24: Looking Around',
].join(', ');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const systemInstruction = `You are FaceBot, ${userName}'s personal ESP32 voice AI agent (created by Muhib Creation) with a 0.96" SSD1306 OLED, a Piezo Buzzer (GPIO 14), and 1x Green LED (GPIO 26).
STRICT RULES:
1. ALWAYS reply ONLY in natural Banglish (Bengali written in English letters).
2. Keep every reply SUPER SHORT and basic — 1 short sentence (max 15 words).
3. If you don't understand or cannot do it, ALWAYS start with "Sorry Muhib" (e.g., "Sorry Muhib, eta ami bujhte parini.") and pick faceId 11 or 17.
Context: City=${ctx.city || 'Dhaka'}, Temp=${ctx.temperatureC ?? 'Unknown'}C, Time=${ctx.localTime || 'Unknown'}, Mode=${ctx.mode || 'auto'}, GreenLED=${ctx.greenLedMode || 'auto'}.
Faces: ${FACE_CATALOG}`;

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
            reply: { type: Type.STRING },
            screenKind: { type: Type.STRING, enum: ['face', 'watch', 'weather', 'greeting', 'custom-text', 'sleep', 'wake', 'none'] },
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
          required: ['reply', 'screenKind', 'faceId', 'oledLine1', 'oledLine2', 'greenLed', 'buzzerSound', 'alarmTime', 'alarmLabel', 'targetMode', 'actionSummary'],
        },
      },
    });

    if (!response.text) return res.status(502).json({ error: 'Empty AI response.' });
    return res.status(200).json(JSON.parse(response.text));
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Agent error' });
  }
}
