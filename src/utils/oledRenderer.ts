import { ActiveScreenState, BotSettings, CustomReaction, LocationConfig, OledColorScheme, SavedGifItem, WeatherData } from '../types';

export const OLED_WIDTH = 128;
export const OLED_HEIGHT = 64;

// Compact 5x7 Adafruit GFX-style bitmap font (ASCII 32..126)
const FONT_5X7: Record<string, number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
  '$': [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  '&': [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0x00, 0x05, 0x03, 0x00, 0x00],
  '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  ';': [0x00, 0x56, 0x36, 0x00, 0x00],
  '<': [0x08, 0x14, 0x22, 0x41, 0x00],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '>': [0x00, 0x41, 0x22, 0x14, 0x08],
  '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  '@': [0x32, 0x49, 0x79, 0x41, 0x3e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  '[': [0x00, 0x7f, 0x41, 0x41, 0x00],
  ']': [0x00, 0x41, 0x41, 0x7f, 0x00],
  '^': [0x04, 0x02, 0x01, 0x02, 0x04],
  _: [0x40, 0x40, 0x40, 0x40, 0x40],
  a: [0x20, 0x54, 0x54, 0x54, 0x78],
  b: [0x7f, 0x48, 0x44, 0x44, 0x38],
  c: [0x38, 0x44, 0x44, 0x44, 0x20],
  d: [0x38, 0x44, 0x44, 0x48, 0x7f],
  e: [0x38, 0x54, 0x54, 0x54, 0x18],
  f: [0x08, 0x7e, 0x09, 0x01, 0x02],
  g: [0x0c, 0x52, 0x52, 0x52, 0x3e],
  h: [0x7f, 0x08, 0x04, 0x04, 0x78],
  i: [0x00, 0x44, 0x7d, 0x40, 0x00],
  j: [0x20, 0x40, 0x44, 0x3d, 0x00],
  k: [0x7f, 0x10, 0x28, 0x44, 0x00],
  l: [0x00, 0x41, 0x7f, 0x40, 0x00],
  m: [0x7c, 0x04, 0x18, 0x04, 0x78],
  n: [0x7c, 0x08, 0x04, 0x04, 0x78],
  o: [0x38, 0x44, 0x44, 0x44, 0x38],
  p: [0x7c, 0x14, 0x14, 0x14, 0x08],
  q: [0x08, 0x14, 0x14, 0x18, 0x7c],
  r: [0x7c, 0x08, 0x04, 0x04, 0x08],
  s: [0x48, 0x54, 0x54, 0x54, 0x20],
  t: [0x04, 0x3f, 0x44, 0x40, 0x20],
  u: [0x3c, 0x40, 0x40, 0x20, 0x7c],
  v: [0x1c, 0x20, 0x40, 0x20, 0x1c],
  w: [0x3c, 0x40, 0x30, 0x40, 0x3c],
  x: [0x44, 0x28, 0x10, 0x28, 0x44],
  y: [0x0c, 0x50, 0x50, 0x50, 0x3c],
  z: [0x44, 0x64, 0x54, 0x4c, 0x44],
  '°': [0x06, 0x09, 0x09, 0x06, 0x00],
};

/**
 * Software 1-bit 128x64 Adafruit_SSD1306 framebuffer mirroring Adafruit_GFX methods
 */
export class SSD1306Buffer {
  pixels: Uint8Array;
  private cursorX = 0;
  private cursorY = 0;
  private textSize = 1;
  private textColor = 1;

  constructor() {
    this.pixels = new Uint8Array(OLED_WIDTH * OLED_HEIGHT);
  }

  clearDisplay() {
    this.pixels.fill(0);
  }

  drawPixel(x: number, y: number, color: number) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= OLED_WIDTH || iy < 0 || iy >= OLED_HEIGHT) return;
    this.pixels[iy * OLED_WIDTH + ix] = color ? 1 : 0;
  }

  drawFastVLine(x: number, y: number, h: number, color: number) {
    for (let i = 0; i < h; i++) {
      this.drawPixel(x, y + i, color);
    }
  }

  drawFastHLine(x: number, y: number, w: number, color: number) {
    for (let i = 0; i < w; i++) {
      this.drawPixel(x + i, y, color);
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, color: number) {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      this.drawPixel(ix0, iy0, color);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  drawRect(x: number, y: number, w: number, h: number, color: number) {
    this.drawFastHLine(x, y, w, color);
    this.drawFastHLine(x, y + h - 1, w, color);
    this.drawFastVLine(x, y, h, color);
    this.drawFastVLine(x + w - 1, y, h, color);
  }

  fillRect(x: number, y: number, w: number, h: number, color: number) {
    for (let i = 0; i < w; i++) {
      this.drawFastVLine(x + i, y, h, color);
    }
  }

  drawCircleHelper(x0: number, y0: number, r: number, cornername: number, color: number) {
    let f = 1 - r;
    let ddF_x = 1;
    let ddF_y = -2 * r;
    let x = 0;
    let y = r;
    while (x < y) {
      if (f >= 0) {
        y--;
        ddF_y += 2;
        f += ddF_y;
      }
      x++;
      ddF_x += 2;
      f += ddF_x;
      if (cornername & 0x4) {
        this.drawPixel(x0 + x, y0 + y, color);
        this.drawPixel(x0 + y, y0 + x, color);
      }
      if (cornername & 0x2) {
        this.drawPixel(x0 + x, y0 - y, color);
        this.drawPixel(x0 + y, y0 - x, color);
      }
      if (cornername & 0x8) {
        this.drawPixel(x0 - y, y0 + x, color);
        this.drawPixel(x0 - x, y0 + y, color);
      }
      if (cornername & 0x1) {
        this.drawPixel(x0 - y, y0 - x, color);
        this.drawPixel(x0 - x, y0 - y, color);
      }
    }
  }

  fillCircleHelper(x0: number, y0: number, r: number, corners: number, delta: number, color: number) {
    let f = 1 - r;
    let ddF_x = 1;
    let ddF_y = -2 * r;
    let x = 0;
    let y = r;
    let px = x;
    let py = y;
    delta++;

    while (x < y) {
      if (f >= 0) {
        y--;
        ddF_y += 2;
        f += ddF_y;
      }
      x++;
      ddF_x += 2;
      f += ddF_x;
      if (x < y + 1) {
        if (corners & 1) this.drawFastVLine(x0 + x, y0 - y, 2 * y + delta, color);
        if (corners & 2) this.drawFastVLine(x0 - x, y0 - y, 2 * y + delta, color);
      }
      if (y !== py) {
        if (corners & 1) this.drawFastVLine(x0 + py, y0 - px, 2 * px + delta, color);
        if (corners & 2) this.drawFastVLine(x0 - py, y0 - px, 2 * px + delta, color);
        py = y;
      }
      px = x;
    }
  }

  drawCircle(x0: number, y0: number, r: number, color: number) {
    let f = 1 - r;
    let ddF_x = 1;
    let ddF_y = -2 * r;
    let x = 0;
    let y = r;

    this.drawPixel(x0, y0 + r, color);
    this.drawPixel(x0, y0 - r, color);
    this.drawPixel(x0 + r, y0, color);
    this.drawPixel(x0 - r, y0, color);

    while (x < y) {
      if (f >= 0) {
        y--;
        ddF_y += 2;
        f += ddF_y;
      }
      x++;
      ddF_x += 2;
      f += ddF_x;

      this.drawPixel(x0 + x, y0 + y, color);
      this.drawPixel(x0 - x, y0 + y, color);
      this.drawPixel(x0 + x, y0 - y, color);
      this.drawPixel(x0 - x, y0 - y, color);
      this.drawPixel(x0 + y, y0 + x, color);
      this.drawPixel(x0 - y, y0 + x, color);
      this.drawPixel(x0 + y, y0 - x, color);
      this.drawPixel(x0 - y, y0 - x, color);
    }
  }

  fillCircle(x0: number, y0: number, r: number, color: number) {
    this.drawFastVLine(x0, y0 - r, 2 * r + 1, color);
    this.fillCircleHelper(x0, y0, r, 3, 0, color);
  }

  drawRoundRect(x: number, y: number, w: number, h: number, r: number, color: number) {
    const maxR = Math.floor((w < h ? w : h) / 2);
    const cr = Math.min(r, maxR);
    this.drawFastHLine(x + cr, y, w - 2 * cr, color);
    this.drawFastHLine(x + cr, y + h - 1, w - 2 * cr, color);
    this.drawFastVLine(x, y + cr, h - 2 * cr, color);
    this.drawFastVLine(x + w - 1, y + cr, h - 2 * cr, color);
    this.drawCircleHelper(x + cr, y + cr, cr, 1, color);
    this.drawCircleHelper(x + w - cr - 1, y + cr, cr, 2, color);
    this.drawCircleHelper(x + w - cr - 1, y + h - cr - 1, cr, 4, color);
    this.drawCircleHelper(x + cr, y + h - cr - 1, cr, 8, color);
  }

  fillRoundRect(x: number, y: number, w: number, h: number, r: number, color: number) {
    const maxR = Math.floor((w < h ? w : h) / 2);
    const cr = Math.min(r, maxR);
    this.fillRect(x + cr, y, w - 2 * cr, h, color);
    this.fillCircleHelper(x + w - cr - 1, y + cr, cr, 1, h - 2 * cr - 1, color);
    this.fillCircleHelper(x + cr, y + cr, cr, 2, h - 2 * cr - 1, color);
  }

  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: number) {
    let ax = Math.round(x0), ay = Math.round(y0);
    let bx = Math.round(x1), by = Math.round(y1);
    let cx = Math.round(x2), cy = Math.round(y2);

    if (ay > by) { [ay, by] = [by, ay]; [ax, bx] = [bx, ax]; }
    if (by > cy) { [by, cy] = [cy, by]; [bx, cx] = [cx, bx]; }
    if (ay > by) { [ay, by] = [by, ay]; [ax, bx] = [bx, ax]; }

    if (ay === cy) {
      let a = ax, b = ax;
      if (bx < a) a = bx; else if (bx > b) b = bx;
      if (cx < a) a = cx; else if (cx > b) b = cx;
      this.drawFastHLine(a, ay, b - a + 1, color);
      return;
    }

    const dx01 = bx - ax, dy01 = by - ay;
    const dx02 = cx - ax, dy02 = cy - ay;
    const dx12 = cx - bx, dy12 = cy - by;
    let sa = 0, sb = 0;

    const last = by === cy ? by : by - 1;
    let y = ay;
    for (; y <= last; y++) {
      let a = ax + Math.trunc(sa / dy01);
      let b = ax + Math.trunc(sb / dy02);
      sa += dx01;
      sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.drawFastHLine(a, y, b - a + 1, color);
    }

    sa = dx12 * (y - by);
    sb = dx02 * (y - ay);
    for (; y <= cy; y++) {
      let a = bx + Math.trunc(sa / dy12);
      let b = ax + Math.trunc(sb / dy02);
      sa += dx12;
      sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.drawFastHLine(a, y, b - a + 1, color);
    }
  }

  setTextSize(s: number) {
    this.textSize = Math.max(1, Math.floor(s));
  }

  setTextColor(c: number) {
    this.textColor = c ? 1 : 0;
  }

  setCursor(x: number, y: number) {
    this.cursorX = Math.round(x);
    this.cursorY = Math.round(y);
  }

  print(text: string) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') {
        this.cursorY += this.textSize * 8;
        this.cursorX = 0;
        continue;
      }
      const glyph = FONT_5X7[ch] || FONT_5X7[' '];
      for (let col = 0; col < 5; col++) {
        const line = glyph[col];
        for (let row = 0; row < 7; row++) {
          if (line & (1 << row)) {
            if (this.textSize === 1) {
              this.drawPixel(this.cursorX + col, this.cursorY + row, this.textColor);
            } else {
              this.fillRect(
                this.cursorX + col * this.textSize,
                this.cursorY + row * this.textSize,
                this.textSize,
                this.textSize,
                this.textColor
              );
            }
          }
        }
      }
      this.cursorX += 6 * this.textSize;
    }
  }

  printCentered(text: string, y: number, size = 1, color = 1) {
    const width = text.length * 6 * size - size;
    const x = Math.max(0, Math.floor((OLED_WIDTH - width) / 2));
    this.setTextSize(size);
    this.setTextColor(color);
    this.setCursor(x, y);
    this.print(text);
  }
}

const WHITE = 1;
const BLACK = 0;

// Exact port of user's helper: drawHeart
export function drawHeart(display: SSD1306Buffer, x: number, y: number, size: number) {
  display.fillCircle(x - Math.trunc(size / 2), y, Math.trunc(size / 2), WHITE);
  display.fillCircle(x + Math.trunc(size / 2), y, Math.trunc(size / 2), WHITE);
  display.fillTriangle(x - size, y + 1, x + size, y + 1, x, y + size + 3, WHITE);
}

// Exact port of user's helper: drawStar
export function drawStar(display: SSD1306Buffer, x: number, y: number, r: number) {
  display.drawLine(x - r, y, x + r, y, WHITE);
  display.drawLine(x, y - r, x, y + r, WHITE);
  display.drawLine(x - r + 2, y - r + 2, x + r - 2, y + r - 2, WHITE);
  display.drawLine(x - r + 2, y + r - 2, x + r - 2, y - r + 2, WHITE);
}

// Smooth 24-FPS interpolated expressions (sine-wave breathing, eased blinking, fluid pupil glides)
export function drawFace(display: SSD1306Buffer, type: number, frame: number) {
  display.clearDisplay();
  const t = frame * 0.22; // smooth continuous phase
  const bob = Math.round(Math.sin(t) * 2.2);
  const gentleDrift = Math.round(Math.sin(t * 0.55) * 3.5);

  // Smooth multi-step blink height (28 -> 18 -> 8 -> 4 -> 8 -> 18 -> 28)
  const blinkPhase = frame % 72;
  let eyeH = 28;
  if (blinkPhase === 0 || blinkPhase === 4) eyeH = 16;
  else if (blinkPhase === 1 || blinkPhase === 3) eyeH = 8;
  else if (blinkPhase === 2) eyeH = 3;

  switch (type) {
    case 0: // 1. Normal Blink (smooth eyelid blink + subtle breathing & gaze)
      {
        const yOff = Math.round((28 - eyeH) / 2);
        const gx = Math.round(Math.sin(t * 0.35) * 2.5);
        if (eyeH <= 4) {
          display.fillRect(26, 28, 28, 3, WHITE);
          display.fillRect(74, 28, 28, 3, WHITE);
        } else {
          display.fillRoundRect(26, 16 + bob + yOff, 28, eyeH, Math.min(8, Math.floor(eyeH / 2)), WHITE);
          display.fillRoundRect(74, 16 + bob + yOff, 28, eyeH, Math.min(8, Math.floor(eyeH / 2)), WHITE);
          if (eyeH >= 14) {
            display.fillCircle(35 + gx, 23 + bob + Math.round(yOff / 2), 3, BLACK);
            display.fillCircle(83 + gx, 23 + bob + Math.round(yOff / 2), 3, BLACK);
          }
        }
        display.drawRoundRect(56, 50 + Math.round(bob * 0.3), 16, 4, 2, WHITE);
      }
      break;

    case 1: // 2. Super Happy (smooth joyful bounce)
      {
        const bounce = Math.round(Math.sin(t * 1.4) * 2.5);
        display.fillCircle(40, 30 + bounce, 14, WHITE);
        display.fillCircle(40, 36 + bounce, 14, BLACK);
        display.fillCircle(88, 30 + bounce, 14, WHITE);
        display.fillCircle(88, 36 + bounce, 14, BLACK);
        display.fillCircle(64, 44 + Math.round(bounce * 0.4), 10, WHITE);
        display.fillRect(50, 32 + Math.round(bounce * 0.4), 28, 12, BLACK);
      }
      break;

    case 2: // 3. Cute Wink (smooth wink cycle)
      display.fillRoundRect(26, 16 + bob, 28, 28, 8, WHITE);
      display.fillCircle(34, 23 + bob, 3, BLACK);
      display.drawLine(74, 28 + bob, 88, 22 + bob, WHITE);
      display.drawLine(74, 28 + bob, 88, 34 + bob, WHITE);
      display.drawCircle(64, 46, 7, WHITE);
      display.fillRect(54, 38, 20, 8, BLACK);
      break;

    case 3: // 4. Freezing Cold (rapid smooth shiver)
      {
        const shiver = Math.round(Math.sin(frame * 1.9) * 2.2);
        display.drawRoundRect(26 + shiver, 18, 28, 24, 5, WHITE);
        display.drawRoundRect(74 + shiver, 18, 28, 24, 5, WHITE);
        display.fillCircle(40 + shiver, 30, 4, WHITE);
        display.fillCircle(88 + shiver, 30, 4, WHITE);
        for (let x = 44; x < 84; x += 8) {
          display.drawLine(x + shiver, 52, x + 4 + shiver, 48, WHITE);
          display.drawLine(x + 4 + shiver, 48, x + 8 + shiver, 52, WHITE);
        }
      }
      break;

    case 4: // 5. In Love (smooth heartbeat pulse)
      {
        const pulse = Math.round(10 + Math.sin(t * 1.8) * 2.2);
        drawHeart(display, 40, 22 + Math.round(bob * 0.4), pulse);
        drawHeart(display, 88, 22 + Math.round(bob * 0.4), pulse);
        display.drawCircle(64, 48, 8, WHITE);
        display.fillRect(54, 39, 20, 9, BLACK);
      }
      break;

    case 5: // 6. Angry (subtle intense pulse)
      {
        const throb = Math.round(Math.sin(t * 2.2) * 1.2);
        display.fillRoundRect(26, 20 + throb, 28, 22, 4, WHITE);
        display.fillRoundRect(74, 20 + throb, 28, 22, 4, WHITE);
        display.fillTriangle(24, 14 + throb, 56, 26 + throb, 56, 14 + throb, BLACK);
        display.fillTriangle(104, 14 + throb, 72, 26 + throb, 72, 14 + throb, BLACK);
        display.drawLine(50, 52, 78, 52, WHITE);
      }
      break;

    case 6: // 7. Surprised / Shocked
      {
        const pr = Math.round(5 + Math.sin(t * 2) * 1.4);
        display.drawCircle(40, 26, 14, WHITE);
        display.fillCircle(40, 26, pr, WHITE);
        display.drawCircle(88, 26, 14, WHITE);
        display.fillCircle(88, 26, pr, WHITE);
        display.drawCircle(64, 50, 7 + Math.round(Math.sin(t * 1.5)), WHITE);
      }
      break;

    case 7: // 8. Sleepy (smooth floating Zzz + slow breathing mouth)
      {
        const zOff = (frame * 0.35) % 10;
        const mR = 4 + Math.round(Math.sin(t * 0.6));
        display.drawLine(26, 30, 54, 30, WHITE);
        display.drawLine(74, 30, 102, 30, WHITE);
        display.drawCircle(64, 48, Math.max(3, mR), WHITE);
        display.setTextSize(1);
        display.setTextColor(WHITE);
        display.setCursor(96 + Math.round(Math.sin(t * 0.5) * 2), Math.round(16 - zOff));
        display.print('Zzz');
      }
      break;

    case 8: // 9. Cool Shades (smooth swagger glide)
      display.fillRect(20, 18 + bob, 38, 16, WHITE);
      display.fillRect(70, 18 + bob, 38, 16, WHITE);
      display.drawLine(58, 22 + bob, 70, 22 + bob, WHITE);
      display.drawLine(26, 22 + bob, 34, 30 + bob, BLACK);
      display.drawLine(76, 22 + bob, 84, 30 + bob, BLACK);
      display.drawLine(54, 50, 74, 46 + Math.round(bob * 0.4), WHITE);
      break;

    case 9: // 10. Sad Puppy
      display.fillRoundRect(26, 22 + Math.round(bob * 0.5), 28, 22, 6, WHITE);
      display.fillRoundRect(74, 22 + Math.round(bob * 0.5), 28, 22, 6, WHITE);
      display.fillTriangle(24, 18, 44, 18, 24, 28, BLACK);
      display.fillTriangle(104, 18, 84, 18, 104, 28, BLACK);
      display.drawCircle(64, 56, 10, WHITE);
      display.fillRect(50, 56, 28, 12, BLACK);
      break;

    case 10: // 11. Crying (continuous falling teardrops)
      {
        const tearL = Math.round((frame * 1.4) % 24);
        const tearR = Math.round((frame * 1.4 + 12) % 24);
        display.drawLine(26, 26, 54, 26, WHITE);
        display.drawLine(74, 26, 102, 26, WHITE);
        display.fillCircle(32, 30 + tearL, 2, WHITE);
        display.fillCircle(96, 30 + tearR, 2, WHITE);
        display.drawRoundRect(52, 46, 24, 10, 4, WHITE);
      }
      break;

    case 11: // 12. Dizzy (smooth concentric pulse)
      {
        const r = Math.round(7.5 + Math.sin(t * 2.2) * 3.5);
        display.drawCircle(40, 26, 12, WHITE);
        display.drawCircle(40, 26, Math.max(2, r), WHITE);
        display.drawCircle(88, 26, 12, WHITE);
        display.drawCircle(88, 26, Math.max(2, r), WHITE);
        display.drawLine(52, 50, 60, 46 + Math.round(bob * 0.5), WHITE);
        display.drawLine(60, 46 + Math.round(bob * 0.5), 68, 52, WHITE);
        display.drawLine(68, 52, 76, 48, WHITE);
      }
      break;

    case 12: // 13. Starry Eyed (smooth twinkling stars)
      {
        const sr = Math.round(10.5 + Math.sin(t * 2.1) * 2.2);
        drawStar(display, 40, 26 + Math.round(bob * 0.5), sr);
        drawStar(display, 88, 26 + Math.round(bob * 0.5), sr);
        display.fillCircle(64, 48, 8, WHITE);
        display.fillRect(54, 39, 20, 9, BLACK);
      }
      break;

    case 13: // 14. Skeptical
      display.fillRect(26, 24, 28, 10, WHITE);
      display.fillRoundRect(74, 16 + Math.round(bob * 0.5), 28, 26, 6, WHITE);
      display.drawLine(52, 50, 76, 48, WHITE);
      break;

    case 14: // 15. Cheeky Tongue
      {
        const tongueH = Math.round(10 + Math.sin(t * 1.8) * 2.5);
        display.fillRoundRect(26, 16 + Math.round(bob * 0.5), 28, 26, 8, WHITE);
        display.fillRoundRect(74, 16 + Math.round(bob * 0.5), 28, 26, 8, WHITE);
        display.drawLine(48, 46, 80, 46, WHITE);
        display.fillRoundRect(60, 46, 12, tongueH, 4, WHITE);
      }
      break;

    case 15: // 16. Kawaii Cat
      display.fillCircle(40, 26 + bob, 11, WHITE);
      display.fillCircle(36, 22 + bob, 3, BLACK);
      display.fillCircle(88, 26 + bob, 11, WHITE);
      display.fillCircle(84, 22 + bob, 3, BLACK);
      display.drawCircle(58, 48, 6, WHITE);
      display.drawCircle(70, 48, 6, WHITE);
      display.fillRect(50, 40, 28, 8, BLACK);
      break;

    case 16: // 17. Knocked Out
      display.drawLine(30, 18, 50, 36, WHITE);
      display.drawLine(50, 18, 30, 36, WHITE);
      display.drawLine(78, 18, 98, 36, WHITE);
      display.drawLine(98, 18, 78, 36, WHITE);
      display.drawLine(52, 50, 76, 50, WHITE);
      break;

    case 17: // 18. Thinking (smooth upward pondering gaze)
      display.drawRoundRect(26, 18, 28, 24, 6, WHITE);
      display.fillCircle(44 + gentleDrift, 24, 5, WHITE);
      display.drawRoundRect(74, 18, 28, 24, 6, WHITE);
      display.fillCircle(92 + gentleDrift, 24, 5, WHITE);
      display.drawCircle(68, 50, 4, WHITE);
      break;

    case 18: // 19. Shy Blushing
      display.fillCircle(40, 26 + Math.round(bob * 0.5), 10, WHITE);
      display.fillCircle(88, 26 + Math.round(bob * 0.5), 10, WHITE);
      display.drawLine(22, 40, 26, 44, WHITE);
      display.drawLine(28, 40, 32, 44, WHITE);
      display.drawLine(96, 40, 100, 44, WHITE);
      display.drawLine(102, 40, 106, 44, WHITE);
      display.drawCircle(64, 48, 5, WHITE);
      display.fillRect(56, 42, 16, 6, BLACK);
      break;

    case 19: // 20. Angry Shout
      {
        const shoutH = Math.round(15 + Math.sin(t * 2.5) * 3);
        display.fillTriangle(26, 18, 54, 30, 26, 34, WHITE);
        display.fillTriangle(102, 18, 74, 30, 102, 34, WHITE);
        display.fillRoundRect(48, 41, 32, shoutH, 6, WHITE);
      }
      break;

    case 20: // 21. Cyclops Alien (smooth eye glide)
      {
        const cx = Math.round(Math.sin(t * 0.9) * 8);
        display.drawCircle(64, 26, 18, WHITE);
        display.fillCircle(64 + cx, 26, 7, WHITE);
        display.drawLine(50, 52, 78, 52, WHITE);
      }
      break;

    case 21: // 22. Money Eyes
      display.setTextSize(3);
      display.setTextColor(WHITE);
      display.setCursor(32, 16 + bob);
      display.print('$');
      display.setCursor(80, 16 + bob);
      display.print('$');
      display.drawCircle(64, 48, 8, WHITE);
      display.fillRect(54, 39, 20, 9, BLACK);
      break;

    case 22: // 23. Robot Scanning (smooth back-and-forth KITT sweep)
      {
        const scanX = Math.round((Math.sin(t * 1.4) + 1) * 11);
        display.drawRect(24, 18, 32, 20, WHITE);
        display.fillRect(26 + scanX, 20, 6, 16, WHITE);
        display.drawRect(72, 18, 32, 20, WHITE);
        display.fillRect(74 + scanX, 20, 6, 16, WHITE);
        display.drawRect(46, 48, 36, 6, WHITE);
      }
      break;

    case 23: // 24. Smug Proud
      display.fillRoundRect(26, 22 + Math.round(bob * 0.4), 28, 16, 4, WHITE);
      display.fillRoundRect(74, 22 + Math.round(bob * 0.4), 28, 16, 4, WHITE);
      display.drawLine(52, 48, 66, 50, WHITE);
      display.drawLine(66, 50, 78, 44, WHITE);
      break;

    case 24: // 25. Looking Around (silky smooth sinusoidal eye sweep)
    default:
      {
        const dir = Math.round(Math.sin(t * 0.8) * 7.5);
        display.drawRoundRect(24, 14, 30, 28, 8, WHITE);
        display.fillCircle(39 + dir, 28, 7, WHITE);
        display.drawRoundRect(74, 14, 30, 28, 8, WHITE);
        display.fillCircle(89 + dir, 28, 7, WHITE);
        display.drawLine(56, 50, 72, 50, WHITE);
      }
      break;
  }
}

export function getTimeGreeting(hour: number, userName: string): { line1: string; line2: string; faceId: number } {
  const safeName = (userName || 'Muhib').trim().slice(0, 12);
  if (hour >= 5 && hour < 12) {
    return { line1: 'Good Morning', line2: safeName, faceId: 1 };
  }
  if (hour >= 12 && hour < 17) {
    return { line1: 'Good Afternoon', line2: safeName, faceId: 0 };
  }
  if (hour >= 17 && hour < 21) {
    return { line1: 'Good Evening', line2: safeName, faceId: 18 };
  }
  return { line1: 'Good Night', line2: safeName, faceId: 7 };
}

export function drawWatchScreen(
  display: SSD1306Buffer,
  now: Date,
  settings: BotSettings,
  weather: WeatherData | null,
  location: LocationConfig,
  frame: number
) {
  display.clearDisplay();
  const h24 = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const hDisp = settings.use24HourClock
    ? String(h24).padStart(2, '0')
    : String(h24 % 12 || 12).padStart(2, '0');

  // Top status bar (0..15px aligns perfectly with Dual-Zone Yellow top bar)
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(2, 3);
  display.print(location.city.slice(0, 10));

  if (weather) {
    const tempStr = `${Math.round(weather.temperature)}°C`;
    display.setCursor(OLED_WIDTH - tempStr.length * 6 - 2, 3);
    display.print(tempStr);
  }
  display.drawFastHLine(0, 14, OLED_WIDTH, WHITE);

  // Main Watch Clock digits
  const colon = frame % 2 === 0 ? ':' : ' ';
  const timeMain = `${hDisp}${colon}${m}`;
  display.setTextSize(3);
  display.setCursor(settings.use24HourClock ? 18 : 8, 21);
  display.print(timeMain);

  // Seconds + AM/PM
  display.setTextSize(1);
  display.setCursor(102, 23);
  display.print(s);
  if (!settings.use24HourClock) {
    display.setCursor(102, 34);
    display.print(ampm);
  }

  // Bottom Date strip
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dateStr = `${days[now.getDay()]} ${String(now.getDate()).padStart(2, '0')} ${months[now.getMonth()]} ${now.getFullYear()}`;
  display.drawFastHLine(0, 50, OLED_WIDTH, WHITE);
  display.printCentered(dateStr, 54, 1, WHITE);
}

export function drawWeatherScreen(
  display: SSD1306Buffer,
  weather: WeatherData | null,
  location: LocationConfig,
  settings: BotSettings,
  frame: number
) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);

  if (!weather) {
    display.printCentered('SYNCING WEATHER', 20, 1, WHITE);
    display.printCentered(location.city.slice(0, 16), 34, 1, WHITE);
    return;
  }

  const isCold = weather.temperature <= settings.coldThresholdC;
  const isHot = weather.temperature >= settings.hotThresholdC;

  // If freezing cold, alternate between "Today is too cold!" banner + shivering face or split view
  if (isCold && frame % 8 >= 4) {
    drawFace(display, 3, frame); // Freezing Cold face
    display.fillRect(0, 0, OLED_WIDTH, 13, BLACK);
    display.printCentered('Today is too cold!', 2, 1, WHITE);
    display.drawFastHLine(0, 12, OLED_WIDTH, WHITE);
    return;
  }

  // Top bar: City + Altitude
  display.setCursor(2, 3);
  display.print(location.city.slice(0, 12));
  const altStr = `${Math.round(location.altitude || weather.elevation)}m`;
  display.setCursor(OLED_WIDTH - altStr.length * 6 - 2, 3);
  display.print(altStr);
  display.drawFastHLine(0, 14, OLED_WIDTH, WHITE);

  // Weather icon on left
  const cx = 22;
  const cy = 33;
  if (isCold) {
    // Snowflake icon
    drawStar(display, cx, cy, 9 + (frame % 2));
  } else if (weather.weatherCode >= 51) {
    // Rain cloud
    display.fillCircle(cx - 5, cy - 2, 6, WHITE);
    display.fillCircle(cx + 3, cy - 4, 7, WHITE);
    display.fillRect(cx - 10, cy - 2, 20, 6, WHITE);
    const drop = (frame % 3) * 2;
    display.drawLine(cx - 6, cy + 7 + drop, cx - 8, cy + 10 + drop, WHITE);
    display.drawLine(cx, cy + 7 + ((drop + 2) % 4), cx - 2, cy + 10 + ((drop + 2) % 4), WHITE);
    display.drawLine(cx + 6, cy + 7 + drop, cx + 4, cy + 10 + drop, WHITE);
  } else if (weather.weatherCode >= 1 && weather.weatherCode <= 3) {
    // Cloudy
    display.fillCircle(cx - 4, cy, 6, WHITE);
    display.fillCircle(cx + 4, cy - 2, 7, WHITE);
    display.fillRect(cx - 9, cy, 19, 6, WHITE);
  } else {
    // Sun
    display.fillCircle(cx, cy, 6, WHITE);
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4 + (frame % 4) * 0.1;
      display.drawLine(
        cx + Math.cos(ang) * 8,
        cy + Math.sin(ang) * 8,
        cx + Math.cos(ang) * 11,
        cy + Math.sin(ang) * 11,
        WHITE
      );
    }
  }

  // Temperature readout
  display.setTextSize(2);
  display.setCursor(46, 20);
  display.print(`${Math.round(weather.temperature)}°C`);

  display.setTextSize(1);
  display.setCursor(46, 39);
  display.print(`H:${Math.round(weather.humidity)}% W:${Math.round(weather.windSpeed)}k`);

  // Reaction / Condition Footer
  display.drawFastHLine(0, 50, OLED_WIDTH, WHITE);
  const footer = isCold
    ? 'Today is too cold!'
    : isHot
      ? 'Too hot! Stay cool'
      : weather.conditionLabel.slice(0, 20);
  display.printCentered(footer, 54, 1, WHITE);
}

export function drawGreetingScreen(
  display: SSD1306Buffer,
  now: Date,
  settings: BotSettings,
  frame: number
) {
  const { line1, line2, faceId } = getTimeGreeting(now.getHours(), settings.userName);
  // Show mini cute face on lower part or alternate
  if (frame % 10 < 5) {
    display.clearDisplay();
    display.drawRoundRect(2, 2, 124, 60, 6, WHITE);
    display.printCentered(line1, 16, 1, WHITE);
    display.printCentered(line2, 32, 2, WHITE);
    const sparkleX = frame % 2 === 0 ? 14 : 16;
    drawStar(display, sparkleX, 20, 3);
    drawStar(display, OLED_WIDTH - sparkleX, 20, 3);
  } else {
    drawFace(display, faceId, frame);
    display.fillRect(0, 0, OLED_WIDTH, 12, BLACK);
    display.printCentered(`${line1} ${line2}`.slice(0, 21), 2, 1, WHITE);
  }
}

export function drawProximityWakeScreen(
  display: SSD1306Buffer,
  settings: BotSettings,
  faceId: number,
  frame: number
) {
  if (frame % 6 < 3) {
    drawFace(display, faceId, frame);
    display.fillRect(0, 0, OLED_WIDTH, 13, BLACK);
    const greet = `${settings.wakeGreetingPrefix || 'Hi'} ${settings.userName || 'Muhib'}!`;
    display.printCentered(greet.slice(0, 20), 2, 1, WHITE);
    display.drawFastHLine(0, 12, OLED_WIDTH, WHITE);
  } else {
    display.clearDisplay();
    drawHeart(display, 20, 18, 7 + (frame % 2));
    drawHeart(display, 108, 18, 7 + (frame % 2));
    const greet = `${settings.wakeGreetingPrefix || 'Hi'} ${settings.userName || 'Muhib'}!`;
    display.printCentered(greet.slice(0, 10), 22, 2, WHITE);
    display.printCentered('I am awake!', 46, 1, WHITE);
  }
}

export function drawAlarmScreen(
  display: SSD1306Buffer,
  label: string,
  timeStr: string,
  frame: number
) {
  display.clearDisplay();
  const invert = frame % 2 === 0;
  if (invert) {
    display.fillRect(0, 0, OLED_WIDTH, 16, WHITE);
    display.printCentered('ALARM RINGING!', 4, 1, BLACK);
  } else {
    display.drawRect(0, 0, OLED_WIDTH, 16, WHITE);
    display.printCentered('ALARM RINGING!', 4, 1, WHITE);
  }
  display.printCentered(timeStr, 22, 2, WHITE);
  display.printCentered((label || 'Wake up!').slice(0, 20), 46, 1, WHITE);
}

export function drawCustomTextScreen(
  display: SSD1306Buffer,
  line1: string,
  line2: string,
  frame: number
) {
  display.clearDisplay();
  display.drawRoundRect(2, 2, 124, 60, 5, WHITE);
  const bob = frame % 2 === 0 ? 0 : 1;
  if (line2) {
    display.printCentered(line1.slice(0, 20), 16 + bob, 1, WHITE);
    display.printCentered(line2.slice(0, 10), 32 + bob, 2, WHITE);
  } else {
    const size = line1.length <= 10 ? 2 : 1;
    display.printCentered(line1.slice(0, size === 2 ? 10 : 20), size === 2 ? 24 + bob : 28 + bob, size, WHITE);
  }
}

/**
 * Draw Muhib Creation's signature 128x64 OLED Boot Logo (5s startup / new-day splash)
 * Mirrors the official FaceBot logo: bezel frame, clock, cloud, happy arched eyes, smile, AI waves & "muhib creation"
 */
export function drawBootLogoScreen(display: SSD1306Buffer, frame: number) {
  display.clearDisplay();
  const bounce = Math.round(Math.sin(frame * 0.28) * 1.4);

  // Outer sleek rounded screen bezel
  display.drawRoundRect(2, 1, 124, 51, 8, WHITE);

  // Top-left mini clock icon
  display.drawCircle(13, 10, 4, WHITE);
  display.drawLine(13, 10, 13, 8, WHITE);
  display.drawLine(13, 10, 15, 11, WHITE);

  // Top-right mini cloud icon
  display.drawCircle(112, 10, 3, WHITE);
  display.drawCircle(116, 9, 3, WHITE);
  display.drawFastHLine(110, 13, 8, WHITE);

  // Happy arched eyes (matches FaceBot logo)
  const drawArch = (cx: number, cy: number, r: number) => {
    for (let deg = 205; deg <= 335; deg += 4) {
      const rad = (deg * Math.PI) / 180;
      const x = Math.round(cx + Math.cos(rad) * r);
      const y = Math.round(cy + Math.sin(rad) * r);
      display.fillCircle(x, y, 1, WHITE);
    }
  };
  drawArch(44, 29 + bounce, 10);
  drawArch(84, 29 + bounce, 10);

  // Cute pixel blush dots
  display.drawPixel(27, 32 + bounce, WHITE);
  display.drawPixel(29, 32 + bounce, WHITE);
  display.drawPixel(99, 32 + bounce, WHITE);
  display.drawPixel(101, 32 + bounce, WHITE);

  // Smooth happy smile arc
  for (let deg = 25; deg <= 155; deg += 4) {
    const rad = (deg * Math.PI) / 180;
    const x = Math.round(64 + Math.cos(rad) * 11);
    const y = Math.round(33 + bounce + Math.sin(rad) * 7);
    display.fillCircle(x, y, 1, WHITE);
  }

  // Bottom-right mini "AI||" audio wave mark
  const waveH = 2 + (frame % 3);
  display.drawFastVLine(109, 41 - waveH, waveH * 2, WHITE);
  display.drawFastVLine(112, 39, 5, WHITE);
  display.drawFastVLine(115, 41 - (3 - (frame % 3)), (3 - (frame % 3)) * 2, WHITE);

  // Signature brand caption underneath bezel
  display.printCentered('muhib creation', 55, 1, WHITE);
}

/**
 * Generate a 128x64 static pixel array of the Boot Logo to push to ESP32 over Vercel Cloud
 */
export function generateBootLogoPixels(): number[] {
  const buf = new SSD1306Buffer();
  drawBootLogoScreen(buf, 0);
  return Array.from(buf.pixels);
}

/**
 * Pixel-art WiFi Connected / WiFi Disconnected Emoji Screen (shown for 10 seconds on network transitions)
 */
export function drawWifiStatusScreen(
  display: SSD1306Buffer,
  connected: boolean,
  frame: number
) {
  display.clearDisplay();
  display.drawRoundRect(2, 1, 124, 62, 6, WHITE);

  const cx = 64;
  const cy = 34;

  // Draw helper for concentric WiFi signal arcs (225°..315° upward)
  const drawWifiArc = (radius: number) => {
    for (let deg = 225; deg <= 315; deg += 3) {
      const rad = (deg * Math.PI) / 180;
      const x = Math.round(cx + Math.cos(rad) * radius);
      const y = Math.round(cy + Math.sin(rad) * radius);
      display.fillCircle(x, y, 1, WHITE);
    }
  };

  if (connected) {
    // Animated pulsing 3-bar WiFi icon (bars light up smoothly)
    const phase = Math.floor(frame / 5) % 4;
    display.fillCircle(cx, cy, 3, WHITE);
    if (phase >= 1) drawWifiArc(10);
    if (phase >= 2) drawWifiArc(17);
    if (phase >= 3 || frame % 12 < 9) drawWifiArc(24);

    // Cute tiny happy check-badge on top right
    display.drawCircle(108, 16, 7, WHITE);
    display.drawLine(104, 16, 107, 19, WHITE);
    display.drawLine(107, 19, 112, 13, WHITE);

    // Cute tiny smiling emoji on top left
    display.drawCircle(20, 16, 7, WHITE);
    display.drawPixel(18, 14, WHITE);
    display.drawPixel(22, 14, WHITE);
    display.drawLine(17, 18, 19, 20, WHITE);
    display.drawLine(19, 20, 21, 20, WHITE);
    display.drawLine(21, 20, 23, 18, WHITE);

    display.printCentered('WIFI CONNECTED', 42, 1, WHITE);
    display.printCentered('ONLINE & SYNCED', 52, 1, WHITE);
  } else {
    // Static WiFi arcs + bold diagonal slash (WiFi OFF emoji)
    display.fillCircle(cx, cy, 2, WHITE);
    drawWifiArc(10);
    drawWifiArc(17);
    drawWifiArc(24);

    // Clear a small gap along the diagonal so the slash stands out crisply
    for (let t = -22; t <= 22; t++) {
      display.drawPixel(cx + t, cy - 11 + Math.round(t * 0.72) - 2, BLACK);
      display.drawPixel(cx + t, cy - 11 + Math.round(t * 0.72) + 2, BLACK);
    }
    // Draw bold 2px slash across WiFi symbol
    display.drawLine(cx - 21, cy - 26, cx + 21, cy + 4, WHITE);
    display.drawLine(cx - 21, cy - 25, cx + 21, cy + 5, WHITE);

    // Cute blinking alert/sad emoji on top left
    if (frame % 16 < 12) {
      display.drawCircle(20, 16, 7, WHITE);
      display.drawPixel(18, 14, WHITE);
      display.drawPixel(22, 14, WHITE);
      display.drawLine(17, 20, 20, 18, WHITE);
      display.drawLine(20, 18, 23, 20, WHITE);
    }

    display.printCentered('WIFI OFF', 42, 1, WHITE);
    display.printCentered('AUTO MODE ACTIVE', 52, 1, WHITE);
  }
}

export function generateWifiStatusPixels(connected: boolean): number[] {
  const buf = new SSD1306Buffer();
  drawWifiStatusScreen(buf, connected, 15);
  return Array.from(buf.pixels);
}

/**
 * Smooth 1-Second User Focus Timer OLED Screen (computes exact remaining time with smooth progress bar)
 */
export function drawTimerScreen(
  display: SSD1306Buffer,
  label: string,
  remainingSec: number,
  totalSec: number,
  isPaused: boolean,
  frame: number,
  remainingFloatSec?: number
) {
  display.clearDisplay();
  display.drawRoundRect(1, 1, 126, 62, 5, WHITE);

  const safeRem = Math.max(0, Math.floor(remainingSec));
  const safeTotal = Math.max(1, totalSec || safeRem || 1);
  const mins = Math.floor(safeRem / 60);
  const secs = safeRem % 60;
  const colon = isPaused || Math.floor(frame / 12) % 2 === 0 ? ':' : ' ';
  const clockStr = `${String(mins).padStart(2, '0')}${colon}${String(secs).padStart(2, '0')}`;

  // Top header
  const header = `${(label || 'FOCUS').toUpperCase().slice(0, 10)}${isPaused ? ' PAUSED' : ' TIMER'}`;
  display.printCentered(header, 7, 1, WHITE);
  display.drawFastHLine(10, 17, 108, WHITE);

  // Large smooth countdown digits (size 3 = 18x21 per char -> 5 chars = 90px centered cleanly)
  display.printCentered(clockStr, 23, 3, WHITE);

  // Silky-smooth 24-FPS bottom progress bar using sub-second precision
  const barX = 12;
  const barY = 50;
  const barW = 104;
  const barH = 7;
  display.drawRoundRect(barX, barY, barW, barH, 2, WHITE);
  const smoothRem = remainingFloatSec !== undefined ? Math.max(0, remainingFloatSec) : safeRem;
  const progress = Math.max(0, Math.min(1, smoothRem / safeTotal));
  const fillW = Math.max(0, Math.round((barW - 4) * progress));
  if (fillW > 0) {
    display.fillRect(barX + 2, barY + 2, fillW, barH - 4, WHITE);
  }
}

export function renderScreenToBuffer(
  buffer: SSD1306Buffer,
  screen: ActiveScreenState,
  frame: number,
  now: Date,
  settings: BotSettings,
  weather: WeatherData | null,
  location: LocationConfig,
  customReactions: CustomReaction[],
  activeAlarm?: { time: string; label: string } | null,
  savedGifs?: SavedGifItem[]
) {
  if (screen.kind === 'alarm' && activeAlarm) {
    drawAlarmScreen(buffer, activeAlarm.label, activeAlarm.time, frame);
    return;
  }

  switch (screen.kind) {
    case 'boot-logo':
      drawBootLogoScreen(buffer, frame);
      break;
    case 'wifi-status':
      drawWifiStatusScreen(buffer, Boolean(screen.wifiConnected), frame);
      break;
    case 'timer': {
      const isPaused = screen.timerPausedSec !== undefined;
      const exactRemFloat = isPaused
        ? Math.max(0, screen.timerPausedSec ?? 0)
        : screen.timerEndAtMs
          ? Math.max(0, (screen.timerEndAtMs - Date.now()) / 1000)
          : 0;
      const remSec = isPaused ? Math.max(0, screen.timerPausedSec ?? 0) : Math.ceil(exactRemFloat);
      drawTimerScreen(
        buffer,
        screen.timerLabel || 'FOCUS',
        remSec,
        screen.timerTotalSec || Math.max(1, remSec),
        isPaused,
        frame,
        exactRemFloat
      );
      break;
    }
    case 'watch':
      drawWatchScreen(buffer, now, settings, weather, location, frame);
      break;
    case 'weather':
      drawWeatherScreen(buffer, weather, location, settings, frame);
      break;
    case 'greeting':
      drawGreetingScreen(buffer, now, settings, frame);
      break;
    case 'proximity-wake':
      drawProximityWakeScreen(buffer, settings, screen.faceId, frame);
      break;
    case 'custom-text':
      drawCustomTextScreen(buffer, screen.textLine1 || 'Hello!', screen.textLine2 || '', frame);
      break;
    case 'custom-bitmap': {
      buffer.clearDisplay();
      const reaction = customReactions.find((r) => r.id === screen.customReactionId);
      if (reaction && reaction.pixels.length === OLED_WIDTH * OLED_HEIGHT) {
        for (let i = 0; i < reaction.pixels.length; i++) {
          buffer.pixels[i] = reaction.pixels[i] ? 1 : 0;
        }
      } else {
        buffer.printCentered('No Drawing Yet', 26, 1, WHITE);
      }
      break;
    }
    case 'custom-gif': {
      buffer.clearDisplay();
      const gif = savedGifs?.find((g) => g.id === screen.activeGifId);
      if (gif && gif.framesHex.length > 0) {
        const delayMs = Math.max(30, gif.frameDelayMs || 100);
        const frameIdx = Math.floor((frame * 42) / delayMs) % gif.framesHex.length;
        const hex = gif.framesHex[frameIdx] || '';
        if (hex.length >= 2048) {
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
      } else {
        buffer.printCentered('No GIF Loaded', 26, 1, WHITE);
      }
      break;
    }
    case 'face':
    default:
      drawFace(buffer, screen.faceId, frame);
      break;
  }
}

/**
 * Paint 128x64 buffer onto an HTMLCanvasElement with realistic SSD1306 OLED phosphor colors
 */
export function paintBufferToCanvas(
  ctx: CanvasRenderingContext2D,
  buffer: SSD1306Buffer,
  scheme: OledColorScheme,
  scale = 3,
  showPixelGrid = true
) {
  const width = OLED_WIDTH * scale;
  const height = OLED_HEIGHT * scale;
  if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
    ctx.canvas.width = width;
    ctx.canvas.height = height;
  }

  // Deep matte OLED glass black
  ctx.fillStyle = '#05080F';
  ctx.fillRect(0, 0, width, height);

  const pixelGap = showPixelGrid && scale >= 3 ? 0.45 : 0;
  const drawSize = scale - pixelGap;

  for (let y = 0; y < OLED_HEIGHT; y++) {
    let onColor = '#E2F5FF'; // ice-blue
    if (scheme === 'white') {
      onColor = '#F8FAFC';
    } else if (scheme === 'dual-yellow-blue') {
      onColor = y < 16 ? '#FACC15' : '#38BDF8';
    } else {
      onColor = '#67E8F9';
    }

    ctx.fillStyle = onColor;
    const rowOffset = y * OLED_WIDTH;
    for (let x = 0; x < OLED_WIDTH; x++) {
      if (buffer.pixels[rowOffset + x]) {
        ctx.fillRect(x * scale, y * scale, drawSize, drawSize);
      }
    }
  }
}
