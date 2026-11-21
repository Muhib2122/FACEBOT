import { GoogleGenAI } from '@google/genai';

const ALLOWED_VOICES = new Set(['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir']);

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TTS timeout (${ms}ms)`)), ms)
    ),
  ]);
}

function ensureWavBase64(base64Audio, inlineMimeType = '') {
  const rawBuf = Buffer.from(base64Audio, 'base64');
  // Already has a valid RIFF/WAVE header
  if (
    rawBuf.length >= 12 &&
    rawBuf[0] === 0x52 &&
    rawBuf[1] === 0x49 &&
    rawBuf[2] === 0x46 &&
    rawBuf[3] === 0x46
  ) {
    return base64Audio;
  }

  // Raw PCM16 (e.g. audio/L16;codec=pcm;rate=24000) -> wrap with standard 44-byte WAV header
  const rateMatch = String(inlineMimeType).match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = rawBuf.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // AudioFormat = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, rawBuf]).toString('base64');
}

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

    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
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

    const ttsAttempts = [
      {
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: speechText,
                speechMetadata: {
                  style:
                    'Crystal-clear, warm, friendly Bangladeshi Bengali and English voice assistant speaking calmly at a steady pace',
                },
              },
            ],
          },
        ],
        timeout: 6500,
      },
      {
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{ role: 'user', parts: [{ text: speechText }] }],
        timeout: 6500,
      },
      {
        model: 'gemini-3.8-flash-tts',
        contents: [{ role: 'user', parts: [{ text: speechText }] }],
        timeout: 7000,
      },
      {
        model: 'gemini-2.5-flash-preview-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text: `Speak clearly and warmly: ${speechText}` }],
          },
        ],
        timeout: 8000,
      },
    ];

    let inlineData = null;
    let lastErr = null;
    for (const attempt of ttsAttempts) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: attempt.model,
            contents: attempt.contents,
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
          attempt.timeout
        );
        const found = response.candidates?.[0]?.content?.parts?.find(
          (p) => Boolean(p?.inlineData?.data)
        )?.inlineData;
        if (found?.data) {
          inlineData = found;
          break;
        }
      } catch (err) {
        lastErr = err;
        console.warn(`TTS attempt ${attempt.model} failed:`, err?.message || err);
      }
    }

    const base64Audio = inlineData?.data;
    if (!base64Audio) {
      if (lastErr) throw lastErr;
      return res.status(502).json({ error: 'No audio returned by Gemini TTS.' });
    }

    const wavBase64 = ensureWavBase64(base64Audio, inlineData?.mimeType || '');

    return res.status(200).json({
      audioBase64: wavBase64,
      mimeType: 'audio/wav',
      voiceName,
    });
  } catch (err) {
    console.error('TTS error:', err);
    return res.status(500).json({ error: formatFriendlyError(err) });
  }
}
