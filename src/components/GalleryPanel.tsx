import React, { useEffect, useRef } from 'react';
import { Camera, CloudCheck, Download, LogIn, MonitorPlay, Trash2 } from 'lucide-react';
import { OledColorScheme, OledScreenshot } from '../types';
import { hex2048ToPixels } from '../utils/firestoreSync';
import { paintBufferToCanvas, SSD1306Buffer } from '../utils/oledRenderer';

interface GalleryPanelProps {
  screenshots: OledScreenshot[];
  isSignedIn: boolean;
  onSignIn: () => void;
  onPushToOled: (shot: OledScreenshot) => void;
  onDeleteScreenshot: (id: string) => void;
  onGoToOled: () => void;
}

const ScreenshotCanvas: React.FC<{
  pixelsHex: string;
  scheme: OledColorScheme;
  canvasRefOut?: React.MutableRefObject<HTMLCanvasElement | null>;
}> = ({ pixelsHex, scheme, canvasRefOut }) => {
  const localRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = localRef.current;
    if (!canvas) return;
    if (canvasRefOut) canvasRefOut.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const buf = new SSD1306Buffer();
    const pixels = hex2048ToPixels(pixelsHex);
    for (let i = 0; i < pixels.length && i < buf.pixels.length; i++) {
      buf.pixels[i] = pixels[i];
    }
    paintBufferToCanvas(ctx, buf, scheme, 3, true);
  }, [pixelsHex, scheme, canvasRefOut]);

  return (
    <canvas
      ref={localRef}
      width={384}
      height={192}
      className="oled-canvas w-full h-auto block rounded-xs"
      aria-label="Captured 128x64 OLED screenshot"
    />
  );
};

const GalleryCard: React.FC<{
  shot: OledScreenshot;
  onPushToOled: (shot: OledScreenshot) => void;
  onDeleteScreenshot: (id: string) => void;
}> = ({ shot, onPushToOled, onDeleteScreenshot }) => {
  const cardCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleDownloadPng = () => {
    const canvas = cardCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    const safeName = shot.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'oled_shot';
    a.download = `FaceBot_${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formattedDate = new Date(shot.capturedAtMs).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <article className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      <div className="bg-slate-900 p-3 border-b border-slate-800">
        <div className="bg-[#05080F] p-1.5 rounded-lg border border-slate-800">
          <ScreenshotCanvas
            pixelsHex={shot.pixelsHex}
            scheme={shot.oledScheme}
            canvasRefOut={cardCanvasRef}
          />
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 truncate" title={shot.title}>
            {shot.title}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            <span>{formattedDate}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="font-mono uppercase">{shot.screenKind}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>128×64</span>
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onPushToOled(shot)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <MonitorPlay className="w-3.5 h-3.5" />
            Send to ESP32
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            title="Download PNG"
            className="p-2 text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteScreenshot(shot.id)}
            title="Delete screenshot"
            className="p-2 text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </article>
  );
};

export const GalleryPanel: React.FC<GalleryPanelProps> = ({
  screenshots,
  isSignedIn,
  onSignIn,
  onPushToOled,
  onDeleteScreenshot,
  onGoToOled,
}) => {
  return (
    <div className="space-y-6">
      {/* Gallery Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            OLED Screenshot Gallery
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {screenshots.length} captured 128×64 frame{screenshots.length === 1 ? '' : 's'}
            <span className="mx-1.5" aria-hidden="true">·</span>
            {isSignedIn ? 'Synced to Firebase Firestore' : 'Saved locally (Sign in to sync to Firebase)'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isSignedIn ? (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 text-blue-600" />
              Sign in to Save in Cloud
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 pr-2">
              <CloudCheck className="w-4 h-4" />
              Firestore Cloud Active
            </span>
          )}

          <button
            type="button"
            onClick={onGoToOled}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5" />
            Capture New Screenshot
          </button>
        </div>
      </div>

      {/* Gallery Grid or Clean Empty State */}
      {screenshots.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Camera className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">No OLED screenshots yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Open <span className="font-medium text-slate-700">OLED Display</span> and click{' '}
            <span className="font-medium text-slate-700">Screenshot</span> to capture any live 128×64 face, clock, weather, or custom message straight into your Firestore Gallery.
          </p>
          <button
            type="button"
            onClick={onGoToOled}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            Go to OLED Display
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {screenshots.map((shot) => (
            <GalleryCard
              key={shot.id}
              shot={shot}
              onPushToOled={onPushToOled}
              onDeleteScreenshot={onDeleteScreenshot}
            />
          ))}
        </div>
      )}
    </div>
  );
};
