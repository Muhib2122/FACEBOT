import { GoogleGenAI, ThinkingLevel } from '@google/genai';

function parseBilingualReply(rawText, userName) {
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
    message: 'Web search korte ektu problem holo, abr try koro.',
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Search timeout (${ms}ms)`)), ms)
    ),
  ]);
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
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const userName = typeof body.userName === 'string' ? body.userName : 'Muhib';
    if (!query) return res.status(400).json({ error: 'Query is required.' });

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const systemInstruction = `You are FaceBot, ${userName}'s smart assistant.
Answer concisely in 1–2 short, clear sentences.
ALWAYS output strictly in these 2 lines:
BANGLISH: <same answer in natural Banglish using plain English letters>
BANGLA: <exact same answer in clean Bengali script for clear voice pronunciation>
If not found, output:
BANGLISH: Sorry ${userName}, eta khuje pai ni.
BANGLA: সরি মুহিব, এটা খুঁজে পাইনি।`;

    const attempts = [
      { model: 'gemini-4-hydrogen', tools: [{ googleSearch: {} }], thinking: ThinkingLevel.LOW, fallback: false, timeout: 7500, delayMs: 300 },
      { model: 'gemini-4-hydrogen', tools: [{ googleSearch: {} }], thinking: ThinkingLevel.LOW, fallback: false, timeout: 7500, delayMs: 400 },
      { model: 'gemini-4-hydrogen', tools: undefined, thinking: ThinkingLevel.LOW, fallback: true, timeout: 6500, delayMs: 300 },
      { model: 'gemini-3.1-flash-lite', tools: undefined, thinking: ThinkingLevel.MINIMAL, fallback: true, timeout: 4500, delayMs: 0 },
    ];

    let response = null;
    let searchFallback = false;
    let lastErr = null;

    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      try {
        const config = { systemInstruction };
        if (a.thinking) config.thinkingConfig = { thinkingLevel: a.thinking };
        if (a.tools) config.tools = a.tools;
        response = await withTimeout(
          ai.models.generateContent({ model: a.model, contents: query, config }),
          a.timeout
        );
        searchFallback = a.fallback;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`Search attempt #${i + 1} (${a.model}) failed:`, err?.message);
        if (a.delayMs > 0) await wait(a.delayMs);
      }
    }

    if (!response) throw lastErr || new Error('All search attempts failed.');

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = rawChunks
      .filter((c) => c?.web?.uri)
      .slice(0, 4)
      .map((c) => ({ title: c.web.title || c.web.uri, uri: c.web.uri }));

    const { reply, spokenBn } = parseBilingualReply(response.text, userName);

    return res.status(200).json({
      reply,
      spokenBn,
      sources,
      searchFallback,
    });
  } catch (err) {
    console.error('Search API error:', err);
    const friendly = formatFriendlyError(err);
    return res.status(friendly.status).json({ error: friendly.message });
  }
}
