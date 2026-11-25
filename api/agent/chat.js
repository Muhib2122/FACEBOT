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
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 4500, delayMs: 200 },
      { model: 'gemini-4-hydrogen', thinking: ThinkingLevel.LOW, timeout: 4500, delayMs: 0 },
    ];

    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        const parsed = await callModel(attempt.model, attempt.thinking, attempt.timeout);
        return res.status(200).json(parsed);
      } catch (err) {
        lastErr = err;
        console.warn(`Chat attempt #${i + 1} (${attempt.model}) failed:`, err?.message);
        const errMsg = String(err?.message || err || '').toLowerCase();
        if (errMsg.includes('api_key') || errMsg.includes('403') || errMsg.includes('permission_denied')) {
          break;
        }
        if (attempt.delayMs > 0) await wait(attempt.delayMs);
      }
    }

    const rawErrStr = String(lastErr?.message || lastErr || '').toLowerCase();
    if (rawErrStr.includes('api_key') || rawErrStr.includes('403') || rawErrStr.includes('permission_denied')) {
      throw lastErr;
    }

    // Smart Banglish NLU fallback when upstream Gemini experiences transient 503 high-demand spikes
    return res.status(200).json(buildSmartBanglishFallbackAction(message, ctx));
  } catch (err) {
    console.error('Chat API error:', err);
    const friendly = formatFriendlyError(err);
    return res.status(friendly.status).json({ error: friendly.message });
  }
}

function buildSmartBanglishFallbackAction(rawMessage, ctx = {}) {
  const userName = ctx.userName || 'Muhib';
  const city = ctx.city || 'Dhaka';
  const temp = typeof ctx.temperatureC === 'number' ? ctx.temperatureC : 29;
  const localTime =
    ctx.localTime ||
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const q = String(rawMessage || '').toLowerCase();

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
    const labelMatch = String(rawMessage || '').match(/for\s+([a-zA-Z0-9 ]{2,15})/i);
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

  if (/\b(weather|abohawa|temp|temperature|tapmatra|gorom|bristi)\b/i.test(q)) {
    res.screenKind = 'weather';
    res.faceId = temp <= 20 ? 3 : 8;
    res.reply = `Ekhon ${city} te tapmatra ${temp} degree Celsius, OLED te live weather dekhiye dilam!`;
    res.spokenBn = `এখন ${city} তে তাপমাত্রা ${temp} ডিগ্রি সেলসিয়াস, ওএলইডি তে লাইভ ওয়েদার দেখিয়ে দিলাম!`;
    res.actionSummary = `Show ${city} Weather`;
    return res;
  }

  if (/\b(time|koyta|baje|ghori|clock|watch|somoy)\b/i.test(q)) {
    res.screenKind = 'watch';
    res.faceId = 0;
    res.reply = `${userName}, ekhon somoy ${localTime}. OLED screen e live digital clock dekhiye dilam!`;
    res.spokenBn = `${userName}, এখন সময় ${localTime}। ওএলইডি স্ক্রিনে লাইভ ডিজিটাল ঘড়ি দেখিয়ে দিলাম!`;
    res.actionSummary = 'Show Live Clock';
    return res;
  }

  if (/\b(sleep|sleepy|ghum|ghuma|ghumao)\b/i.test(q) || q.includes('good night') || q.includes('suvo ratri')) {
    res.screenKind = 'sleep';
    res.faceId = 7;
    res.reply = `Good night ${userName}! Ami ekhon sleepy mode e ghumate gelam.`;
    res.spokenBn = `গুড নাইট ${userName}! আমি এখন স্লিপি মোডে ঘুমাতে গেলাম।`;
    res.actionSummary = 'Entered Sleep Mode';
    return res;
  }

  if (/\b(wake|utho|suprovat)\b/i.test(q) || q.includes('good morning')) {
    res.screenKind = 'wake';
    res.faceId = 1;
    res.buzzerSound = 'wake';
    res.reply = `Suprovat ${userName}! Ami ekdom fresh hoye uthechi!`;
    res.spokenBn = `সুপ্রভাত ${userName}! আমি একদম ফ্রেশ হয়ে উঠেছি!`;
    res.actionSummary = 'Woke Up Fresh';
    return res;
  }

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

  const textMatch = String(rawMessage || '').match(/(?:write|lekho|show text|oled te lekho)\s+["']?([a-zA-Z0-9 !?._-]{2,26})["']?/i);
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

  if (/\b(happy|khushi|haso|smile|hi|hello|salam)\b/i.test(q) || q.includes('kemon acho')) {
    res.faceId = 1;
    res.buzzerSound = /\b(happy|dekhao)\b/i.test(q) ? 'happy' : 'none';
    res.reply = `Ami ekdom bhalo achi ${userName}! Tomar jonno super happy face dekhiye dilam!`;
    res.spokenBn = `আমি একদম ভালো আছি ${userName}! তোমার জন্য সুপার হ্যাপি ফেস দেখিয়ে দিলাম!`;
    res.actionSummary = 'Super Happy Face';
    return res;
  }

  res.faceId = 1;
  res.reply = `Bujhte perechi ${userName}! Ami tomar ESP32 FaceBot, sobsomoy ready achi!`;
  res.spokenBn = `বুঝতে পেরেছি ${userName}! আমি তোমার ইএসপি ৩২ ফেসবট, সবসময় রেডি আছি!`;
  res.actionSummary = 'FaceBot Ready';
  return res;
}
