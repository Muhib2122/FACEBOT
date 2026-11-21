import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Download,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Timer,
} from 'lucide-react';
import {
  ActiveScreenState,
  BotMode,
  BotSettings,
  FACE_DEFINITIONS,
  HardwareConfig,
  InteractionCategory,
  InteractionEvent,
  LocationConfig,
  NavSection,
  WeatherData,
} from '../types';
import {
  drawTimerScreen,
  paintBufferToCanvas,
  SSD1306Buffer,
} from '../utils/oledRenderer';

interface DashboardPanelProps {
  events: InteractionEvent[];
  esp32HourlyOverrides: number[] | null;
  esp32SyncStatus: string | null;
  mode: BotMode;
  activeScreen: ActiveScreenState;
  settings: BotSettings;
  location: LocationConfig;
  weather: WeatherData | null;
  hardware: HardwareConfig;
  isSleeping: boolean;
  greenLedOn: boolean;
  esp32Online: boolean;
  frame: number;
  pomodoroSecondsLeft: number;
  pomodoroTotalSec: number;
  pomodoroRunning: boolean;
  pomodoroLabel: string;
  pomodoroEndAtMs: number;
  onSyncEsp32Stats: () => Promise<void>;
  onResetStats: () => void;
  onStartPomodoro: (totalSeconds: number, label: string) => void;
  onTogglePomodoro: () => void;
  onResetPomodoro: () => void;
  onNavigate: (section: NavSection) => void;
}

type CategoryFilter = 'all' | InteractionCategory;

const CATEGORY_LABELS: Record<InteractionCategory, string> = {
  'ai-voice': 'AI & Voice',
  'oled-face': 'OLED & Faces',
  hardware: 'LED & Buzzer',
  alarm: 'Alarms',
};

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatClockMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const DashboardPanel: React.FC<DashboardPanelProps> = ({
  events,
  esp32HourlyOverrides,
  esp32SyncStatus,
  mode,
  activeScreen,
  settings,
  location,
  weather,
  hardware,
  isSleeping,
  greenLedOn,
  esp32Online,
  frame,
  pomodoroSecondsLeft,
  pomodoroTotalSec,
  pomodoroRunning,
  pomodoroLabel,
  pomodoroEndAtMs,
  onSyncEsp32Stats,
  onResetStats,
  onStartPomodoro,
  onTogglePomodoro,
  onResetPomodoro,
  onNavigate,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('15');
  const [customSeconds, setCustomSeconds] = useState('0');
  const timerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerBufferRef = useRef<SSD1306Buffer>(new SSD1306Buffer());

  useEffect(() => {
    const canvas = timerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const smoothRemFloat =
      pomodoroRunning && pomodoroEndAtMs > 0
        ? Math.max(0, (pomodoroEndAtMs - Date.now()) / 1000)
        : pomodoroSecondsLeft;
    const displayRemSec =
      pomodoroRunning && pomodoroEndAtMs > 0
        ? Math.ceil(smoothRemFloat)
        : pomodoroSecondsLeft;
    drawTimerScreen(
      timerBufferRef.current,
      pomodoroLabel,
      displayRemSec,
      Math.max(1, pomodoroTotalSec),
      !pomodoroRunning,
      frame,
      smoothRemFloat
    );
    paintBufferToCanvas(ctx, timerBufferRef.current, hardware.oledScheme, 2, true);
  }, [
    pomodoroLabel,
    pomodoroSecondsLeft,
    pomodoroTotalSec,
    pomodoroRunning,
    pomodoroEndAtMs,
    frame,
    hardware.oledScheme,
  ]);

  const handleStartCustomTimer = (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Math.max(0, Math.min(180, Math.floor(Number(customMinutes) || 0)));
    const secs = Math.max(0, Math.min(59, Math.floor(Number(customSeconds) || 0)));
    const total = mins * 60 + secs;
    if (total < 5) return;
    onStartPomodoro(total, 'CUSTOM');
  };

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (categoryFilter !== 'all' && ev.category !== categoryFilter) return false;
      if (
        searchQuery.trim() &&
        !ev.label.toLowerCase().includes(searchQuery.trim().toLowerCase()) &&
        !CATEGORY_LABELS[ev.category].toLowerCase().includes(searchQuery.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [events, categoryFilter, searchQuery]);

  // Build 24-hour series (00:00 -> 23:00) combining live portal events + real ESP32 hourly counters if synced
  const hourlyChartData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      time: formatHourLabel(hour),
      interactions: 0,
      aiVoice: 0,
      oledFace: 0,
      hardware: 0,
    }));

    for (const ev of events) {
      if (ev.hour >= 0 && ev.hour < 24) {
        if (ev.category === 'ai-voice') buckets[ev.hour].aiVoice += 1;
        else if (ev.category === 'oled-face') buckets[ev.hour].oledFace += 1;
        else buckets[ev.hour].hardware += 1;

        if (categoryFilter === 'all' || ev.category === categoryFilter) {
          buckets[ev.hour].interactions += 1;
        }
      }
    }

    if (esp32HourlyOverrides && esp32HourlyOverrides.length === 24 && categoryFilter === 'all') {
      for (let h = 0; h < 24; h++) {
        buckets[h].interactions = Math.max(buckets[h].interactions, esp32HourlyOverrides[h] || 0);
      }
    }

    return buckets;
  }, [events, categoryFilter, esp32HourlyOverrides]);

  const totalInteractions = useMemo(
    () => hourlyChartData.reduce((sum, item) => sum + item.interactions, 0),
    [hourlyChartData]
  );

  const peakBucket = useMemo(() => {
    return hourlyChartData.reduce(
      (best, curr) => (curr.interactions > best.interactions ? curr : best),
      hourlyChartData[0]
    );
  }, [hourlyChartData]);

  const activeFaceDef = FACE_DEFINITIONS.find((f) => f.id === activeScreen.faceId);
  const activeScreenLabel = (() => {
    if (activeScreen.kind === 'alarm') return 'Alarm Ringing';
    if (activeScreen.kind === 'boot-logo') return 'Startup Logo (5s)';
    if (activeScreen.kind === 'watch') return 'Watch UI';
    if (activeScreen.kind === 'weather') return 'Live Weather';
    if (activeScreen.kind === 'greeting') return 'Greeting';
    if (activeScreen.kind === 'wifi-status') {
      return activeScreen.wifiConnected ? 'WiFi Connected (10s)' : 'WiFi OFF · Auto Mode (10s)';
    }
    if (activeScreen.kind === 'timer') return `${activeScreen.timerLabel || 'Focus'} Timer`;
    if (activeScreen.kind === 'custom-text') return activeScreen.textLine1 || 'Custom Text';
    if (activeScreen.kind === 'custom-bitmap') return 'Touchpad Art';
    if (activeScreen.kind === 'custom-gif') return 'Animated GIF';
    return activeFaceDef ? activeFaceDef.name : 'Face';
  })();

  const handleSyncClick = async () => {
    setSyncing(true);
    try {
      await onSyncEsp32Stats();
    } finally {
      setSyncing(false);
    }
  };

  const handleExportCsv = () => {
    const header = 'Hour,Total Interactions,AI & Voice,OLED & Faces,Hardware & Alarms\n';
    const rows = hourlyChartData
      .map((d) => `${d.time},${d.interactions},${d.aiVoice},${d.oledFace},${d.hardware}`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facebot_daily_stats_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 4-Column Tabular KPI Strip (Single-Elevation, Zero Nested Cards) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Daily Interactions</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {totalInteractions}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {categoryFilter === 'all' ? 'All ESP32 & portal events' : CATEGORY_LABELS[categoryFilter]}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Peak Activity Hour</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {peakBucket.interactions > 0 ? peakBucket.time : '--:--'}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {peakBucket.interactions > 0
              ? `${peakBucket.interactions} events during peak window`
              : 'No spikes recorded yet'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Active OLED Output</div>
          <div className="text-lg font-semibold text-slate-900 truncate mt-2">
            {isSleeping ? 'Sleeping (Zzz)' : activeScreenLabel}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {mode === 'auto' ? 'Auto Mode' : 'User Playlist'} · Green LED {greenLedOn ? 'ON' : 'OFF'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Environment &amp; Node</div>
          <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-2">
            {weather ? `${weather.temperature.toFixed(1)}°C` : '--°C'} · {location.city}
          </div>
          <div className="text-xs text-slate-500 mt-1 truncate">
            {esp32Online
              ? `ESP32 Online · ${hardware.deviceId || 'muhib-bot-1'}`
              : hardware.cloudSyncEnabled
                ? `ESP32 Offline · Waiting for ${hardware.deviceId || 'muhib-bot-1'}`
                : hardware.esp32Ip.trim()
                  ? `ESP32 Bridge: ${hardware.esp32Ip.trim()}`
                  : `${settings.userName}'s Local Simulator`}
          </div>
        </div>
      </section>

      {/* Main Analytics Line Chart: Daily Interaction Spikes Throughout the Day */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Daily ESP32 Interaction Spikes (24-Hour Timeline)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live hourly activity across voice agent commands, OLED expressions, buzzer chimes, and LED actions
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Segmented Category Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'ai-voice', label: 'AI & Voice' },
                  { id: 'oled-face', label: 'OLED' },
                  { id: 'hardware', label: 'Hardware' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    categoryFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleSyncClick}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sync ESP32
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {esp32SyncStatus && (
          <p className="text-xs text-blue-700 mt-3">{esp32SyncStatus}</p>
        )}

        <div className="h-[300px] w-full pt-5">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={hourlyChartData}
              margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
                interval={2}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
                labelStyle={{ color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}
                formatter={(value) => [`${value} interactions`, 'Activity']}
              />
              <Line
                type="monotone"
                dataKey="interactions"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#2563eb', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#0f172a', stroke: '#2563eb', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Bottom Split: Left = Recent Activity Log Table, Right = Focus Pomodoro OLED Timer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Recent Interactions Log */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Recent Interaction Log
              </h3>
              <p className="text-xs text-slate-500">
                Chronological stream of voice commands, face switches, and hardware events
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter activity..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-44"
                />
              </div>
              <button
                type="button"
                onClick={onResetStats}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                Clear Log
              </button>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-sm text-slate-500">
                No matching interactions recorded yet today.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('agent')}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Talk to AI Voice Agent
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">Time</th>
                    <th className="py-2.5 px-4 font-medium">Category</th>
                    <th className="py-2.5 px-4 font-medium">Action</th>
                    <th className="py-2.5 pl-4 font-medium text-right">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEvents.slice(0, 10).map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 pr-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {CATEGORY_LABELS[ev.category]}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 truncate max-w-[260px]">
                        {ev.label}
                      </td>
                      <td className="py-2.5 pl-4 text-right font-mono text-slate-500 uppercase whitespace-nowrap">
                        {ev.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Pro Productivity Feature: Live OLED Pomodoro Focus Timer */}
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                OLED Focus Timer
              </h3>
            </div>
            <span className="text-xs font-medium text-slate-500">
              {pomodoroRunning ? 'Running' : 'Ready'} · {pomodoroLabel}
            </span>
          </div>

          {/* Live Smooth 24-FPS OLED Timer Preview */}
          <div className="rounded-xl bg-slate-950 p-2.5 flex flex-col items-center justify-center border border-slate-800">
            <canvas
              ref={timerCanvasRef}
              className="w-full max-w-[256px] aspect-[2/1] rounded-md"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          <div className="text-center">
            <div className="text-3xl font-bold font-mono text-slate-900 tabular-nums tracking-tight">
              {formatClockMmSs(pomodoroSecondsLeft)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Smooth 1s wall-clock countdown + buzzer chime when finished
            </p>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => onStartPomodoro(60, '1M TEST')}
              className="py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              1m
            </button>
            <button
              type="button"
              onClick={() => onStartPomodoro(5 * 60, 'BREAK')}
              className="py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              5m
            </button>
            <button
              type="button"
              onClick={() => onStartPomodoro(10 * 60, 'STUDY')}
              className="py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              10m
            </button>
            <button
              type="button"
              onClick={() => onStartPomodoro(25 * 60, 'FOCUS')}
              className="py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              25m
            </button>
          </div>

          <form onSubmit={handleStartCustomTimer} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 flex-1">
              <input
                type="number"
                min={0}
                max={180}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                aria-label="Custom timer minutes"
                className="w-full px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="Min"
              />
              <span className="text-xs font-bold text-slate-400">m</span>
              <input
                type="number"
                min={0}
                max={59}
                value={customSeconds}
                onChange={(e) => setCustomSeconds(e.target.value)}
                aria-label="Custom timer seconds"
                className="w-full px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="Sec"
              />
              <span className="text-xs font-bold text-slate-400">s</span>
            </div>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap"
            >
              Set &amp; Go
            </button>
          </form>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onTogglePomodoro}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              {pomodoroRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pause Timer
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  {pomodoroSecondsLeft < pomodoroTotalSec && pomodoroSecondsLeft > 0
                    ? 'Resume Timer'
                    : 'Start on OLED'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onResetPomodoro}
              className="p-2 text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
              title="Reset timer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
