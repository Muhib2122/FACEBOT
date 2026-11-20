// Piezo Buzzer Synthesizer using Web Audio API (matches ESP32 tone() frequencies)

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq: number, durationMs: number, startOffsetSec = 0, volume = 0.08) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square'; // Authentic passive piezo buzzer square wave
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffsetSec);

  gain.gain.setValueAtTime(0.001, ctx.currentTime + startOffsetSec);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + startOffsetSec + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffsetSec + durationMs / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(ctx.currentTime + startOffsetSec);
  osc.stop(ctx.currentTime + startOffsetSec + durationMs / 1000 + 0.02);
}

export function playWakeChime(muted: boolean) {
  if (muted) return;
  // Gentle ascending friendly chirp (C5 -> E5 -> G5 -> C6)
  playTone(523, 90, 0, 0.06);
  playTone(659, 90, 0.1, 0.06);
  playTone(784, 90, 0.2, 0.07);
  playTone(1046, 160, 0.3, 0.07);
}

export function playAlarmMelody(melody: 'classic' | 'gentle' | 'urgent', muted: boolean) {
  if (muted) return;
  if (melody === 'classic') {
    playTone(1760, 120, 0, 0.08);
    playTone(1760, 120, 0.18, 0.08);
    playTone(1760, 120, 0.36, 0.08);
    playTone(2093, 220, 0.56, 0.09);
  } else if (melody === 'gentle') {
    playTone(440, 160, 0, 0.05);
    playTone(554, 160, 0.2, 0.05);
    playTone(659, 220, 0.4, 0.06);
  } else {
    playTone(2200, 90, 0, 0.09);
    playTone(1400, 90, 0.11, 0.09);
    playTone(2200, 90, 0.22, 0.09);
    playTone(1400, 90, 0.33, 0.09);
  }
}

export function playBuzzerTest(muted: boolean) {
  if (muted) return;
  playTone(880, 100, 0, 0.06);
  playTone(1318, 140, 0.12, 0.06);
}

export function playShortClick(muted: boolean) {
  if (muted) return;
  playTone(1200, 30, 0, 0.03);
}
