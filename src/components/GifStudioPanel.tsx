import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  FileCode2,
  Film,
  Images,
  Pause,
  Play,
  Sliders,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { OledColorScheme, SavedGifItem } from '../types';
import {
  decodeGifToOledFrames,
  framesHexToBinaryBlob,
  packedFramesToBinaryBlob,
  writeHex2048ToBuffer,
  writePackedBytesToBuffer,
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

type GifSubPanelTab = 'upload' | 'gallery';

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
  const [activeSubPanel, setActiveSubPanel] = useState<GifSubPanelTab>('upload');
  const [galleryStatusMsg, setGalleryStatusMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [uploadingToEspId, setUploadingToEspId] = useState<string | null>(null);

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
      setGalleryStatusMsg({
        ok: false,
        text: 'Add your ESP32 Local IP in WiFi & Hardware to upload .bin directly to LittleFS, or use Play on Bot for Vercel Cloud streaming.',
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
      setGalleryStatusMsg({
        ok: true,
        text: `Dispatched "${gif.name}.bin" (${gif.framesHex.length * 1024} bytes) to ESP32 LittleFS at ${base}.`,
      });
    } catch {
      setGalleryStatusMsg({
        ok: false,
        text: `Could not reach ${ip}/upload_gif. Ensure your browser and ESP32 share the same WiFi.`,
      });
    } finally {
      setUploadingToEspId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Studio Header & Sub-Panel Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Film className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              128×64 OLED Animated GIF Studio
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Decode <span className="font-mono text-slate-700">.gif</span> files with{' '}
              <span className="font-mono text-slate-700">omggif</span>, pack into 1024-byte ESP32
              frames, and manage your bot gallery
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="GIF Studio sub-panels"
            className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200/80"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeSubPanel === 'upload'}
              onClick={() => setActiveSubPanel('upload')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                activeSubPanel === 'upload'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              GIF Upload
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSubPanel === 'gallery'}
              onClick={() => setActiveSubPanel('gallery')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                activeSubPanel === 'gallery'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Images className="w-3.5 h-3.5" />
              Saved Gallery
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                ({savedGifs.length})
              </span>
            </button>
          </div>

          {activeGifId && (
            <button
              type="button"
              onClick={onStopGif}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100/70 rounded-lg transition-colors whitespace-nowrap"
            >
              <Square className="w-3 h-3 fill-current" />
              Stop Active GIF
            </button>
          )}
        </div>
      </div>

      {/* Sub-Panel 1: Dedicated GIF Upload & 1024-Byte Packer */}
      {activeSubPanel === 'upload' && (
        <GifUploadSubPanel
          oledScheme={oledScheme}
          savedCount={savedGifs.length}
          esp32Ip={esp32Ip}
          onSaveGif={onSaveGif}
          onPlayGif={onPlayGif}
          onOpenGallery={() => setActiveSubPanel('gallery')}
        />
      )}

      {/* Sub-Panel 2: Saved GIF Gallery (Max 30) */}
      {activeSubPanel === 'gallery' && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Saved GIF Gallery ({savedGifs.length} / {MAX_SAVED_GIFS})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {cloudSyncEnabled
                  ? 'Press Play on Bot to animate on the OLED and auto-stream frames to your ESP32 via Vercel Cloud'
                  : esp32Ip.trim()
                    ? `Ready to stream frames or push .bin files directly to ESP32 (${esp32Ip.trim()})`
                    : 'Press Play on Bot to animate on the Live OLED Display'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSubPanel('upload')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload New .GIF
            </button>
          </div>

          {galleryStatusMsg && (
            <div
              className={`mt-4 px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${
                galleryStatusMsg.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {galleryStatusMsg.ok && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
              <span>{galleryStatusMsg.text}</span>
            </div>
          )}

          {savedGifs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 mt-4 border border-dashed border-slate-200 rounded-lg">
              No GIFs saved yet. Open the <span className="font-semibold text-slate-700">GIF Upload</span>{' '}
              sub-panel to decode and save a <span className="font-mono">.gif</span> animation.
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
      )}
    </div>
  );
};

interface GifUploadSubPanelProps {
  oledScheme: OledColorScheme;
  savedCount: number;
  esp32Ip: string;
  onSaveGif: (gif: SavedGifItem) => void;
  onPlayGif: (gif: SavedGifItem, speedOverrideMs?: number) => void;
  onOpenGallery: () => void;
}

const GifUploadSubPanel: React.FC<GifUploadSubPanelProps> = ({
  oledScheme,
  savedCount,
  esp32Ip,
  onSaveGif,
  onPlayGif,
  onOpenGallery,
}) => {
  const [rawBuffer, setRawBuffer] = useState<ArrayBuffer | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [sourceFileBytes, setSourceFileBytes] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  const [gifName, setGifName] = useState('');
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'fill'>('contain');
  const [maxFrames, setMaxFrames] = useState(24);
  const [speedMs, setSpeedMs] = useState(100);

  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewFrameIdx, setPreviewFrameIdx] = useState(0);
  const [packedFrames, setPackedFrames] = useState<Uint8Array[]>([]);
  const [extractedFramesHex, setExtractedFramesHex] = useState<string[]>([]);
  const [sourceMeta, setSourceMeta] = useState<{
    originalFrames: number;
    width: number;
    height: number;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadingDirect, setUploadingDirect] = useState(false);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewBufRef = useRef<SSD1306Buffer>(new SSD1306Buffer());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Decode via omggif, resize to 128x64, and pack into 1024-byte frames whenever source or parameters change
  useEffect(() => {
    if (!rawBuffer) return;
    try {
      const decoded = decodeGifToOledFrames(rawBuffer, {
        threshold,
        invert,
        fitMode,
        maxFrames,
      });
      setPackedFrames(decoded.packedFrames);
      setExtractedFramesHex(decoded.framesHex);
      setSourceMeta({
        originalFrames: decoded.originalFrameCount,
        width: decoded.width,
        height: decoded.height,
      });
      setPreviewFrameIdx(0);
      setStatusMsg({
        ok: true,
        text: `Decoded ${decoded.packedFrames.length} frame(s) via omggif → resized to 128×64 and packed into ${(decoded.packedFrames.length * 1024).toLocaleString()} bytes (1,024 B/frame).`,
      });
    } catch (err) {
      setPackedFrames([]);
      setExtractedFramesHex([]);
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Could not decode GIF file.',
      });
    }
  }, [rawBuffer, threshold, invert, fitMode, maxFrames]);

  // Animate preview canvas frames at selected speed
  useEffect(() => {
    if (packedFrames.length <= 1 || !previewPlaying) return;
    const delay = Math.max(30, Math.min(1000, speedMs));
    const timer = window.setInterval(() => {
      setPreviewFrameIdx((idx) => (idx + 1) % packedFrames.length);
    }, delay);
    return () => window.clearInterval(timer);
  }, [packedFrames.length, previewPlaying, speedMs]);

  // Paint current 1024-byte packed Uint8Array directly onto the 128x64 OLED preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = previewBufRef.current;
    if (packedFrames.length > 0) {
      const safeIdx = previewFrameIdx % packedFrames.length;
      writePackedBytesToBuffer(packedFrames[safeIdx], buf);
    } else {
      buf.clearDisplay();
      buf.printCentered('GIF UPLOAD', 18, 1, 1);
      buf.printCentered('DROP OR CHOOSE .GIF', 32, 1, 1);
      buf.printCentered('128x64 · 1024B/FRAME', 46, 1, 1);
    }
    paintBufferToCanvas(ctx, buf, oledScheme, 3, true);
  }, [packedFrames, previewFrameIdx, oledScheme]);

  const loadGifFile = async (file: File) => {
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
      setSourceFileName(file.name);
      setSourceFileBytes(file.size);
      setGifName(cleanName || `gif_${Date.now().toString().slice(-4)}`);

      // Quick pass to pick the GIF's native frame speed
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

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      await loadGifFile(file);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await loadGifFile(file);
    }
  };

  const handleClearFile = () => {
    setRawBuffer(null);
    setSourceFileName('');
    setSourceFileBytes(0);
    setGifName('');
    setPackedFrames([]);
    setExtractedFramesHex([]);
    setSourceMeta(null);
    setPreviewFrameIdx(0);
    setStatusMsg(null);
  };

  const handleSaveAndPlay = () => {
    if (extractedFramesHex.length === 0) {
      setStatusMsg({ ok: false, text: 'Upload a .gif file first before saving.' });
      return;
    }
    if (savedCount >= MAX_SAVED_GIFS) {
      setStatusMsg({
        ok: false,
        text: `Gallery limit reached (${MAX_SAVED_GIFS} GIFs). Delete an older GIF in Saved Gallery first.`,
      });
      return;
    }
    const cleanName =
      gifName
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 15) || `gif_${savedCount + 1}`;

    const newItem: SavedGifItem = {
      id: `gif-${Date.now()}`,
      name: cleanName,
      frameDelayMs: Math.max(30, Math.min(1000, speedMs)),
      framesHex: extractedFramesHex,
      threshold,
      inverted: invert,
      createdAt: Date.now(),
    };
    onSaveGif(newItem);
    onPlayGif(newItem, newItem.frameDelayMs);
    setStatusMsg({
      ok: true,
      text: `Saved "${cleanName}" (${newItem.framesHex.length} × 1,024 B) to Gallery and started live OLED playback!`,
    });
  };

  const handleDownloadPackedBin = () => {
    if (packedFrames.length === 0) return;
    const blob = packedFramesToBinaryBlob(packedFrames);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(gifName || 'facebot').replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDirectEsp32Upload = async () => {
    const ip = esp32Ip.trim();
    if (!ip || packedFrames.length === 0) return;
    const cleanName =
      gifName
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 15) || 'facebot_gif';
    setUploadingDirect(true);
    try {
      const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
      const blob = packedFramesToBinaryBlob(packedFrames);
      const formData = new FormData();
      formData.append('file', blob, `${cleanName}.bin`);
      await fetch(`${base}/upload_gif`, {
        method: 'POST',
        mode: 'no-cors',
        body: formData,
      });
      await fetch(
        `${base}/play_gif?name=${encodeURIComponent(`${cleanName}.bin`)}&speed=${speedMs}`,
        { mode: 'no-cors' }
      );
      setStatusMsg({
        ok: true,
        text: `Uploaded "${cleanName}.bin" (${(packedFrames.length * 1024).toLocaleString()} bytes) directly to ESP32 at ${base}.`,
      });
    } catch {
      setStatusMsg({
        ok: false,
        text: `Could not reach ${ip}/upload_gif. Check local WiFi or use Save & Play on Bot for Vercel Cloud sync.`,
      });
    } finally {
      setUploadingDirect(false);
    }
  };

  const safeFrameIdx = packedFrames.length > 0 ? previewFrameIdx % packedFrames.length : 0;
  const activePackedFrame = packedFrames[safeFrameIdx] ?? null;
  const activeFrameHexPreview = activePackedFrame
    ? Array.from(activePackedFrame.slice(0, 10))
        .map((b) => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`)
        .join(' ')
    : '';
  const totalPackedBytes = packedFrames.length * 1024;

  return (
    <section
      aria-label="GIF Upload"
      className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6 space-y-5"
    >
      {/* Sub-Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">GIF Upload</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload a <span className="font-mono text-slate-700">.gif</span> file to decode frames
            with <span className="font-mono text-slate-700">omggif</span>, resize to{' '}
            <span className="font-mono text-slate-700">128×64</span>, and pack into{' '}
            <span className="font-mono text-slate-700">1,024-byte</span> ESP32 OLED frames
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rawBuffer && (
            <button
              type="button"
              onClick={handleClearFile}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            {rawBuffer ? 'Replace .GIF' : 'Select .GIF File'}
          </button>
        </div>
      </div>

      {/* Hidden File Input + Drag-and-Drop Upload Zone */}
      <input
        ref={fileInputRef}
        id="gif-upload-file-input"
        type="file"
        accept="image/gif,.gif"
        onChange={handleFileInputChange}
        className="hidden"
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`border-2 border-dashed rounded-xl px-4 py-4 transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-3 ${
          isDragging
            ? 'border-blue-500 bg-blue-50/70'
            : rawBuffer
              ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300'
              : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              rawBuffer ? 'bg-emerald-100 text-emerald-700' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            <Upload className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {sourceFileName || 'Drop an animated .gif file here, or click to browse'}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
              {sourceMeta
                ? `${(sourceFileBytes / 1024).toFixed(1)} KB source · ${sourceMeta.width}×${sourceMeta.height} (${sourceMeta.originalFrames} frames) → ${packedFrames.length} × 1,024 B packed`
                : 'Supports animated .gif · Auto-resized to 128×64 monochrome (1024 bytes per frame)'}
            </div>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-blue-600 shrink-0">
          {rawBuffer ? 'Change file' : 'Browse .gif'}
        </span>
      </div>

      {/* Main Two-Column Preview + 1024-Byte Packer Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Live 128x64 OLED Preview Canvas & Frame Inspector */}
        <div className="lg:col-span-6 space-y-3">
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2.5">
              <span>128×64 OLED PREVIEW (1024B PACKED)</span>
              <span className="tabular-nums">
                {packedFrames.length > 0
                  ? `FRAME ${safeFrameIdx + 1}/${packedFrames.length} · ${packedFrames.length} KB`
                  : 'NO GIF LOADED'}
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

            {/* Frame Scrubber & Transport Controls */}
            {packedFrames.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewPlaying((p) => !p)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-md"
                    >
                      {previewPlaying ? (
                        <>
                          <Pause className="w-3 h-3" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          Play
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewPlaying(false);
                        setPreviewFrameIdx((idx) =>
                          (idx - 1 + packedFrames.length) % packedFrames.length
                        );
                      }}
                      title="Previous frame"
                      className="p-1.5 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewPlaying(false);
                        setPreviewFrameIdx((idx) => (idx + 1) % packedFrames.length);
                      }}
                      title="Next frame"
                      className="p-1.5 text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {speedMs} ms/frame · {(1000 / Math.max(30, speedMs)).toFixed(1)} FPS
                  </span>
                </div>

                {packedFrames.length > 1 && (
                  <input
                    type="range"
                    min={0}
                    max={packedFrames.length - 1}
                    value={safeFrameIdx}
                    onChange={(e) => {
                      setPreviewPlaying(false);
                      setPreviewFrameIdx(Number(e.target.value));
                    }}
                    aria-label="Inspect decoded GIF frame"
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                )}
              </div>
            )}
          </div>

          {/* 1024-Byte ESP32 Firmware Format Verification Strip */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                <FileCode2 className="w-3.5 h-3.5 text-blue-600" />
                ESP32 1024-Byte Firmware Payload
              </span>
              <span className="font-mono text-slate-500 tabular-nums">
                SSD1306 1-bit MSB
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-white border border-slate-200 rounded-lg py-1.5 px-2">
                <div className="text-[10px] text-slate-400">Bytes / Frame</div>
                <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                  {activePackedFrame ? activePackedFrame.byteLength.toLocaleString() : '1,024'} B
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg py-1.5 px-2">
                <div className="text-[10px] text-slate-400">Packed Frames</div>
                <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                  {packedFrames.length}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg py-1.5 px-2">
                <div className="text-[10px] text-slate-400">Binary Size</div>
                <div className="text-xs font-mono font-semibold text-blue-600 tabular-nums">
                  {totalPackedBytes.toLocaleString()} B
                </div>
              </div>
            </div>
            {activeFrameHexPreview && (
              <div className="text-[10px] font-mono text-slate-500 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 truncate">
                Frame #{safeFrameIdx + 1} header bytes: {activeFrameHexPreview} …
              </div>
            )}
          </div>
        </div>

        {/* Right: Packing Options & Upload Actions */}
        <div className="lg:col-span-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="gif-upload-name"
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                GIF Name (max 15 chars)
              </label>
              <input
                id="gif-upload-name"
                type="text"
                maxLength={15}
                value={gifName}
                onChange={(e) => setGifName(e.target.value)}
                placeholder="e.g. cute_cat"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>

            <div>
              <label
                htmlFor="gif-upload-speed"
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                Frame Speed (ms/frame)
              </label>
              <input
                id="gif-upload-speed"
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

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={packedFrames.length === 0}
              onClick={handleSaveAndPlay}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              Save &amp; Play on Bot
            </button>
            <button
              type="button"
              disabled={packedFrames.length === 0}
              onClick={handleDownloadPackedBin}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
              title="Download packed 1024-byte/frame .bin file for ESP32 firmware"
            >
              <Download className="w-3.5 h-3.5" />
              Download .bin
            </button>
            {esp32Ip.trim() && (
              <button
                type="button"
                disabled={packedFrames.length === 0 || uploadingDirect}
                onClick={() => void handleDirectEsp32Upload()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100/70 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
                title="Upload packed 1024-byte/frame .bin directly to ESP32 LittleFS (/upload_gif)"
              >
                <Cpu className="w-3.5 h-3.5" />
                {uploadingDirect ? 'Uploading…' : 'Push to ESP32'}
              </button>
            )}
          </div>

          {statusMsg && (
            <div
              className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                statusMsg.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {statusMsg.ok && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                <span>{statusMsg.text}</span>
              </div>
              {statusMsg.ok && statusMsg.text.startsWith('Saved ') && (
                <button
                  type="button"
                  onClick={onOpenGallery}
                  className="text-emerald-900 font-semibold underline shrink-0"
                >
                  View Gallery
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
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
              {gif.framesHex.length} frames · {(gif.framesHex.length * 1024).toLocaleString()} B
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
