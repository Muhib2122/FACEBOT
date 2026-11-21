import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  FileArchive,
  FileCode2,
  Film,
  Images,
  Loader2,
  LogIn,
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
  isSignedIn: boolean;
  onSignIn: () => void;
  onSaveGif: (gif: SavedGifItem) => Promise<void> | void;
  onSaveMultipleGifs: (gifs: SavedGifItem[]) => Promise<void> | void;
  onDeleteGif: (id: string) => void;
  onPlayGif: (gif: SavedGifItem, speedOverrideMs?: number) => void;
  onStopGif: () => void;
  onUpdateGifSpeed: (id: string, frameDelayMs: number) => void;
}

type GifSubPanelTab = 'upload' | 'gallery';

interface QueuedGifSource {
  id: string;
  fileName: string;
  cleanName: string;
  sizeBytes: number;
  buffer: ArrayBuffer;
  defaultDelayMs: number;
  width: number;
  height: number;
  originalFrames: number;
  packedFrames: Uint8Array[];
  framesHex: string[];
}

const MAX_SAVED_GIFS = 60;

function sanitizeGifLabel(fileName: string, fallbackIndex: number): string {
  const base = fileName.split('/').pop() || fileName;
  const cleaned = base
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  return cleaned || `gif_${fallbackIndex}`;
}

export const GifStudioPanel: React.FC<GifStudioPanelProps> = ({
  oledScheme,
  savedGifs,
  activeGifId,
  cloudSyncEnabled,
  isSignedIn,
  onSignIn,
  onSaveGif,
  onSaveMultipleGifs,
  onDeleteGif,
  onPlayGif,
  onStopGif,
  onUpdateGifSpeed,
}) => {
  const [activeSubPanel, setActiveSubPanel] = useState<GifSubPanelTab>('upload');

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
              Upload <span className="font-mono text-slate-700">.gif</span> or{' '}
              <span className="font-mono text-slate-700">.zip</span> packs — permanently stored in{' '}
              <span className="font-medium text-slate-700">Google Firestore</span> (not on ESP32 flash)
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
              Firestore Gallery
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

      {/* Firestore Permanent Storage Banner */}
      {isSignedIn ? (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Google Firestore Permanent Storage Active:</strong> All uploaded{' '}
              <span className="font-mono">.gif</span> &amp; <span className="font-mono">.zip</span>{' '}
              animations are saved permanently in your Firestore cloud account (zero ESP32 flash
              used) and can be deleted anytime.
            </span>
          </div>
          <span className="font-mono text-[11px] text-emerald-700 shrink-0 tabular-nums">
            {savedGifs.length} / {MAX_SAVED_GIFS} stored
          </span>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Sign in with Google so your uploaded <span className="font-mono">.gif</span> and{' '}
              <span className="font-mono">.zip</span> files are stored permanently in{' '}
              <strong>Google Firestore</strong> across all devices.
            </span>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign in with Google
          </button>
        </div>
      )}

      {/* Sub-Panel 1: Dedicated GIF & ZIP Upload + Real-Time 128x64 Preview & 1024-Byte Packer */}
      {activeSubPanel === 'upload' && (
        <GifUploadSubPanel
          oledScheme={oledScheme}
          savedCount={savedGifs.length}
          isSignedIn={isSignedIn}
          onSaveGif={onSaveGif}
          onSaveMultipleGifs={onSaveMultipleGifs}
          onPlayGif={onPlayGif}
          onOpenGallery={() => setActiveSubPanel('gallery')}
        />
      )}

      {/* Sub-Panel 2: Permanent Firestore GIF Gallery */}
      {activeSubPanel === 'gallery' && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Permanent Firestore GIF Gallery ({savedGifs.length} / {MAX_SAVED_GIFS})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {cloudSyncEnabled
                  ? 'Stored permanently in Google Firestore — press Play on Bot to stream live frames to your ESP32 via Vercel Cloud, or delete anytime.'
                  : 'Stored permanently in Google Firestore — press Play on Bot to preview on the Live OLED Display, or delete anytime.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSubPanel('upload')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload .GIF / .ZIP
            </button>
          </div>

          {savedGifs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 mt-4 border border-dashed border-slate-200 rounded-lg">
              No GIFs saved in Firestore yet. Open the{' '}
              <span className="font-semibold text-slate-700">GIF Upload</span> sub-panel to upload a{' '}
              <span className="font-mono">.gif</span> or <span className="font-mono">.zip</span>{' '}
              pack.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
              {savedGifs.map((gif) => (
                <GifGalleryCard
                  key={gif.id}
                  gif={gif}
                  scheme={oledScheme}
                  isPlayingOnBot={activeGifId === gif.id}
                  onPlay={() => onPlayGif(gif)}
                  onStop={onStopGif}
                  onChangeSpeed={(ms) => onUpdateGifSpeed(gif.id, ms)}
                  onDownloadBin={() => handleDownloadBin(gif.name, gif.framesHex)}
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
  isSignedIn: boolean;
  onSaveGif: (gif: SavedGifItem) => Promise<void> | void;
  onSaveMultipleGifs: (gifs: SavedGifItem[]) => Promise<void> | void;
  onPlayGif: (gif: SavedGifItem, speedOverrideMs?: number) => void;
  onOpenGallery: () => void;
}

const GifUploadSubPanel: React.FC<GifUploadSubPanelProps> = ({
  oledScheme,
  savedCount,
  isSignedIn,
  onSaveGif,
  onSaveMultipleGifs,
  onPlayGif,
  onOpenGallery,
}) => {
  const [queue, setQueue] = useState<QueuedGifSource[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [zipArchiveName, setZipArchiveName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [gifName, setGifName] = useState('');
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'fill'>('contain');
  const [maxFrames, setMaxFrames] = useState(24);
  const [speedMs, setSpeedMs] = useState(100);

  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewFrameIdx, setPreviewFrameIdx] = useState(0);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewBufRef = useRef<SSD1306Buffer>(new SSD1306Buffer());
  const gifFileInputRef = useRef<HTMLInputElement | null>(null);
  const zipFileInputRef = useRef<HTMLInputElement | null>(null);

  const activeItem =
    queue.find((item) => item.id === selectedQueueId) ?? queue[0] ?? null;

  // Re-decode all queued GIF buffers via omggif whenever packing options change
  useEffect(() => {
    if (queue.length === 0) return;
    setQueue((prev) =>
      prev.map((item) => {
        try {
          const decoded = decodeGifToOledFrames(item.buffer, {
            threshold,
            invert,
            fitMode,
            maxFrames,
          });
          return {
            ...item,
            width: decoded.width,
            height: decoded.height,
            originalFrames: decoded.originalFrameCount,
            packedFrames: decoded.packedFrames,
            framesHex: decoded.framesHex,
          };
        } catch {
          return item;
        }
      })
    );
    setPreviewFrameIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, invert, fitMode, maxFrames]);

  // Keep name & speed input synced when user switches between items in a ZIP pack
  useEffect(() => {
    if (!activeItem) return;
    setGifName(activeItem.cleanName);
    setSpeedMs(activeItem.defaultDelayMs);
    setPreviewFrameIdx(0);
  }, [activeItem?.id]);

  // Real-time playback animation for the active preview item
  const activePackedFrames = activeItem?.packedFrames ?? [];
  useEffect(() => {
    if (activePackedFrames.length <= 1 || !previewPlaying) return;
    const delay = Math.max(30, Math.min(1000, speedMs));
    const timer = window.setInterval(() => {
      setPreviewFrameIdx((idx) => (idx + 1) % activePackedFrames.length);
    }, delay);
    return () => window.clearInterval(timer);
  }, [activePackedFrames.length, previewPlaying, speedMs]);

  // Render the exact 1024-byte packed Uint8Array onto the real-time 128x64 OLED preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = previewBufRef.current;
    if (activePackedFrames.length > 0) {
      const safeIdx = previewFrameIdx % activePackedFrames.length;
      writePackedBytesToBuffer(activePackedFrames[safeIdx], buf);
    } else {
      buf.clearDisplay();
      buf.printCentered('GIF / ZIP UPLOAD', 18, 1, 1);
      buf.printCentered('128x64 REAL-TIME', 32, 1, 1);
      buf.printCentered('1024-BYTE PACKER', 46, 1, 1);
    }
    paintBufferToCanvas(ctx, buf, oledScheme, 3, true);
  }, [activePackedFrames, previewFrameIdx, oledScheme]);

  const decodeSingleBuffer = (
    buffer: ArrayBuffer,
    fileName: string,
    sizeBytes: number,
    index: number
  ): QueuedGifSource => {
    const decoded = decodeGifToOledFrames(buffer, {
      threshold,
      invert,
      fitMode,
      maxFrames,
    });
    return {
      id: `q-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      fileName,
      cleanName: sanitizeGifLabel(fileName, index + 1),
      sizeBytes,
      buffer,
      defaultDelayMs: decoded.recommendedDelayMs,
      width: decoded.width,
      height: decoded.height,
      originalFrames: decoded.originalFrameCount,
      packedFrames: decoded.packedFrames,
      framesHex: decoded.framesHex,
    };
  };

  const handleLoadSingleGif = async (file: File) => {
    if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) {
      setStatusMsg({ ok: false, text: 'Please select a valid .gif file (or use Upload .ZIP Pack).' });
      return;
    }
    setIsProcessing(true);
    setZipArchiveName(null);
    try {
      const ab = await file.arrayBuffer();
      const item = decodeSingleBuffer(ab, file.name, file.size, 0);
      setQueue([item]);
      setSelectedQueueId(item.id);
      setGifName(item.cleanName);
      setSpeedMs(item.defaultDelayMs);
      setPreviewPlaying(true);
      setStatusMsg({
        ok: true,
        text: `Decoded "${file.name}" via omggif → ${item.packedFrames.length} frame(s) packed into ${(item.packedFrames.length * 1024).toLocaleString()} bytes (1,024 B/frame).`,
      });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to decode GIF file.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadZipFile = async (file: File) => {
    if (
      !file.name.toLowerCase().endsWith('.zip') &&
      !file.type.includes('zip')
    ) {
      setStatusMsg({ ok: false, text: 'Please select a valid .zip archive containing .gif files.' });
      return;
    }

    setIsProcessing(true);
    try {
      const ab = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(ab);
      const gifEntries = Object.values(zip.files).filter((entry) => {
        if (entry.dir) return false;
        const lower = entry.name.toLowerCase();
        if (lower.startsWith('__macosx/') || lower.includes('/__macosx/')) return false;
        const baseName = entry.name.split('/').pop() || '';
        if (baseName.startsWith('.')) return false;
        return lower.endsWith('.gif');
      });

      if (gifEntries.length === 0) {
        setStatusMsg({
          ok: false,
          text: `No .gif files found inside "${file.name}". Please upload a .zip containing animated .gif images.`,
        });
        return;
      }

      const limit = Math.min(gifEntries.length, 30);
      const decodedItems: QueuedGifSource[] = [];
      let failedCount = 0;

      for (let i = 0; i < limit; i++) {
        const entry = gifEntries[i];
        try {
          const entryBuf = await entry.async('arraybuffer');
          const item = decodeSingleBuffer(entryBuf, entry.name, entryBuf.byteLength, i);
          decodedItems.push(item);
        } catch {
          failedCount += 1;
        }
      }

      if (decodedItems.length === 0) {
        setStatusMsg({
          ok: false,
          text: `Could not decode any .gif files inside "${file.name}".`,
        });
        return;
      }

      setZipArchiveName(file.name);
      setQueue(decodedItems);
      setSelectedQueueId(decodedItems[0].id);
      setGifName(decodedItems[0].cleanName);
      setSpeedMs(decodedItems[0].defaultDelayMs);
      setPreviewPlaying(true);

      const totalBytes = decodedItems.reduce((sum, g) => sum + g.packedFrames.length * 1024, 0);
      setStatusMsg({
        ok: true,
        text: `Extracted ${decodedItems.length} GIF(s) from "${file.name}" (${totalBytes.toLocaleString()} B packed)${failedCount > 0 ? ` · ${failedCount} skipped` : ''}. Click any item to preview or save all to Firestore.`,
      });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to extract .zip archive.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGifInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await handleLoadSingleGif(file);
  };

  const handleZipInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await handleLoadZipFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')) {
      await handleLoadZipFile(file);
    } else {
      await handleLoadSingleGif(file);
    }
  };

  const handleClearQueue = () => {
    setQueue([]);
    setSelectedQueueId(null);
    setZipArchiveName(null);
    setGifName('');
    setPreviewFrameIdx(0);
    setStatusMsg(null);
  };

  const handleRemoveFromQueue = (id: string) => {
    setQueue((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (selectedQueueId === id) {
        setSelectedQueueId(next[0]?.id ?? null);
      }
      if (next.length === 0) {
        setZipArchiveName(null);
        setGifName('');
      }
      return next;
    });
  };

  const handleSaveCurrentToFirestore = async () => {
    if (!activeItem || activeItem.framesHex.length === 0) {
      setStatusMsg({ ok: false, text: 'Upload a .gif or .zip file first before saving.' });
      return;
    }
    if (savedCount >= MAX_SAVED_GIFS) {
      setStatusMsg({
        ok: false,
        text: `Gallery limit reached (${MAX_SAVED_GIFS} GIFs). Delete an older GIF in Firestore Gallery first.`,
      });
      return;
    }

    const cleanName =
      gifName
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 20) || activeItem.cleanName;

    const newItem: SavedGifItem = {
      id: `gif-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: cleanName,
      frameDelayMs: Math.max(30, Math.min(1000, speedMs)),
      framesHex: activeItem.framesHex,
      threshold,
      inverted: invert,
      createdAt: Date.now(),
    };

    setIsSaving(true);
    try {
      await onSaveGif(newItem);
      onPlayGif(newItem, newItem.frameDelayMs);
      setStatusMsg({
        ok: true,
        text: isSignedIn
          ? `Saved "${cleanName}" (${newItem.framesHex.length} × 1,024 B) permanently to Google Firestore and started live OLED playback!`
          : `Saved "${cleanName}" locally and started playback. Sign in with Google to persist permanently in Firestore.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAllZipToFirestore = async () => {
    if (queue.length === 0) return;
    const remainingSlots = Math.max(0, MAX_SAVED_GIFS - savedCount);
    if (remainingSlots === 0) {
      setStatusMsg({
        ok: false,
        text: `Gallery limit reached (${MAX_SAVED_GIFS} GIFs). Delete older GIFs first.`,
      });
      return;
    }

    const batch = queue.slice(0, remainingSlots);
    const nowMs = Date.now();
    const itemsToSave: SavedGifItem[] = batch.map((item, idx) => ({
      id: `gif-${nowMs + idx}-${Math.random().toString(36).slice(2, 5)}`,
      name:
        item.id === activeItem?.id && gifName.trim()
          ? gifName.trim().replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20)
          : item.cleanName,
      frameDelayMs:
        item.id === activeItem?.id
          ? Math.max(30, Math.min(1000, speedMs))
          : Math.max(30, Math.min(1000, item.defaultDelayMs)),
      framesHex: item.framesHex,
      threshold,
      inverted: invert,
      createdAt: nowMs + idx,
    }));

    setIsSaving(true);
    try {
      await onSaveMultipleGifs(itemsToSave);
      if (itemsToSave[0]) {
        onPlayGif(itemsToSave[0], itemsToSave[0].frameDelayMs);
      }
      setStatusMsg({
        ok: true,
        text: isSignedIn
          ? `Saved all ${itemsToSave.length} GIF(s) permanently to Google Firestore! You can play or delete any of them anytime.`
          : `Saved ${itemsToSave.length} GIF(s) locally. Sign in with Google to sync them permanently to Firestore.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadPackedBin = () => {
    if (!activeItem || activeItem.packedFrames.length === 0) return;
    const blob = packedFramesToBinaryBlob(activeItem.packedFrames);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(gifName || activeItem.cleanName || 'facebot').replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const safeFrameIdx =
    activePackedFrames.length > 0 ? previewFrameIdx % activePackedFrames.length : 0;
  const activeFrameBytes = activePackedFrames[safeFrameIdx] ?? null;
  const activeFrameHexPreview = activeFrameBytes
    ? Array.from(activeFrameBytes.slice(0, 10))
        .map((b) => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`)
        .join(' ')
    : '';
  const totalPackedBytes = activePackedFrames.length * 1024;

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
            Upload a single <span className="font-mono text-slate-700">.gif</span> or a{' '}
            <span className="font-mono text-slate-700">.zip</span> archive — decoded via{' '}
            <span className="font-mono text-slate-700">omggif</span>, resized to{' '}
            <span className="font-mono text-slate-700">128×64</span>, packed into{' '}
            <span className="font-mono text-slate-700">1,024-byte</span> frames &amp; stored in
            Firestore
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {queue.length > 0 && (
            <button
              type="button"
              onClick={handleClearQueue}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => gifFileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Select .GIF
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => zipFileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileArchive className="w-3.5 h-3.5 text-blue-600" />
            Upload .ZIP Pack
          </button>
        </div>
      </div>

      {/* Explicit <input type="file" accept=".gif"> + <input type="file" accept=".zip"> */}
      <input
        ref={gifFileInputRef}
        id="gif-upload-file-input"
        type="file"
        accept=".gif"
        onChange={handleGifInputChange}
        className="hidden"
      />
      <input
        ref={zipFileInputRef}
        id="zip-upload-file-input"
        type="file"
        accept=".zip,application/zip"
        onChange={handleZipInputChange}
        className="hidden"
      />

      {/* Drag & Drop Upload Zone for both .gif and .zip */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => gifFileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            gifFileInputRef.current?.click();
          }
        }}
        className={`border-2 border-dashed rounded-xl px-4 py-4 transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-3 ${
          isDragging
            ? 'border-blue-500 bg-blue-50/70'
            : queue.length > 0
              ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300'
              : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              queue.length > 0
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : zipArchiveName ? (
              <FileArchive className="w-4 h-4" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {isProcessing
                ? 'Decoding & packing 128×64 frames…'
                : zipArchiveName
                  ? `${zipArchiveName} · ${queue.length} GIF(s) extracted`
                  : activeItem
                    ? activeItem.fileName
                    : 'Drop a .gif or .zip pack here, or click to select a .gif file'}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
              {activeItem
                ? `${(activeItem.sizeBytes / 1024).toFixed(1)} KB source · ${activeItem.width}×${activeItem.height} (${activeItem.originalFrames}f) → ${activeItem.packedFrames.length} × 1,024 B packed`
                : 'Accepts .gif (single) or .zip (batch GIF pack) · Stored permanently in Google Firestore'}
            </div>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-blue-600 shrink-0">
          {queue.length > 0 ? 'Replace file' : 'Browse .gif'}
        </span>
      </div>

      {/* ZIP Pack Batch Queue Selector (shown when multiple GIFs are extracted from a .zip) */}
      {queue.length > 1 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <FileArchive className="w-4 h-4 text-blue-600" />
              <span>
                Extracted GIFs from ZIP ({queue.length} ready for Firestore)
              </span>
            </div>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveAllZipToFirestore()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Cloud className="w-3.5 h-3.5" />
              )}
              Save All {queue.length} to Firestore
            </button>
          </div>

          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pt-1">
            {queue.map((item) => {
              const selected = item.id === activeItem?.id;
              return (
                <div
                  key={item.id}
                  className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg border text-xs transition-colors ${
                    selected
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedQueueId(item.id)}
                    className="font-mono text-[11px] truncate max-w-[140px]"
                  >
                    {item.cleanName} ({item.packedFrames.length}f)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveFromQueue(item.id)}
                    title={`Remove ${item.cleanName}`}
                    className={`p-0.5 rounded ${
                      selected
                        ? 'text-slate-300 hover:text-white'
                        : 'text-slate-400 hover:text-red-600'
                    }`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Two-Column Preview + 1024-Byte Packer Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Real-Time 128x64 OLED Preview Canvas & Frame Inspector */}
        <div className="lg:col-span-6 space-y-3">
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2.5">
              <span>128×64 OLED PREVIEW (1024B PACKED)</span>
              <span className="tabular-nums">
                {activePackedFrames.length > 0
                  ? `FRAME ${safeFrameIdx + 1}/${activePackedFrames.length} · ${activePackedFrames.length} KB`
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
            {activePackedFrames.length > 0 && (
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
                        setPreviewFrameIdx(
                          (idx) => (idx - 1 + activePackedFrames.length) % activePackedFrames.length
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
                        setPreviewFrameIdx((idx) => (idx + 1) % activePackedFrames.length);
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

                {activePackedFrames.length > 1 && (
                  <input
                    type="range"
                    min={0}
                    max={activePackedFrames.length - 1}
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

          {/* 1024-Byte Packed Buffer Verification Strip */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                <FileCode2 className="w-3.5 h-3.5 text-blue-600" />
                1024-Byte Packed Frame Buffer
              </span>
              <span className="font-mono text-slate-500 tabular-nums">
                Stored in Firestore
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-white border border-slate-200 rounded-lg py-1.5 px-2">
                <div className="text-[10px] text-slate-400">Bytes / Frame</div>
                <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                  {activeFrameBytes ? activeFrameBytes.byteLength.toLocaleString() : '1,024'} B
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg py-1.5 px-2">
                <div className="text-[10px] text-slate-400">Packed Frames</div>
                <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                  {activePackedFrames.length}
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
                Frame #{safeFrameIdx + 1} bytes: {activeFrameHexPreview} …
              </div>
            )}
          </div>
        </div>

        {/* Right: Packing Controls & Permanent Firestore Save Actions */}
        <div className="lg:col-span-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="gif-upload-name"
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                GIF Name (max 20 chars)
              </label>
              <input
                id="gif-upload-name"
                type="text"
                maxLength={20}
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
                <span className="font-medium text-slate-700">Max Frames per GIF</span>
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
              disabled={activePackedFrames.length === 0 || isSaving}
              onClick={() => void handleSaveCurrentToFirestore()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Cloud className="w-3.5 h-3.5" />
              )}
              Save to Firestore &amp; Play
            </button>
            <button
              type="button"
              disabled={activePackedFrames.length === 0}
              onClick={handleDownloadPackedBin}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
              title="Download packed 1024-byte/frame .bin file"
            >
              <Download className="w-3.5 h-3.5" />
              Download .bin
            </button>
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
                  Open Gallery
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
  onPlay: () => void;
  onStop: () => void;
  onChangeSpeed: (ms: number) => void;
  onDownloadBin: () => void;
  onDelete: () => void;
}

const GifGalleryCard: React.FC<GifGalleryCardProps> = ({
  gif,
  scheme,
  isPlayingOnBot,
  onPlay,
  onStop,
  onChangeSpeed,
  onDownloadBin,
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

        <button
          type="button"
          onClick={onDelete}
          title="Delete permanently from Firestore"
          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
