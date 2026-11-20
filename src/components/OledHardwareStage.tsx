import React, { useEffect, useRef } from 'react';
import {
  BellOff,
  Hand,
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
  HardwareConfig,
  LocationConfig,
  OledColorScheme,
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
  currentServoAngle: number;
  servoPowered: boolean;
  userDetected: boolean;
  isSleeping: boolean;
  greenLedOn: boolean;
  redLedOn: boolean;
  activeAlarm: { id: string; time: string; label: string } | null;
  customReactions: CustomReaction[];
  onChangeOledScheme: (scheme: OledColorScheme) => void;
  onChangeAnimationSpeed: (speed: AnimationSpeed) => void;
  onToggleMute: () => void;
  onPutToSleep: () => void;
  onWakeUp: () => void;
  onWaveHand: () => void;
  onDistanceChange: (cm: number) => void;
  onUserAngleChange: (angle: number) => void;
  onDismissAlarm: () => void;
  onSnoozeAlarm: () => void;
  onUnlockScreen: () => void;
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
  currentServoAngle,
  servoPowered,
  userDetected,
  isSleeping,
  greenLedOn,
  redLedOn,
  activeAlarm,
  customReactions,
  onChangeOledScheme,
  onChangeAnimationSpeed,
  onToggleMute,
  onPutToSleep,
  onWakeUp,
  onWaveHand,
  onDistanceChange,
  onUserAngleChange,
  onDismissAlarm,
  onSnoozeAlarm,
  onUnlockScreen,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<SSD1306Buffer>(new SSD1306Buffer());

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
      activeAlarm
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
  ]);

  // Convert servo angle (0..180, center 90) to visual head pan/tilt (-22deg to +22deg)
  const headRotationDeg = ((currentServoAngle - 90) / 90) * 22;

  const activeFaceDef = FACE_DEFINITIONS.find((f) => f.id === activeScreen.faceId);
  const screenTitle = (() => {
    if (activeScreen.kind === 'alarm') return `Alarm · ${activeAlarm?.label || 'Ringing'}`;
    if (activeScreen.kind === 'watch') return 'Watch UI';
    if (activeScreen.kind === 'weather') return `Live Weather · ${location.city}`;
    if (activeScreen.kind === 'greeting') return `Greeting · ${settings.userName}`;
    if (activeScreen.kind === 'proximity-wake') return `HC-SR04 Wake-Up · Hi ${settings.userName}!`;
    if (activeScreen.kind === 'custom-bitmap') {
      const cr = customReactions.find((r) => r.id === activeScreen.customReactionId);
      return `Touchpad Art · ${cr?.name || 'Custom'}`;
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

  const isNear = hardware.simulatedDistanceCm <= hardware.wakeDistanceCm;

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6">
      {/* Top Stage Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            0.96" SSD1306 OLED &amp; Hardware Rig
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

      {/* Main Rig Grid: Left = Physical Bot Enclosure + Servo, Right = Interactive Hardware Controls */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 pt-5 items-center">
        {/* Physical Mini Face Bot Housing */}
        <div className="xl:col-span-7 flex flex-col items-center justify-center py-4 px-3 bg-slate-50 border border-slate-200/80 rounded-xl">
          {/* Animated Head Chassis mounted on SG90 Servo */}
          <div
            className="transition-transform duration-200 ease-out will-change-transform"
            style={{ transform: `rotate(${headRotationDeg.toFixed(1)}deg)` }}
          >
            <div className="relative bg-slate-900 rounded-2xl p-4 sm:p-5 shadow-md border border-slate-700 w-full max-w-[432px]">
              {/* Top Hardware Bezel Row: Mounting Screws + Physical Red/Green LEDs */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5" title="Green LED (GPIO 26)">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full transition-colors ${
                        greenLedOn
                          ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                          : 'bg-slate-700'
                      }`}
                    />
                    <span className="text-[11px] font-mono text-slate-400">GRN</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Red LED (GPIO 27)">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full transition-colors ${
                        redLedOn
                          ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                          : 'bg-slate-700'
                      }`}
                    />
                    <span className="text-[11px] font-mono text-slate-400">RED</span>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  128×64 I2C 0x3C
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

              {/* Co-Mounted HC-SR04 Ultrasonic Module directly below 0.96" OLED */}
              <div className="flex items-center justify-between mt-3 px-2 py-2 bg-slate-800/80 rounded-lg border border-slate-700/80">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      userDetected
                        ? 'border-blue-400 bg-slate-900'
                        : 'border-slate-500 bg-slate-950'
                    }`}
                    title="HC-SR04 Transmitter"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                  </div>
                  <div className="text-[10px] font-mono text-slate-300 leading-tight">
                    <div>HC-SR04</div>
                    <div className={userDetected ? 'text-blue-300' : 'text-slate-500'}>
                      {userDetected ? `${hardware.simulatedDistanceCm}cm LOCK` : 'NO OBJECT'}
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      userDetected
                        ? 'border-blue-400 bg-slate-900'
                        : 'border-slate-500 bg-slate-950'
                    }`}
                    title="HC-SR04 Receiver"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                  </div>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-300">
                  {servoPowered
                    ? `SERVO ON ${Math.round(currentServoAngle)}°`
                    : 'SERVO OFF 90°'}
                </span>
              </div>
            </div>
          </div>

          {/* SG90 Servo Pedestal Base */}
          <div className="flex flex-col items-center -mt-0.5">
            <div className="w-8 h-3 bg-slate-700 rounded-b-sm" />
            <div className="w-28 h-2.5 bg-slate-800 rounded-t-md border-t border-slate-600" />
            <div className="w-40 h-2 bg-slate-300 rounded-full mt-1" />
          </div>
        </div>

        {/* Interactive Hardware Controls & Live Sensor Rig */}
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
              <div className="text-[11px] font-medium text-slate-500">Servo Neck</div>
              <div className="text-base font-semibold font-mono text-slate-900 tabular-nums mt-0.5">
                {Math.round(currentServoAngle)}°
              </div>
              <div className="text-[11px] text-slate-500">
                {servoPowered
                  ? hardware.servoManualOverride
                    ? 'Manual ON'
                    : userDetected && hardware.trackingEnabled
                      ? 'Tracking ON'
                      : 'Active ON'
                  : 'Idle OFF (90°)'}
              </div>
            </div>
            <div className="p-3">
              <div className="text-[11px] font-medium text-slate-500">HC-SR04</div>
              <div className="text-base font-semibold font-mono text-slate-900 tabular-nums mt-0.5">
                {hardware.ultrasonicEnabled ? `${hardware.simulatedDistanceCm} cm` : 'Off'}
              </div>
              <div className="text-[11px] text-slate-500">
                {hardware.ultrasonicEnabled
                  ? userDetected
                    ? isNear
                      ? 'Wake Range'
                      : 'Tracking User'
                    : 'No Object'
                  : 'Disabled'}
              </div>
            </div>
            <div className="p-3">
              <div className="text-[11px] font-medium text-slate-500">Bot State</div>
              <div className="text-base font-semibold text-slate-900 mt-0.5">
                {isSleeping ? 'Sleeping' : 'Awake'}
              </div>
              <div className="text-[11px] text-slate-500">
                {hardware.buzzerMuted ? 'Buzzer Muted' : 'Audio On'}
              </div>
            </div>
          </div>

          {/* Interactive HC-SR04 Proximity & User Direction Tracking Simulator */}
          <div className="p-3.5 border border-slate-200 rounded-lg space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="hc-sr04-sim"
                  className="text-xs font-semibold text-slate-800"
                >
                  HC-SR04 Distance (Wake ≤ {hardware.wakeDistanceCm}cm · Track ≤ {hardware.trackingRangeCm}cm)
                </label>
                <span className="text-xs font-mono text-slate-600 tabular-nums">
                  {hardware.simulatedDistanceCm} cm
                </span>
              </div>
              <input
                id="hc-sr04-sim"
                type="range"
                min={4}
                max={120}
                value={hardware.simulatedDistanceCm}
                disabled={!hardware.ultrasonicEnabled}
                onChange={(e) => onDistanceChange(Number(e.target.value))}
                className="w-full hw-slider disabled:opacity-40"
              />
            </div>

            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="hc-sr04-angle"
                  className="text-xs font-semibold text-slate-800"
                >
                  User Direction Angle (OLED follows user)
                </label>
                <span className="text-xs font-mono text-slate-600 tabular-nums">
                  {hardware.simulatedUserAngle}°
                </span>
              </div>
              <input
                id="hc-sr04-angle"
                type="range"
                min={30}
                max={150}
                value={hardware.simulatedUserAngle}
                disabled={!hardware.ultrasonicEnabled || !hardware.trackingEnabled}
                onChange={(e) => onUserAngleChange(Number(e.target.value))}
                className="w-full hw-slider disabled:opacity-40"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                <span>30° Left</span>
                <span>90° Straight</span>
                <span>150° Right</span>
              </div>
            </div>
          </div>

          {/* Quick Hardware Action Buttons */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={onWaveHand}
              disabled={!hardware.ultrasonicEnabled}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors whitespace-nowrap"
            >
              <Hand className="w-3.5 h-3.5" />
              Wave Hand (&lt;{hardware.wakeDistanceCm}cm)
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
                  Unmute Buzzer
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-slate-700" />
                  Mute Buzzer
                </>
              )}
            </button>
            <button
              onClick={onUnlockScreen}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Resume Playback
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
