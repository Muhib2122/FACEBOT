// Piezo Buzzer Synthesizer using Web Audio API (loud, crisp Bip-Bip alarm & chime tones)

let audioCtx: AudioContext | null = null;
const activeOscillators = new Set<OscillatorNode>();

export function unlockBuzzerAudio(): void {
  if (typeof window === 'undefined') return;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

function getAudioContext(): AudioContext | null {
  unlockBuzzerAudio();
  return audioCtx;
}

export function stopBuzzerAudio(): void {
  for (const osc of activeOscillators) {
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      // ignore
    }
  }
  activeOscillators.clear();
}

function playTone(
  freq: number,
  durationMs: number,
  startOffsetSec = 0,
  volume = 0.2,
  waveType: OscillatorType = 'square'
) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const startAt = ctx.currentTime + startOffsetSec;
  const endAt = startAt + durationMs / 1000;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = waveType;
  osc.frequency.setValueAtTime(freq, startAt);

  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.setValueAtTime(volume, Math.max(startAt + 0.015, endAt - 0.02));
  gain.gain.exponentialRampToValueAtTime(0.001, endAt);

  osc.connect(gain);
  gain.connect(ctx.destination);

  activeOscillators.add(osc);
  osc.onended = () => {
    activeOscillators.delete(osc);
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // ignore
    }
  };

  osc.start(startAt);
  osc.stop(endAt + 0.02);
}

export function playWakeChime(muted: boolean) {
  if (muted) return;
  playTone(523, 95, 0, 0.14, 'triangle');
  playTone(659, 95, 0.11, 0.15, 'triangle');
  playTone(784, 100, 0.22, 0.16, 'triangle');
  playTone(1046, 170, 0.33, 0.18, 'triangle');
}

// Crisp, unmistakable "Bip-Bip-Bip" digital alarm sound matching ESP32 GPIO 14 piezo buzzer
export function playAlarmMelody(melody: 'classic' | 'gentle' | 'urgent', muted: boolean) {
  if (muted) return;
  if (melody === 'classic') {
    // Classic loud digital alarm: BIP - BIP - BIP - BIP!
    playTone(2000, 110, 0.0, 0.24, 'square');
    playTone(2000, 110, 0.17, 0.24, 'square');
    playTone(2000, 110, 0.34, 0.24, 'square');
    playTone(2400, 180, 0.52, 0.26, 'square');
  } else if (melody === 'gentle') {
    // Soft warm chime: Ding-Dong-Ding!
    playTone(587, 150, 0.0, 0.16, 'triangle');
    playTone(784, 150, 0.2, 0.18, 'triangle');
    playTone(1046, 240, 0.4, 0.2, 'triangle');
  } else {
    // Urgent rapid siren: BIP-BOP-BIP-BOP-BIP!
    playTone(2400, 95, 0.0, 0.26, 'square');
    playTone(1600, 95, 0.12, 0.24, 'square');
    playTone(2400, 95, 0.24, 0.26, 'square');
    playTone(1600, 95, 0.36, 0.24, 'square');
    playTone(2600, 160, 0.48, 0.28, 'square');
  }
}

export function playBuzzerTest(muted: boolean) {
  if (muted) return;
  // Clear double Bip-Bip piezo check
  playTone(1800, 100, 0.0, 0.2, 'square');
  playTone(2200, 130, 0.16, 0.22, 'square');
}

export function playShortClick(muted: boolean) {
  if (muted) return;
  playTone(1200, 30, 0, 0.06, 'triangle');
}
