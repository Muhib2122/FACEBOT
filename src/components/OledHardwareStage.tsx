import React, { useEffect, useRef, useState } from 'react';
import {
  BellOff,
  Camera,
  Check,
  Lightbulb,
  Moon,
  RotateCcw,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ActiveScreenState,
  AnimationSpeed,
  BotMode,
  BotSettings,
  CustomReaction,
  FACE_DEFINITIONS,
  GreenLedMode,
  HardwareConfig,
  LocationConfig,
  OledColorScheme,
  SavedGifItem,
  WeatherData,
} from '../types';
import {
  paintBufferToCanvas,
  renderScreenToBuffer,
  SSD1306Buffer,
} from '../utils/oledRenderer';

interface OledHardwareStageProps {
  mode: BotMode;
  activeScreen: ActiveScreenState;
  frame: number;
  now: Date;
  settings: BotSettings;
  weather: WeatherData | null;
  location: LocationConfig;
  hardware: HardwareConfig;
  isSleeping: boolean;
  greenLedOn: boolean;
  activeAlarm: { id: string; time: string; label: string } | null;
  customReactions: CustomReaction[];
  savedGifs: SavedGifItem[];
  onChangeOledScheme: (scheme: OledColorScheme) => void;
  onChangeAnimationSpeed: (speed: AnimationSpeed) => void;
  onChangeGreenLedMode: (mode: GreenLedMode) => void;
  onTestBuzzer: () => void;
  onToggleMute: () => void;
  onPutToSleep: () => void;
  onWakeUp: () => void;
  onDismissAlarm: () => void;
  onSnoozeAlarm: () => void;
  onUnlockScreen: () => void;
  onCaptureScreenshot: (pixels: number[], title: string, screenKind: string) => void;
}

export const OledHardwareStage: React.FC<OledHardwareStageProps> = ({
  mode,
  activeScreen,
  frame,
  now,
  settings,
  weather,
  location,
  hardware,
  isSleeping,
  greenLedOn,
  activeAlarm,
  customReactions,
  savedGifs,
  onChangeOledScheme,
  onChangeAnimationSpeed,
  onChangeGreenLedMode,
  onTestBuzzer,
  onToggleMute,
  onPutToSleep,
  onWakeUp,
  onDismissAlarm,
  onSnoozeAlarm,
  onUnlockScreen,
  onCaptureScreenshot,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<SSD1306Buffer>(new SSD1306Buffer());
  const [justCaptured, setJustCaptured] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderScreenToBuffer(
      bufferRef.current,
      activeScreen,
      frame,
      now,
      settings,
      weather,
      location,
      customReactions,
      activeAlarm,
      savedGifs
    );
    paintBufferToCanvas(ctx, bufferRef.current, hardware.oledScheme, 3, true);
  }, [
    activeScreen,
    frame,
    now,
    settings,
    weather,
    location,
    hardware.oledScheme,
    customReactions,
    activeAlarm,
    savedGifs,
  ]);

  const activeFaceDef = FACE_DEFINITIONS.find((f) => f.id === activeScreen.faceId);
  const screenTitle = (() => {
    if (activeScreen.kind === 'alarm') return `Alarm · ${activeAlarm?.label || 'Ringing'}`;
    if (activeScreen.kind === 'boot-logo') return 'Muhib Creation · Startup Logo (5s)';
    if (activeScreen.kind === 'wifi-status') {
      return activeScreen.wifiConnected
        ? 'WiFi Connected · Auto Sync (10s)'
        : 'WiFi Disconnected · Auto Mode (10s)';
    }
    if (activeScreen.kind === 'timer') {
      return `${activeScreen.timerLabel || 'Focus'} Timer${activeScreen.timerPausedSec !== undefined ? ' (Paused)' : ''}`;
    }
    if (activeScreen.kind === 'watch') return 'Watch UI';
    if (activeScreen.kind === 'weather') return `Live Weather · ${location.city}`;
    if (activeScreen.kind === 'greeting') return `Greeting · ${settings.userName}`;
    if (activeScreen.kind === 'proximity-wake') return `Wake-Up · Hi ${settings.userName}!`;
    if (activeScreen.kind === 'custom-bitmap') {
      const cr = customReactions.find((r) => r.id === activeScreen.customReactionId);
      return `Touchpad Art · ${cr?.name || 'Custom'}`;
    }
    if (activeScreen.kind === 'custom-gif') {
      const gif = savedGifs.find((g) => g.id === activeScreen.activeGifId);
      return `Animated GIF · ${gif?.name || 'GIF'}`;
    }
    if (activeScreen.kind === 'custom-text') return 'Custom OLED Message';
    return activeFaceDef ? `Face #${activeFaceDef.id + 1} · ${activeFaceDef.name}` : 'Face Expression';
  })();

  const liveTimeStr = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: !settings.use24HourClock,
  });

  const liveDateStr = now.toLocaleDateString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6">
      {/* Top Stage Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            0.96" SSD1306 OLED · ESP32 Minimal Rig
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            <span>{mode === 'auto' ? 'Auto' : 'User'}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{liveTimeStr}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{liveDateStr}</span>
            {weather && (
              <>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>
                  {location.city} {weather.temperature.toFixed(1)}°C ({weather.conditionLabel})
                </span>
              </>
            )}
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{screenTitle}</span>
            {activeScreen.locked && (
              <>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <button
                  onClick={onUnlockScreen}
                  className="text-blue-600 hover:text-blue-700 font-medium underline underline-offset-2"
                >
                  Resume Cycle
                </button>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Animation Speed Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" title="Animation Speed">
            {(
              [
                { id: 'slow', label: 'Slow' },
                { id: 'normal', label: 'Normal' },
                { id: 'fast', label: 'Fast' },
              ] as const
            ).map((sp) => (
              <button
                key={sp.id}
                onClick={() => onChangeAnimationSpeed(sp.id)}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  hardware.animationSpeed === sp.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sp.label}
              </button>
            ))}
          </div>

          {/* Phosphor Scheme Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'ice-blue', label: 'Ice Blue' },
                { id: 'white', label: 'White' },
                { id: 'dual-yellow-blue', label: 'Dual Y/B' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => onChangeOledScheme(item.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  hardware.oledScheme === item.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Rig Grid: Left = Clean ESP32 OLED + Single Green LED, Right = Quick Controls */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 pt-5 items-center">
        {/* Physical Minimal ESP32 OLED Housing */}
        <div className="xl:col-span-7 flex flex-col items-center justify-center py-5 px-3 bg-slate-50 border border-slate-200/80 rounded-xl">
          <div className="relative bg-slate-900 rounded-2xl p-4 sm:p-5 shadow-md border border-slate-700 w-full max-w-[432px]">
            {/* Top Hardware Bezel Row: Single Green LED (GPIO 26, No Resistor) + I2C Tag */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2" title="Green LED (GPIO 26 · Direct 3.3V, No Resistor)">
                <span
                  className={`inline-block w-3 h-3 rounded-full transition-all duration-150 ${
                    greenLedOn
                      ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]'
                      : 'bg-slate-700'
                  }`}
                />
                <span className="text-[11px] font-mono text-slate-300">
                  GREEN LED (GPIO 26) · {hardware.greenLedMode.toUpperCase()}
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                128×64 0x3C
              </span>
            </div>

            {/* SSD1306 Glass Panel */}
            <div className="bg-[#05080F] p-2 rounded-lg border border-slate-800 overflow-hidden">
              <canvas
                ref={canvasRef}
                width={384}
                height={192}
                className="oled-canvas w-full h-auto block rounded-xs"
                aria-label="0.96 inch SSD1306 OLED live display"
              />
            </div>

            {/* Bottom Pinout Strip */}
            <div className="flex items-center justify-between mt-3 px-2 py-1.5 bg-slate-800/70 rounded-lg border border-slate-700/70 text-[10px] font-mono text-slate-400">
              <span>OLED: SDA 21 / SCL 22</span>
              <span>BUZZER: GPIO 14</span>
              <span>LED: GPIO 26</span>
            </div>
          </div>
        </div>

        {/* Interactive Minimal Hardware Controls */}
        <div className="xl:col-span-5 flex flex-col gap-4">
          {activeAlarm && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-red-900 tabular-nums">
                  Alarm Active · {activeAlarm.time}
                </p>
                <p className="text-xs text-red-700">{activeAlarm.label}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={onSnoozeAlarm}
                  className="px-3 py-2 text-xs font-semibold text-red-800 bg-white border border-red-200 hover:bg-red-100/60 rounded-lg transition-colors whitespace-nowrap"
                >
                  Snooze 5m
                </button>
                <button
                  onClick={onDismissAlarm}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Live Readout Strip */}
          <div className="grid grid-cols-3 divide-x divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/70">
            <div className="p-3">
              <div className="text-[11px] font-medium text-slate-500">Green LED</div>
              <div className="text-base font-semibold font-mono text-slate-900 mt-0.5">
                {greenLedOn ? 'ON' : 'OFF'}
              </div>
              <div className="text-[11px] text-slate-500 capitalize">
                Mode: {hardware.greenLedMode}
              </div>
            </div>
            <div className="p-3">
              <div className="text-[11px] font-medium text-slate-500">Piezo Buzzer</div>
              <div className="text-base font-semibold text-slate-900 mt-0.5">
                {hardware.buzzerMuted ? 'Muted' : 'Active'}
              </div>
              <div className="text-[11px] text-slate-500 font-mono">GPIO 14</div>
            </div>
            <div className="p-3">
              <div className="text-[11px] font-medium text-slate-500">Bot State</div>
              <div className="text-base font-semibold text-slate-900 mt-0.5">
                {isSleeping ? 'Sleeping' : 'Awake'}
              </div>
              <div className="text-[11px] text-slate-500">
                {hardware.cloudSyncEnabled
                  ? 'Vercel Cloud'
                  : hardware.esp32Ip.trim()
                    ? 'ESP32 Linked'
                    : 'Simulator'}
              </div>
            </div>
          </div>

          {/* Single Green LED (GPIO 26) Quick Switch */}
          <div className="p-3.5 border border-slate-200 rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Lightbulb className="w-3.5 h-3.5 text-emerald-600" />
                Green LED (GPIO 26 · No Resistor)
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {greenLedOn ? 'LIT' : 'DARK'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(['auto', 'on', 'blink', 'off'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onChangeGreenLedMode(m)}
                  className={`py-1.5 text-xs font-semibold rounded-md border uppercase transition-colors ${
                    hardware.greenLedMode === m
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Hardware Action Buttons */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={onTestBuzzer}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Beep Buzzer
            </button>
            <button
              onClick={isSleeping ? onWakeUp : onPutToSleep}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              {isSleeping ? (
                <>
                  <Sun className="w-3.5 h-3.5" />
                  Wake Bot Up
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5" />
                  Put to Sleep
                </>
              )}
            </button>
            <button
              onClick={onToggleMute}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {hardware.buzzerMuted ? (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                  Unmute Browser
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-slate-700" />
                  Mute Browser
                </>
              )}
            </button>
            <button
              onClick={onUnlockScreen}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Resume Cycle
            </button>
            <button
              type="button"
              onClick={() => {
                const snapshotPixels = Array.from(bufferRef.current.pixels);
                onCaptureScreenshot(snapshotPixels, screenTitle, activeScreen.kind);
                setJustCaptured(true);
                window.setTimeout(() => setJustCaptured(false), 1800);
              }}
              className={`col-span-2 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                justCaptured
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                  : 'border-slate-900 bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {justCaptured ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Saved 128×64 Screenshot to Gallery!
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" />
                  Screenshot to Gallery
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
