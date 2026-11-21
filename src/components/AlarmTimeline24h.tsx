import React, { useCallback, useMemo, useRef, useState } from 'react';
import { BellRing, Clock, GripHorizontal } from 'lucide-react';
import { AlarmItem } from '../types';

interface AlarmTimeline24hProps {
  alarms: AlarmItem[];
  activeAlarm: AlarmItem | null;
  now: Date;
  onUpdateAlarmTime: (id: string, newTime: string) => void;
}

const MINUTES_PER_DAY = 1440;
const MAJOR_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const SNAP_OPTIONS = [1, 5, 15] as const;
type SnapStep = (typeof SNAP_OPTIONS)[number];

function timeToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(':').map(Number);
  const safeH = Number.isFinite(hh) ? Math.max(0, Math.min(23, hh)) : 7;
  const safeM = Number.isFinite(mm) ? Math.max(0, Math.min(59, mm)) : 0;
  return safeH * 60 + safeM;
}

function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(totalMinutes)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function snapMinutes(rawMinutes: number, step: SnapStep): number {
  const snapped = Math.round(rawMinutes / step) * step;
  return Math.max(0, Math.min(MINUTES_PER_DAY - step, snapped));
}

function formatCountdown(diffMin: number): string {
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export const AlarmTimeline24h: React.FC<AlarmTimeline24hProps> = ({
  alarms,
  activeAlarm,
  now,
  onUpdateAlarmTime,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [snapStep, setSnapStep] = useState<SnapStep>(5);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreviewMin, setDragPreviewMin] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartMinRef = useRef<number>(0);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowPercent = (nowMinutes / MINUTES_PER_DAY) * 100;
  const nowLabel = minutesToTime(nowMinutes);

  // Assign non-overlapping vertical lanes for alarms that are close on the 24h bar
  const positionedAlarms = useMemo(() => {
    const items = alarms.map((alarm) => {
      const effectiveMin =
        draggingId === alarm.id && dragPreviewMin !== null
          ? dragPreviewMin
          : timeToMinutes(alarm.time);
      return {
        alarm,
        minutes: effectiveMin,
        percent: (effectiveMin / MINUTES_PER_DAY) * 100,
      };
    });

    const sorted = [...items].sort((a, b) => a.minutes - b.minutes);
    const laneEndMin: number[] = [];
    const laneMap = new Map<string, number>();

    for (const item of sorted) {
      let assignedLane = -1;
      for (let l = 0; l < laneEndMin.length; l++) {
        // Keep ~135 minutes spacing in the same visual lane to avoid tag overlap
        if (item.minutes - laneEndMin[l] >= 135) {
          assignedLane = l;
          laneEndMin[l] = item.minutes;
          break;
        }
      }
      if (assignedLane === -1) {
        assignedLane = Math.min(laneEndMin.length, 3);
        laneEndMin[assignedLane] = item.minutes;
      }
      laneMap.set(item.alarm.id, assignedLane);
    }

    const totalLanes = Math.max(1, laneEndMin.length);
    return {
      items: items.map((item) => ({
        ...item,
        lane: laneMap.get(item.alarm.id) ?? 0,
      })),
      totalLanes,
    };
  }, [alarms, draggingId, dragPreviewMin]);

  // Compute next upcoming enabled alarm relative to current time
  const nextUpcoming = useMemo(() => {
    const enabled = alarms.filter((a) => a.enabled);
    if (enabled.length === 0) return null;

    let best: { alarm: AlarmItem; diffMin: number } | null = null;
    for (const alarm of enabled) {
      const m = timeToMinutes(alarm.time);
      let diff = m - nowMinutes;
      if (diff <= 0) diff += MINUTES_PER_DAY;
      if (!best || diff < best.diffMin) {
        best = { alarm, diffMin: diff };
      }
    }
    return best;
  }, [alarms, nowMinutes]);

  const clientXToMinutes = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return snapMinutes(ratio * (MINUTES_PER_DAY - 1), snapStep);
    },
    [snapStep]
  );

  const handleMarkerPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    alarm: AlarmItem
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const initialMin = timeToMinutes(alarm.time);
    dragStartMinRef.current = initialMin;
    dragPointerIdRef.current = e.pointerId;
    setDraggingId(alarm.id);
    setDragPreviewMin(initialMin);
    setFocusedId(alarm.id);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if synthetic pointer event
    }
  };

  const handleMarkerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingId || dragPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    const nextMin = clientXToMinutes(e.clientX);
    setDragPreviewMin(nextMin);
  };

  const commitDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingId || dragPointerIdRef.current !== e.pointerId) return;
    const finalMin =
      dragPreviewMin !== null ? dragPreviewMin : clientXToMinutes(e.clientX);
    const idToUpdate = draggingId;
    const prevMin = dragStartMinRef.current;

    setDraggingId(null);
    setDragPreviewMin(null);
    dragPointerIdRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    if (finalMin !== prevMin) {
      onUpdateAlarmTime(idToUpdate, minutesToTime(finalMin));
    }
  };

  const handleMarkerKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    alarm: AlarmItem
  ) => {
    const step = e.shiftKey ? 30 : snapStep;
    const currentMin = timeToMinutes(alarm.time);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextMin = Math.min(MINUTES_PER_DAY - 1, currentMin + step);
      onUpdateAlarmTime(alarm.id, minutesToTime(nextMin));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextMin = Math.max(0, currentMin - step);
      onUpdateAlarmTime(alarm.id, minutesToTime(nextMin));
    }
  };

  const stageHeightPx = 56 + positionedAlarms.totalLanes * 36;

  return (
    <section
      aria-label="24-Hour Alarm Timeline"
      className="bg-white border border-slate-200 rounded-xl p-5"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <Clock className="w-4 h-4 text-slate-600 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">
              24-Hour Alarm Timeline
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Drag any alarm marker horizontally to re-time · Auto-syncs to ESP32 via Vercel Cloud
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            Now {nowLabel}
          </span>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <div
            className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg"
            role="group"
            aria-label="Drag snap interval"
          >
            {SNAP_OPTIONS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setSnapStep(step)}
                className={`px-2 py-1 text-[11px] font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                  snapStep === step
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {step}m snap
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline Track Area */}
      <div className="pt-5 pb-2 px-1 sm:px-3">
        <div
          ref={trackRef}
          className="relative select-none"
          style={{ height: `${stageHeightPx}px` }}
        >
          {/* Draggable Alarm Markers Region (above the 24h bar) */}
          {positionedAlarms.items.map(({ alarm, minutes, percent, lane }) => {
            const isDragging = draggingId === alarm.id;
            const isRinging = activeAlarm?.id === alarm.id;
            const isFocused = focusedId === alarm.id;
            const displayTime = minutesToTime(minutes);

            // Prevent marker label from clipping outside left/right edges
            const clampedAnchorPercent = Math.max(6, Math.min(94, percent));
            const topOffsetPx = lane * 34;

            return (
              <React.Fragment key={alarm.id}>
                {/* Vertical stem connecting marker down into the 24h bar */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute w-px transition-colors ${
                    isRinging
                      ? 'bg-red-500'
                      : isDragging
                        ? 'bg-blue-600 w-0.5'
                        : alarm.enabled
                          ? 'bg-slate-400'
                          : 'bg-slate-300 border-l border-dashed border-slate-300'
                  }`}
                  style={{
                    left: `${percent}%`,
                    top: `${topOffsetPx + 24}px`,
                    bottom: '22px',
                    transform: 'translateX(-50%)',
                    zIndex: isDragging ? 30 : 10,
                  }}
                />

                {/* Marker Dot Directly on the 24h Bar */}
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute w-2.5 h-2.5 rounded-full border-2 border-white transition-transform ${
                    isRinging
                      ? 'bg-red-600 scale-125'
                      : isDragging
                        ? 'bg-blue-600 scale-125'
                        : alarm.enabled
                          ? 'bg-slate-900'
                          : 'bg-slate-400'
                  }`}
                  style={{
                    left: `${percent}%`,
                    bottom: '22px',
                    transform: 'translate(-50%, 50%)',
                    zIndex: isDragging ? 35 : 15,
                  }}
                />

                {/* Interactive Draggable Handle */}
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={`${alarm.label} alarm time`}
                  aria-valuemin={0}
                  aria-valuemax={MINUTES_PER_DAY - 1}
                  aria-valuenow={minutes}
                  aria-valuetext={`${alarm.label} at ${displayTime}${alarm.enabled ? '' : ' (Disabled)'}`}
                  onPointerDown={(e) => handleMarkerPointerDown(e, alarm)}
                  onPointerMove={handleMarkerPointerMove}
                  onPointerUp={commitDrag}
                  onPointerCancel={commitDrag}
                  onFocus={() => setFocusedId(alarm.id)}
                  onBlur={() => setFocusedId((cur) => (cur === alarm.id ? null : cur))}
                  onKeyDown={(e) => handleMarkerKeyDown(e, alarm)}
                  className={`touch-none absolute inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-shadow ${
                    isRinging
                      ? 'bg-red-600 text-white border-red-700 shadow-sm'
                      : isDragging
                        ? 'bg-blue-600 text-white border-blue-700 shadow-md scale-[1.03]'
                        : alarm.enabled
                          ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800 shadow-xs'
                          : 'bg-slate-50 text-slate-500 border-slate-300 border-dashed hover:border-slate-400'
                  }`}
                  style={{
                    left: `${clampedAnchorPercent}%`,
                    top: `${topOffsetPx}px`,
                    transform: 'translateX(-50%)',
                    zIndex: isDragging ? 40 : isFocused ? 25 : 20,
                  }}
                  title={`Drag to re-time "${alarm.label}" (${displayTime}) · Arrow keys adjust by ${snapStep}m`}
                >
                  {isRinging ? (
                    <BellRing className="w-3 h-3 shrink-0" />
                  ) : (
                    <GripHorizontal className="w-3 h-3 opacity-60 shrink-0" />
                  )}
                  <span className="font-mono font-semibold tabular-nums">
                    {displayTime}
                  </span>
                  <span className="max-w-[84px] truncate hidden sm:inline">
                    {alarm.label}
                  </span>
                  {!alarm.enabled && (
                    <span className="text-[10px] opacity-75">(Off)</span>
                  )}
                </div>
              </React.Fragment>
            );
          })}

          {/* 24-Hour Circadian Bar */}
          <div
            className="absolute left-0 right-0 bottom-[16px] h-3.5 rounded-full border border-slate-200 overflow-hidden"
            style={{
              background:
                'linear-gradient(90deg, #1e293b 0%, #334155 19%, #fed7aa 26%, #e0f2fe 36%, #f8fafc 50%, #e0f2fe 66%, #fde68a 77%, #334155 86%, #1e293b 100%)',
            }}
          >
            {/* Subtle hourly tick lines inside bar */}
            {Array.from({ length: 23 }).map((_, idx) => {
              const hour = idx + 1;
              const isMajor = hour % 3 === 0;
              return (
                <div
                  key={hour}
                  aria-hidden="true"
                  className={`absolute top-0 bottom-0 ${
                    isMajor ? 'w-px bg-slate-900/20' : 'w-px bg-slate-900/10'
                  }`}
                  style={{ left: `${(hour / 24) * 100}%` }}
                />
              );
            })}
          </div>

          {/* Live Current-Time Vertical Indicator */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[10px] w-0.5 bg-amber-600"
            style={{
              left: `${nowPercent}%`,
              height: '26px',
              transform: 'translateX(-50%)',
              zIndex: 18,
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-amber-600 -translate-x-[2px] -translate-y-0.5" />
          </div>
        </div>

        {/* Hour Scale Labels (00:00 to 24:00) */}
        <div className="relative h-5 mt-0.5 select-none">
          {MAJOR_HOURS.map((h) => {
            const pct = (h / 24) * 100;
            const alignClass =
              h === 0
                ? 'translate-x-0'
                : h === 24
                  ? '-translate-x-full'
                  : '-translate-x-1/2';
            return (
              <span
                key={h}
                className={`absolute top-0 text-[10px] sm:text-[11px] font-mono text-slate-500 tabular-nums ${alignClass}`}
                style={{ left: `${pct}%` }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            );
          })}
        </div>
      </div>

      {/* Footer Meta Row: Circadian Key + Next Trigger Summary */}
      <div className="pt-3 mt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-700" aria-hidden="true" />
            Night
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-300" aria-hidden="true" />
            Dawn / Dusk
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-200 border border-slate-300" aria-hidden="true" />
            Day
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-0.5 bg-amber-600" aria-hidden="true" />
            Current Time
          </span>
        </div>

        <div className="font-mono text-[11px] text-slate-600 tabular-nums">
          {alarms.length === 0 ? (
            <span>No alarms placed on timeline yet</span>
          ) : nextUpcoming ? (
            <span>
              Next: <strong className="font-sans font-semibold text-slate-800">{nextUpcoming.alarm.label}</strong> at{' '}
              {nextUpcoming.alarm.time} (in {formatCountdown(nextUpcoming.diffMin)})
            </span>
          ) : (
            <span>All alarms currently disabled</span>
          )}
        </div>
      </div>
    </section>
  );
};
