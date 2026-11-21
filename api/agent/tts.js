import { GoogleGenAI } from '@google/genai';

const ALLOWED_VOICES = new Set(['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir']);

function formatFriendlyError(err) {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return 'Voice API quota temporarily busy — browser voice use kora hocche.';
  }
  return 'Neural TTS temporarily unavailable.';
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
    const spokenBn = typeof body.spokenBn === 'string' ? body.spokenBn.trim() : '';
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const speechText = (spokenBn || text).slice(0, 420);
    if (!speechText) return res.status(400).json({ error: 'Text is required.' });

    const requestedVoice = typeof body.voiceName === 'string' ? body.voiceName : 'Kore';
    const voiceName = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : 'Kore';

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

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
      return res.status(502).json({ error: 'No audio returned by Gemini TTS.' });
    }

    return res.status(200).json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      voiceName,
    });
  } catch (err) {
    console.error('TTS error:', err);
    return res.status(500).json({ error: formatFriendlyError(err) });
  }
}
