import { GifReader } from 'omggif';
import { SavedGifItem } from '../types';
import { drawHeart, drawStar, OLED_HEIGHT, OLED_WIDTH, SSD1306Buffer } from './oledRenderer';

export interface DecodedGifResult {
  framesHex: string[];
  recommendedDelayMs: number;
  originalFrameCount: number;
  width: number;
  height: number;
}

export interface GifDecodeOptions {
  threshold: number; // 10..245
  invert: boolean;
  fitMode: 'contain' | 'fill';
  maxFrames: number; // 1..30
}

export function packedBytesToHex2048(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < 1024; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

export function hex2048ToPackedBytes(hex: string): Uint8Array {
  const out = new Uint8Array(1024);
  if (!hex || hex.length < 2048) return out;
  for (let i = 0; i < 1024; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

export function writeHex2048ToBuffer(hex: string, buffer: SSD1306Buffer): void {
  buffer.clearDisplay();
  if (!hex || hex.length < 2048) return;
  for (let i = 0; i < 1024; i++) {
    const byteVal = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    const y = Math.floor(i / 16);
    const xb = i % 16;
    const rowBase = y * OLED_WIDTH + xb * 8;
    for (let bit = 0; bit < 8; bit++) {
      buffer.pixels[rowBase + bit] = (byteVal >> (7 - bit)) & 1;
    }
  }
}

export function framesHexToBinaryBlob(framesHex: string[]): Blob {
  const totalBytes = new Uint8Array(framesHex.length * 1024);
  framesHex.forEach((hex, idx) => {
    totalBytes.set(hex2048ToPackedBytes(hex), idx * 1024);
  });
  return new Blob([totalBytes], { type: 'application/octet-stream' });
}

/**
 * Decode any animated GIF ArrayBuffer into 128x64 1-bit monochrome frames (1024 bytes / 2048 hex chars each).
 * Handles GIF frame disposal methods properly so delta/transparent GIFs animate cleanly.
 */
export function decodeGifToOledFrames(
  arrayBuffer: ArrayBuffer,
  options: GifDecodeOptions
): DecodedGifResult {
  const reader = new GifReader(new Uint8Array(arrayBuffer));
  const width = reader.width;
  const height = reader.height;
  const numFrames = reader.numFrames();
  if (numFrames <= 0 || width <= 0 || height <= 0) {
    throw new Error('Selected GIF contains no readable animation frames.');
  }

  const maxF = Math.max(1, Math.min(30, options.maxFrames || 30));
  const stride = numFrames > maxF ? numFrames / maxF : 1;

  // Persistent composition canvas for proper GIF disposal handling
  const compCanvas = document.createElement('canvas');
  compCanvas.width = width;
  compCanvas.height = height;
  const compCtx = compCanvas.getContext('2d', { willReadFrequently: true });

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = width;
  patchCanvas.height = height;
  const patchCtx = patchCanvas.getContext('2d', { willReadFrequently: true });

  const oledCanvas = document.createElement('canvas');
  oledCanvas.width = OLED_WIDTH;
  oledCanvas.height = OLED_HEIGHT;
  const oledCtx = oledCanvas.getContext('2d', { willReadFrequently: true });

  if (!compCtx || !patchCtx || !oledCtx) {
    throw new Error('Browser Canvas 2D context is unavailable.');
  }

  // Fill initial background with black
  compCtx.fillStyle = '#000000';
  compCtx.fillRect(0, 0, width, height);

  const selectedIndices = new Set<number>();
  for (let i = 0; i < Math.min(numFrames, maxF); i++) {
    selectedIndices.add(Math.min(numFrames - 1, Math.floor(i * stride)));
  }

  const framesHex: string[] = [];
  const rawFrameRgba = new Uint8ClampedArray(width * height * 4);
  let delaySum = 0;
  let delayCount = 0;

  let prevCanvasBackup: ImageData | null = null;

  for (let f = 0; f < numFrames; f++) {
    const info = reader.frameInfo(f);
    if (info.disposal === 3) {
      prevCanvasBackup = compCtx.getImageData(0, 0, width, height);
    }

    // Decode current frame pixels into fresh buffer and blit onto composition canvas
    rawFrameRgba.fill(0);
    reader.decodeAndBlitFrameRGBA(f, rawFrameRgba);
    patchCtx.putImageData(new ImageData(rawFrameRgba, width, height), 0, 0);
    compCtx.drawImage(patchCanvas, 0, 0);

    if (selectedIndices.has(f)) {
      if (info.delay && info.delay > 0) {
        delaySum += info.delay * 10; // GIF delay is in centiseconds
        delayCount += 1;
      }

      oledCtx.fillStyle = options.invert ? '#ffffff' : '#000000';
      oledCtx.fillRect(0, 0, OLED_WIDTH, OLED_HEIGHT);

      if (options.fitMode === 'contain') {
        const scale = Math.min(OLED_WIDTH / width, OLED_HEIGHT / height);
        const drawW = Math.max(1, Math.round(width * scale));
        const drawH = Math.max(1, Math.round(height * scale));
        const offsetX = Math.floor((OLED_WIDTH - drawW) / 2);
        const offsetY = Math.floor((OLED_HEIGHT - drawH) / 2);
        oledCtx.drawImage(compCanvas, offsetX, offsetY, drawW, drawH);
      } else {
        oledCtx.drawImage(compCanvas, 0, 0, OLED_WIDTH, OLED_HEIGHT);
      }

      const scaledData = oledCtx.getImageData(0, 0, OLED_WIDTH, OLED_HEIGHT).data;
      const packed = new Uint8Array(1024);

      for (let y = 0; y < OLED_HEIGHT; y++) {
        for (let x = 0; x < OLED_WIDTH; x += 8) {
          let byteVal = 0;
          for (let b = 0; b < 8; b++) {
            const idx = (y * OLED_WIDTH + (x + b)) * 4;
            const lum =
              0.299 * scaledData[idx] +
              0.587 * scaledData[idx + 1] +
              0.114 * scaledData[idx + 2];
            const isLit = options.invert ? lum < options.threshold : lum >= options.threshold;
            if (isLit) {
              byteVal |= 1 << (7 - b);
            }
          }
          packed[y * 16 + (x >> 3)] = byteVal;
        }
      }

      framesHex.push(packedBytesToHex2048(packed));
    }

    // Apply GIF frame disposal after capturing
    if (info.disposal === 2) {
      compCtx.fillStyle = '#000000';
      compCtx.fillRect(info.x, info.y, info.width, info.height);
    } else if (info.disposal === 3 && prevCanvasBackup) {
      compCtx.putImageData(prevCanvasBackup, 0, 0);
      prevCanvasBackup = null;
    }
  }

  const avgDelay = delayCount > 0 ? Math.round(delaySum / delayCount) : 100;
  const recommendedDelayMs = Math.max(40, Math.min(500, Math.round(avgDelay * stride)));

  return {
    framesHex,
    recommendedDelayMs,
    originalFrameCount: numFrames,
    width,
    height,
  };
}

function bufferToHex2048(buf: SSD1306Buffer): string {
  const bytes = new Uint8Array(1024);
  for (let y = 0; y < OLED_HEIGHT; y++) {
    for (let xb = 0; xb < 16; xb++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (buf.pixels[y * OLED_WIDTH + xb * 8 + bit]) {
          b |= 1 << (7 - bit);
        }
      }
      bytes[y * 16 + xb] = b;
    }
  }
  return packedBytesToHex2048(bytes);
}

/**
 * Built-in ready-to-play 128x64 monochrome animated starter GIFs so the GIF Gallery works immediately.
 */
export function createStarterGifs(): SavedGifItem[] {
  // 1. Beating Heart Loop (12 frames)
  const heartFrames: string[] = [];
  for (let i = 0; i < 12; i++) {
    const buf = new SSD1306Buffer();
    const t = (i / 12) * Math.PI * 2;
    const size = Math.round(11 + Math.sin(t) * 4);
    const bounceY = Math.round(Math.cos(t) * 3);
    drawHeart(buf, 64, 30 + bounceY, size);
    drawStar(buf, 22, 18 + (i % 3), 4);
    drawStar(buf, 106, 18 + ((i + 1) % 3), 4);
    buf.printCentered('LOVE FACEBOT', 53, 1, 1);
    heartFrames.push(bufferToHex2048(buf));
  }

  // 2. Cyber Radar Wave (14 frames)
  const waveFrames: string[] = [];
  for (let i = 0; i < 14; i++) {
    const buf = new SSD1306Buffer();
    const phase = (i / 14) * Math.PI * 2;
    buf.drawRect(2, 2, 124, 60, 1);
    buf.printCentered('MUHIB CYBER WAVE', 8, 1, 1);
    for (let x = 8; x < 120; x += 2) {
      const y = Math.round(36 + Math.sin(x * 0.09 + phase) * 14);
      buf.fillCircle(x, y, 1, 1);
    }
    const scanX = 8 + Math.round(((i / 14) * 110) % 110);
    buf.drawFastVLine(scanX, 18, 38, 1);
    waveFrames.push(bufferToHex2048(buf));
  }

  // 3. Shooting Stars Orbit (12 frames)
  const starFrames: string[] = [];
  for (let i = 0; i < 12; i++) {
    const buf = new SSD1306Buffer();
    const angle = (i / 12) * Math.PI * 2;
    buf.drawCircle(64, 32, 22, 1);
    const sx = Math.round(64 + Math.cos(angle) * 22);
    const sy = Math.round(32 + Math.sin(angle) * 22);
    const sx2 = Math.round(64 + Math.cos(angle + Math.PI) * 22);
    const sy2 = Math.round(32 + Math.sin(angle + Math.PI) * 22);
    drawStar(buf, sx, sy, 6);
    drawStar(buf, sx2, sy2, 5);
    buf.printCentered('AI', 25, 2, 1);
    starFrames.push(bufferToHex2048(buf));
  }

  return [
    {
      id: 'gif-starter-heart',
      name: 'beating_heart',
      frameDelayMs: 90,
      framesHex: heartFrames,
      createdAt: Date.now() - 3000,
    },
    {
      id: 'gif-starter-wave',
      name: 'cyber_wave',
      frameDelayMs: 85,
      framesHex: waveFrames,
      createdAt: Date.now() - 2000,
    },
    {
      id: 'gif-starter-orbit',
      name: 'star_orbit',
      frameDelayMs: 100,
      framesHex: starFrames,
      createdAt: Date.now() - 1000,
    },
  ];
}
