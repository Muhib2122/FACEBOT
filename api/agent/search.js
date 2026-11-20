import { GoogleGenAI, ThinkingLevel } from '@google/genai';

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
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return res.status(400).json({ error: 'Query is required.' });

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: query,
      config: {
        systemInstruction:
          'You are FaceBot, Muhib\'s assistant. Answer using live Google Search results in very short, simple Banglish (1-2 short sentences max). If unsure or not found, say "Sorry Muhib, eta khuje pai ni."',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ googleSearch: {} }],
      },
    });

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = rawChunks
      .filter((c) => c?.web?.uri)
      .slice(0, 4)
      .map((c) => ({ title: c.web.title || c.web.uri, uri: c.web.uri }));

    return res.status(200).json({
      reply: response.text || 'Sorry Muhib, kono info pai ni.',
      sources,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Search error' });
  }
}
