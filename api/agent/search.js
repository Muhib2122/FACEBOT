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

    let response = null;
    let searchFallback = false;

    // 1. Primary: gemini-4-hydrogen with ThinkingLevel.LOW + Google Search grounding
    try {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: query,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: [{ googleSearch: {} }],
        },
      });
    } catch (primaryErr) {
      console.warn('Primary search (gemini-4-hydrogen) failed:', primaryErr?.message);
      await wait(450);

      // 2. Secondary: gemini-3.1-flash-lite with Google Search grounding
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: query,
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }],
          },
        });
      } catch (searchErr) {
        console.warn('Search tool quota/error, trying standard gemini-4-hydrogen:', searchErr?.message);
        await wait(450);

        // 3. Fallback when Google Search grounding quota is busy: direct Gemini knowledge answer
        searchFallback = true;
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: query,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
      }
    }

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
