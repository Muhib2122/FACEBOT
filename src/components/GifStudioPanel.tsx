import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  Film,
  Pause,
  Play,
  Sliders,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { OledColorScheme, SavedGifItem } from '../types';
import {
  decodeGifToOledFrames,
  framesHexToBinaryBlob,
  writeHex2048ToBuffer,
} from '../utils/gifOledCodec';
import { paintBufferToCanvas, SSD1306Buffer } from '../utils/oledRenderer';

interface GifStudioPanelProps {
  oledScheme: OledColorScheme;
  savedGifs: SavedGifItem[];
  activeGifId: string | null;
  cloudSyncEnabled: boolean;
  esp32Ip: string;
  onSaveGif: (gif: SavedGifItem) => void;
  onDeleteGif: (id: string) => void;
  onPlayGif: (gif: SavedGifItem, speedOverrideMs?: number) => void;
  onStopGif: () => void;
  onUpdateGifSpeed: (id: string, frameDelayMs: number) => void;
}

const MAX_SAVED_GIFS = 30;

export const GifStudioPanel: React.FC<GifStudioPanelProps> = ({
  oledScheme,
  savedGifs,
  activeGifId,
  cloudSyncEnabled,
  esp32Ip,
  onSaveGif,
  onDeleteGif,
  onPlayGif,
  onStopGif,
  onUpdateGifSpeed,
}) => {
  const [rawBuffer, setRawBuffer] = useState<ArrayBuffer | null>(null);
  const [gifName, setGifName] = useState('');
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'fill'>('contain');
  const [maxFrames, setMaxFrames] = useState(24);
  const [speedMs, setSpeedMs] = useState(100);
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewFrameIdx, setPreviewFrameIdx] = useState(0);
  const [extractedFrames, setExtractedFrames] = useState<string[]>([]);
  const [sourceMeta, setSourceMeta] = useState<{
    originalFrames: number;
    width: number;
    height: number;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadingToEspId, setUploadingToEspId] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewBufRef = useRef<SSD1306Buffer>(new SSD1306Buffer());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-decode GIF whenever rawBuffer or conversion parameters change
  useEffect(() => {
    if (!rawBuffer) return;
    try {
      const decoded = decodeGifToOledFrames(rawBuffer, {
        threshold,
        invert,
        fitMode,
        maxFrames,
      });
      setExtractedFrames(decoded.framesHex);
      setSourceMeta({
        originalFrames: decoded.originalFrameCount,
        width: decoded.width,
        height: decoded.height,
      });
      setPreviewFrameIdx(0);
      setStatusMsg({
        ok: true,
        text: `Ready: ${decoded.framesHex.length} frames (${decoded.framesHex.length} KB · 128×64 monochrome) from ${decoded.width}×${decoded.height} GIF.`,
      });
    } catch (err) {
      setExtractedFrames([]);
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Could not decode GIF file.',
      });
    }
  }, [rawBuffer, threshold, invert, fitMode, maxFrames]);

  // Animate live 128x64 OLED preview canvas
  useEffect(() => {
    if (extractedFrames.length === 0 || !previewPlaying) return;
    const delay = Math.max(30, Math.min(1000, speedMs));
    const timer = window.setInterval(() => {
      setPreviewFrameIdx((idx) => (idx + 1) % extractedFrames.length);
    }, delay);
    return () => window.clearInterval(timer);
  }, [extractedFrames.length, previewPlaying, speedMs]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = previewBufRef.current;
    if (extractedFrames.length > 0) {
      const hex = extractedFrames[previewFrameIdx % extractedFrames.length];
      writeHex2048ToBuffer(hex, buf);
    } else {
      buf.clearDisplay();
      buf.printCentered('SELECT A GIF', 22, 1, 1);
      buf.printCentered('128x64 OLED STUDIO', 36, 1, 1);
    }
    paintBufferToCanvas(ctx, buf, oledScheme, 3, true);
  }, [extractedFrames, previewFrameIdx, oledScheme]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) {
      setStatusMsg({ ok: false, text: 'Please select a valid animated .gif image file.' });
      return;
    }

    try {
      const ab = await file.arrayBuffer();
      const cleanName = file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 15);
      setGifName(cleanName || `gif_${Date.now().toString().slice(-4)}`);
      const quickDecode = decodeGifToOledFrames(ab, {
        threshold,
        invert,
        fitMode,
        maxFrames,
      });
      setSpeedMs(quickDecode.recommendedDelayMs);
      setRawBuffer(ab);
      setPreviewPlaying(true);
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to read selected GIF file.',
      });
    }
  };

  const handleSaveAndPlay = () => {
    if (extractedFrames.length === 0) {
      setStatusMsg({ ok: false, text: 'Select a .gif file first before saving.' });
      return;
    }
    if (savedGifs.length >= MAX_SAVED_GIFS) {
      setStatusMsg({
        ok: false,
        text: `Gallery limit reached (${MAX_SAVED_GIFS} GIFs). Delete an older GIF to save a new one.`,
      });
      return;
    }
    const cleanName =
      gifName
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 15) || `gif_${savedGifs.length + 1}`;

    const newItem: SavedGifItem = {
      id: `gif-${Date.now()}`,
      name: cleanName,
      frameDelayMs: Math.max(30, Math.min(1000, speedMs)),
      framesHex: extractedFrames,
      createdAt: Date.now(),
    };
    onSaveGif(newItem);
    onPlayGif(newItem, newItem.frameDelayMs);
    setStatusMsg({
      ok: true,
      text: `Saved "${cleanName}" (${newItem.framesHex.length} frames) to Gallery and started live OLED playback!`,
    });
  };

  const handleDownloadBin = (name: string, framesHex: string[]) => {
    if (framesHex.length === 0) return;
    const blob = framesHexToBinaryBlob(framesHex);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'facebot'}.bin`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Optional direct LittleFS upload compatible with ESP32 /upload_gif + /play_gif routes
  const handlePushBinToEsp32LittleFs = async (gif: SavedGifItem) => {
    const ip = esp32Ip.trim();
    if (!ip) {
      setStatusMsg({
        ok: false,
        text: 'Add your ESP32 Local IP in WiFi & Hardware to upload .bin directly to LittleFS, or use Play Now for Vercel Cloud streaming.',
      });
      return;
    }
    setUploadingToEspId(gif.id);
    try {
      const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
      const blob = framesHexToBinaryBlob(gif.framesHex);
      const formData = new FormData();
      formData.append('file', blob, `${gif.name}.bin`);
      await fetch(`${base}/upload_gif`, {
        method: 'POST',
        mode: 'no-cors',
        body: formData,
      });
      await fetch(
        `${base}/play_gif?name=${encodeURIComponent(`${gif.name}.bin`)}&speed=${gif.frameDelayMs}`,
        { mode: 'no-cors' }
      );
      setStatusMsg({
        ok: true,
        text: `Dispatched "${gif.name}.bin" (${gif.framesHex.length} KB) to ESP32 LittleFS at ${base}.`,
      });
    } catch {
      setStatusMsg({
        ok: false,
        text: `Could not reach ${ip}/upload_gif. Ensure your browser and ESP32 share the same WiFi.`,
      });
    } finally {
      setUploadingToEspId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Animated GIF Uploader & 128x64 Monochrome Converter */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-blue-600 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                128×64 OLED Animated GIF Studio
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload any animated <span className="font-mono text-slate-700">.gif</span>, convert to 1-bit 1024-byte OLED frames, and stream live to your ESP32
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/gif,.gif"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              Choose .GIF File
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5 items-start">
          {/* Left: Live 128x64 Monochrome OLED Preview */}
          <div className="lg:col-span-6 space-y-3">
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2.5">
                <span>128×64 SSD1306 PREVIEW</span>
                <span className="tabular-nums">
                  {extractedFrames.length > 0
                    ? `FRAME ${(previewFrameIdx % extractedFrames.length) + 1}/${extractedFrames.length} · ${extractedFrames.length} KB`
                    : 'WAITING FOR GIF'}
                </span>
              </div>
              <div className="bg-[#05080F] p-2 rounded-lg border border-slate-800">
                <canvas
                  ref={previewCanvasRef}
                  width={384}
                  height={192}
                  className="oled-canvas w-full h-auto block rounded-xs"
                />
              </div>
            </div>

            {extractedFrames.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <button
                  type="button"
                  onClick={() => setPreviewPlaying((p) => !p)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
                >
                  {previewPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      Pause Preview
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      Play Preview
                    </>
                  )}
                </button>
                {sourceMeta && (
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    Source: {sourceMeta.width}×{sourceMeta.height} ({sourceMeta.originalFrames}f) → 128×64 ({extractedFrames.length}f)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right: Conversion Parameters & Save Controls */}
          <div className="lg:col-span-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  GIF Name (max 15 chars)
                </label>
                <input
                  type="text"
                  maxLength={15}
                  value={gifName}
                  onChange={(e) => setGifName(e.target.value)}
                  placeholder="e.g. cute_cat"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Frame Speed (ms/frame)
                </label>
                <input
                  type="number"
                  min={30}
                  max={1000}
                  step={10}
                  value={speedMs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setSpeedMs(Math.max(30, Math.min(1000, v)));
                  }}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    <Sliders className="w-3.5 h-3.5 text-slate-400" />
                    Brightness Threshold
                  </span>
                  <span className="font-mono font-semibold text-blue-600 tabular-nums">
                    {threshold}
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={245}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full hw-slider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700">Max Frames (ESP32 Memory Cap)</span>
                  <span className="font-mono font-semibold text-slate-800 tabular-nums">
                    {maxFrames} frames ({maxFrames} KB)
                  </span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={30}
                  value={maxFrames}
                  onChange={(e) => setMaxFrames(Number(e.target.value))}
                  className="w-full hw-slider"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setFitMode('contain')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    fitMode === 'contain' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Keep Ratio
                </button>
                <button
                  type="button"
                  onClick={() => setFitMode('fill')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    fitMode === 'fill' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  Stretch 128×64
                </button>
              </div>

              <button
                type="button"
                onClick={() => setInvert((v) => !v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  invert
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {invert ? 'Inverted: ON' : 'Invert Pixels'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={extractedFrames.length === 0}
                onClick={handleSaveAndPlay}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                Save to Gallery &amp; Play on Bot
              </button>
              <button
                type="button"
                disabled={extractedFrames.length === 0}
                onClick={() => handleDownloadBin(gifName || 'facebot', extractedFrames)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
                title="Download 1024-byte/frame binary file for ESP32 LittleFS"
              >
                <Download className="w-3.5 h-3.5" />
                .bin
              </button>
            </div>

            {statusMsg && (
              <div
                className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${
                  statusMsg.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {statusMsg.ok && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                <span>{statusMsg.text}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Section 2: Saved GIF Gallery (Max 30) */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Saved GIF Gallery ({savedGifs.length} / {MAX_SAVED_GIFS})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {cloudSyncEnabled
                ? 'Press Play to animate on the portal OLED and auto-stream frames to your ESP32 via Vercel Cloud (zero re-upload needed)'
                : esp32Ip.trim()
                  ? `Ready to stream frames or push .bin files directly to ESP32 (${esp32Ip.trim()})`
                  : 'Press Play to animate on the Live OLED Display'}
            </p>
          </div>
          {activeGifId && (
            <button
              type="button"
              onClick={onStopGif}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100/70 rounded-lg transition-colors whitespace-nowrap"
            >
              <Square className="w-3 h-3 fill-current" />
              Stop Active GIF
            </button>
          )}
        </div>

        {savedGifs.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 mt-4 border border-dashed border-slate-200 rounded-lg">
            No GIFs saved yet. Choose any <span className="font-mono">.gif</span> file above to preview and add it to your gallery.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
            {savedGifs.map((gif) => (
              <GifGalleryCard
                key={gif.id}
                gif={gif}
                scheme={oledScheme}
                isPlayingOnBot={activeGifId === gif.id}
                hasLocalIp={Boolean(esp32Ip.trim())}
                isUploadingEsp={uploadingToEspId === gif.id}
                onPlay={() => onPlayGif(gif)}
                onStop={onStopGif}
                onChangeSpeed={(ms) => onUpdateGifSpeed(gif.id, ms)}
                onDownloadBin={() => handleDownloadBin(gif.name, gif.framesHex)}
                onPushLittleFs={() => void handlePushBinToEsp32LittleFs(gif)}
                onDelete={() => onDeleteGif(gif.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

interface GifGalleryCardProps {
  gif: SavedGifItem;
  scheme: OledColorScheme;
  isPlayingOnBot: boolean;
  hasLocalIp: boolean;
  isUploadingEsp: boolean;
  onPlay: () => void;
  onStop: () => void;
  onChangeSpeed: (ms: number) => void;
  onDownloadBin: () => void;
  onPushLittleFs: () => void;
  onDelete: () => void;
}

const GifGalleryCard: React.FC<GifGalleryCardProps> = ({
  gif,
  scheme,
  isPlayingOnBot,
  hasLocalIp,
  isUploadingEsp,
  onPlay,
  onStop,
  onChangeSpeed,
  onDownloadBin,
  onPushLittleFs,
  onDelete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufRef = useRef<SSD1306Buffer>(new SSD1306Buffer());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (gif.framesHex.length <= 1) return;
    const delay = Math.max(40, Math.min(1000, gif.frameDelayMs || 100));
    const timer = window.setInterval(() => {
      setTick((t) => (t + 1) % gif.framesHex.length);
    }, delay);
    return () => window.clearInterval(timer);
  }, [gif.framesHex.length, gif.frameDelayMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const hex = gif.framesHex[tick % Math.max(1, gif.framesHex.length)] || '';
    writeHex2048ToBuffer(hex, bufRef.current);
    paintBufferToCanvas(ctx, bufRef.current, scheme, 2, false);
  }, [gif.framesHex, tick, scheme]);

  return (
    <div
      className={`border rounded-xl p-3.5 flex flex-col justify-between gap-3 transition-colors ${
        isPlayingOnBot
          ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600/20'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div>
        <div className="bg-[#05080F] p-1.5 rounded-lg border border-slate-800">
          <canvas
            ref={canvasRef}
            width={256}
            height={128}
            className="oled-canvas w-full h-auto block rounded-xs"
          />
        </div>

        <div className="flex items-start justify-between gap-2 mt-2.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 font-mono truncate">
              {gif.name}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              {gif.framesHex.length} frames · {gif.framesHex.length} KB
              {isPlayingOnBot ? ' · PLAYING' : ''}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <input
              type="number"
              min={30}
              max={1000}
              step={10}
              value={gif.frameDelayMs}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onChangeSpeed(Math.max(30, Math.min(1000, v)));
              }}
              title="Frame delay (ms)"
              aria-label={`Speed for ${gif.name}`}
              className="w-14 px-1.5 py-1 text-[11px] font-mono border border-slate-200 rounded bg-white text-right tabular-nums"
            />
            <span className="text-[10px] text-slate-400 font-mono">ms</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
        {isPlayingOnBot ? (
          <button
            type="button"
            onClick={onStop}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onPlay}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Play className="w-3 h-3 fill-current" />
            Play on Bot
          </button>
        )}

        <button
          type="button"
          onClick={onDownloadBin}
          title="Download 1024-byte/frame .bin"
          className="p-1.5 text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        {hasLocalIp && (
          <button
            type="button"
            disabled={isUploadingEsp}
            onClick={onPushLittleFs}
            title="Upload .bin directly to ESP32 LittleFS (/upload_gif)"
            className="p-1.5 text-blue-600 border border-blue-200 hover:bg-blue-50 disabled:opacity-50 rounded-lg"
          >
            <Cpu className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={onDelete}
          title="Delete GIF"
          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
