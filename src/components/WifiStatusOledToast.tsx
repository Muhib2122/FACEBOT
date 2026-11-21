import React, { useEffect, useRef } from 'react';
import { Wifi, WifiOff, X } from 'lucide-react';
import { OledColorScheme } from '../types';
import {
  drawWifiStatusScreen,
  paintBufferToCanvas,
  SSD1306Buffer,
} from '../utils/oledRenderer';

interface WifiStatusOledToastProps {
  connected: boolean;
  secondsLeft: number;
  frame: number;
  oledScheme: OledColorScheme;
  onDismiss: () => void;
}

export const WifiStatusOledToast: React.FC<WifiStatusOledToastProps> = ({
  connected,
  secondsLeft,
  frame,
  oledScheme,
  onDismiss,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<SSD1306Buffer>(new SSD1306Buffer());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawWifiStatusScreen(bufferRef.current, connected, frame);
    paintBufferToCanvas(ctx, bufferRef.current, oledScheme, 2, true);
  }, [connected, frame, oledScheme]);

  const progressPct = Math.max(0, Math.min(100, (secondsLeft / 5) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-[300px] sm:w-[324px] bg-slate-950 text-white border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden"
    >
      <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          {connected ? (
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Wifi className="w-3.5 h-3.5" />
            </span>
          ) : (
            <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <WifiOff className="w-3.5 h-3.5" />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-tight truncate">
              {connected ? 'WiFi Connected · Synced' : 'WiFi OFF · Auto Mode'}
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums">
              Priority OLED · Buzzer ON · {secondsLeft}s
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
          aria-label="Close WiFi status OLED preview"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 bg-black flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="w-[256px] h-[128px] rounded-lg border border-slate-800"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      <div className="h-1 bg-slate-800 w-full">
        <div
          className={`h-full transition-all duration-300 ${
            connected ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
};
