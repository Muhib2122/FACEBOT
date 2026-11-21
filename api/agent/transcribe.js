import { GoogleGenAI, ThinkingLevel } from '@google/genai';

function formatFriendlyError(err) {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'Free Gemini API rate limit sesh hoye geche — 20 second por abr record koro.',
    };
  }
  return {
    status: 500,
    message: 'Voice transcribe korte problem holo — aro clear kore bolo.',
  };
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
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
    if (!audioBase64) return res.status(400).json({ error: 'audioBase64 is required.' });

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const parts = [
      { inlineData: { mimeType, data: audioBase64 } },
      {
        text: 'Transcribe this audio accurately. If spoken in Bengali/Banglish or English, return ONLY the clean spoken text with no extra notes.',
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

    return res.status(200).json({ text: (response.text || '').trim() });
  } catch (err) {
    console.error('Transcribe error:', err);
    const friendly = formatFriendlyError(err);
    return res.status(friendly.status).json({ error: friendly.message });
  }
}
