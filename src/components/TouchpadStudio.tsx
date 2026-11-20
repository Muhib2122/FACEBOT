import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Eraser,
  Heart,
  Pencil,
  Play,
  Save,
  Sparkles,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { CustomReaction, OledColorScheme, ServoMotionStyle } from '../types';
import {
  drawHeart,
  drawStar,
  OLED_HEIGHT,
  OLED_WIDTH,
  paintBufferToCanvas,
  SSD1306Buffer,
} from '../utils/oledRenderer';
import { pixelsToCppProgmem } from '../utils/firmwareGenerator';

interface TouchpadStudioProps {
  oledScheme: OledColorScheme;
  customReactions: CustomReaction[];
  onSaveReaction: (reaction: CustomReaction) => void;
  onDeleteReaction: (id: string) => void;
  onDisplayReaction: (reaction: CustomReaction) => void;
  onPushLivePixels: (pixels: number[]) => void;
}

export const TouchpadStudio: React.FC<TouchpadStudioProps> = ({
  oledScheme,
  customReactions,
  onSaveReaction,
  onDeleteReaction,
  onDisplayReaction,
  onPushLivePixels,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<SSD1306Buffer>(new SSD1306Buffer());
  const historyRef = useRef<Uint8Array[]>([]);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [tool, setTool] = useState<'draw' | 'erase'>('draw');
  const [brushSize, setBrushSize] = useState<1 | 2 | 3>(2);
  const [reactionName, setReactionName] = useState('');
  const [servoStyle, setServoStyle] = useState<ServoMotionStyle>('happy-sway');
  const [stampText, setStampText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintBufferToCanvas(ctx, bufferRef.current, oledScheme, 4, true);
  }, [oledScheme]);

  useEffect(() => {
    repaint();
  }, [repaint, renderTick]);

  const pushHistory = () => {
    historyRef.current.push(new Uint8Array(bufferRef.current.pixels));
    if (historyRef.current.length > 20) historyRef.current.shift();
  };

  const getPixelCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * OLED_WIDTH);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * OLED_HEIGHT);
    return {
      x: Math.max(0, Math.min(OLED_WIDTH - 1, x)),
      y: Math.max(0, Math.min(OLED_HEIGHT - 1, y)),
    };
  };

  const paintBrush = (cx: number, cy: number, color: number) => {
    const buf = bufferRef.current;
    if (brushSize === 1) {
      buf.drawPixel(cx, cy, color);
    } else {
      buf.fillCircle(cx, cy, brushSize - 1, color);
    }
  };

  const paintStroke = (x0: number, y0: number, x1: number, y1: number, color: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      paintBrush(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), color);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pushHistory();
    isDrawingRef.current = true;
    const pt = getPixelCoords(e);
    lastPointRef.current = pt;
    paintBrush(pt.x, pt.y, tool === 'draw' ? 1 : 0);
    repaint();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const pt = getPixelCoords(e);
    const prev = lastPointRef.current || pt;
    paintStroke(prev.x, prev.y, pt.x, pt.y, tool === 'draw' ? 1 : 0);
    lastPointRef.current = pt;
    repaint();
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleUndo = () => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    bufferRef.current.pixels.set(prev);
    setRenderTick((t) => t + 1);
  };

  const handleClear = () => {
    pushHistory();
    bufferRef.current.clearDisplay();
    setRenderTick((t) => t + 1);
  };

  const handleInvert = () => {
    pushHistory();
    const px = bufferRef.current.pixels;
    for (let i = 0; i < px.length; i++) {
      px[i] = px[i] ? 0 : 1;
    }
    setRenderTick((t) => t + 1);
  };

  const handleStampText = () => {
    if (!stampText.trim()) return;
    pushHistory();
    const text = stampText.trim();
    const size = text.length <= 10 ? 2 : 1;
    bufferRef.current.printCentered(text, size === 2 ? 24 : 28, size, 1);
    setRenderTick((t) => t + 1);
  };

  const handleStampPreset = (preset: 'hearts' | 'stars') => {
    pushHistory();
    const buf = bufferRef.current;
    if (preset === 'hearts') {
      drawHeart(buf, 40, 24, 10);
      drawHeart(buf, 88, 24, 10);
    } else {
      drawStar(buf, 40, 26, 10);
      drawStar(buf, 88, 26, 10);
    }
    setRenderTick((t) => t + 1);
  };

  const handleSave = () => {
    const name = reactionName.trim() || `Custom Face ${customReactions.length + 1}`;
    const reaction: CustomReaction = {
      id: `cr-${Date.now()}`,
      name,
      createdAt: Date.now(),
      pixels: Array.from(bufferRef.current.pixels),
      servoStyle,
    };
    onSaveReaction(reaction);
    onDisplayReaction(reaction);
    setReactionName('');
  };

  const handleLoadIntoCanvas = (reaction: CustomReaction) => {
    pushHistory();
    bufferRef.current.pixels.set(reaction.pixels);
    setReactionName(reaction.name);
    setServoStyle(reaction.servoStyle);
    setRenderTick((t) => t + 1);
  };

  const handleCopyProgmem = (reaction: CustomReaction) => {
    const code = pixelsToCppProgmem(
      reaction.pixels,
      reaction.name.replace(/[^a-zA-Z0-9]/g, '_') || 'customFace'
    );
    navigator.clipboard?.writeText(code);
    setCopiedId(reaction.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              128×64 OLED Touchpad &amp; Custom Reaction Maker
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Draw or write directly on the touch surface with finger or mouse, then send to your ESP32 OLED
            </p>
          </div>
          <button
            onClick={() => onPushLivePixels(Array.from(bufferRef.current.pixels))}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            Show on OLED Now
          </button>
        </div>

        {/* Drawing Toolbar */}
        <div className="flex flex-wrap items-center gap-2 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setTool('draw')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tool === 'draw' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
              Draw
            </button>
            <button
              onClick={() => setTool('erase')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tool === 'erase' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Eraser className="w-3.5 h-3.5" />
              Erase
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {([1, 2, 3] as const).map((sz) => (
              <button
                key={sz}
                onClick={() => setBrushSize(sz)}
                className={`px-2.5 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
                  brushSize === sz ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {sz}px
              </button>
            ))}
          </div>

          <button
            onClick={() => handleStampPreset('hearts')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <Heart className="w-3.5 h-3.5" />
            Hearts
          </button>
          <button
            onClick={() => handleStampPreset('stars')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Stars
          </button>
          <button
            onClick={handleInvert}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            Invert
          </button>
          <button
            onClick={handleUndo}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </button>
          <button
            onClick={handleClear}
            className="px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
          >
            Clear
          </button>
        </div>

        {/* Interactive 128x64 Touchpad Canvas */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5">
          <div className="lg:col-span-8">
            <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
              <canvas
                ref={canvasRef}
                width={512}
                height={256}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="oled-canvas w-full h-auto block rounded-md cursor-crosshair touch-none"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Native 128×64 1-bit pixel matrix · Touch and drag supported on phone, tablet, and desktop
            </p>
          </div>

          {/* Right Side: Stamp Text & Save Custom Reaction */}
          <div className="lg:col-span-4 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                Write Text onto Touchpad
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={18}
                  value={stampText}
                  onChange={(e) => setStampText(e.target.value)}
                  placeholder="e.g. HI MUHIB!"
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <button
                  onClick={handleStampText}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                >
                  <Type className="w-3.5 h-3.5" />
                  Stamp
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h4 className="text-xs font-semibold text-slate-900">
                Save as Custom Reaction
              </h4>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  Reaction Name
                </label>
                <input
                  type="text"
                  value={reactionName}
                  onChange={(e) => setReactionName(e.target.value)}
                  placeholder="e.g. My Signature Smile"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  Paired Servo Head Motion
                </label>
                <select
                  value={servoStyle}
                  onChange={(e) => setServoStyle(e.target.value as ServoMotionStyle)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="happy-sway">Happy Sway (70° ↔ 110°)</option>
                  <option value="surprised-tilt">Surprised Tilt</option>
                  <option value="angry-shake">Rapid Shake</option>
                  <option value="sleepy-droop">Sleepy Tilt</option>
                  <option value="look-around">Look Around</option>
                  <option value="center">Center (90°)</option>
                </select>
              </div>
              <button
                onClick={handleSave}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                Save Reaction &amp; Display
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Saved Custom Reactions Library */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          Saved Custom Reactions ({customReactions.length})
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Display saved drawings on the OLED, reload into touchpad, or copy the C++ PROGMEM bitmap
        </p>

        {customReactions.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 mt-3 border border-dashed border-slate-200 rounded-lg">
            No custom drawings saved yet. Sketch something on the touchpad above and click Save.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {customReactions.map((reaction) => (
              <SavedReactionCard
                key={reaction.id}
                reaction={reaction}
                scheme={oledScheme}
                copied={copiedId === reaction.id}
                onDisplay={() => onDisplayReaction(reaction)}
                onEdit={() => handleLoadIntoCanvas(reaction)}
                onCopyCpp={() => handleCopyProgmem(reaction)}
                onDelete={() => onDeleteReaction(reaction.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface SavedReactionCardProps {
  reaction: CustomReaction;
  scheme: OledColorScheme;
  copied: boolean;
  onDisplay: () => void;
  onEdit: () => void;
  onCopyCpp: () => void;
  onDelete: () => void;
}

const SavedReactionCard: React.FC<SavedReactionCardProps> = ({
  reaction,
  scheme,
  copied,
  onDisplay,
  onEdit,
  onCopyCpp,
  onDelete,
}) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = new SSD1306Buffer();
    buf.pixels.set(reaction.pixels);
    paintBufferToCanvas(ctx, buf, scheme, 2, false);
  }, [reaction, scheme]);

  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <canvas
        ref={ref}
        width={256}
        height={128}
        className="oled-canvas w-full h-auto rounded-md bg-[#05080F] block"
      />
      <div className="flex items-center justify-between gap-2 mt-2.5">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-900 truncate">
            {reaction.name}
          </div>
          <div className="text-[11px] text-slate-500 capitalize">
            {reaction.servoStyle.replace('-', ' ')}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onDisplay}
            title="Show on OLED"
            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onEdit}
            title="Load into Touchpad"
            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onCopyCpp}
            title="Copy PROGMEM C++ Array"
            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Code2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {copied && (
        <div className="flex items-center gap-1 text-[11px] text-emerald-700 mt-1.5">
          <Copy className="w-3 h-3" />
          PROGMEM C++ bitmap copied
        </div>
      )}
    </div>
  );
};
