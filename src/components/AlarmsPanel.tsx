import React, { useState } from 'react';
import { Bell, BellOff, BellRing, Plus, RefreshCw, Trash2, Volume2 } from 'lucide-react';
import { AlarmItem, FACE_DEFINITIONS } from '../types';
import { AlarmTimeline24h } from './AlarmTimeline24h';

interface AlarmsPanelProps {
  alarms: AlarmItem[];
  activeAlarm: AlarmItem | null;
  now: Date;
  esp32Ip: string;
  cloudSyncEnabled: boolean;
  buzzerMuted: boolean;
  alarmSyncMessage: string | null;
  onAddAlarm: (alarm: AlarmItem) => void;
  onToggleAlarm: (id: string) => void;
  onUpdateAlarmTime: (id: string, newTime: string) => void;
  onDeleteAlarm: (id: string) => void;
  onTestAlarm: (alarm: AlarmItem) => void;
  onTestBuzzerBeep: () => void;
  onDismissAlarm: () => void;
  onSnoozeAlarm: () => void;
  onSyncAllAlarmsToEsp32: () => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const AlarmsPanel: React.FC<AlarmsPanelProps> = ({
  alarms,
  activeAlarm,
  now,
  esp32Ip,
  cloudSyncEnabled,
  buzzerMuted,
  alarmSyncMessage,
  onAddAlarm,
  onToggleAlarm,
  onUpdateAlarmTime,
  onDeleteAlarm,
  onTestAlarm,
  onTestBuzzerBeep,
  onDismissAlarm,
  onSnoozeAlarm,
  onSyncAllAlarmsToEsp32,
}) => {
  const [time, setTime] = useState('07:30');
  const [label, setLabel] = useState('Morning Wake Up');
  const [faceId, setFaceId] = useState(19);
  const [melody, setMelody] = useState<AlarmItem['melody']>('classic');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!time) return;
    onAddAlarm({
      id: `al-${Date.now()}`,
      time,
      label: label.trim() || 'FaceBot Alarm',
      enabled: true,
      days: days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6],
      faceId,
      melody,
    });
    setLabel('');
  };

  return (
    <div className="space-y-6">
      {/* Live Ringing Banner inside Alarms Panel */}
      {activeAlarm && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BellRing className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-red-950 tabular-nums">
                Alarm Ringing Now · {activeAlarm.time}
              </h3>
              <p className="text-xs text-red-700 mt-0.5">
                {activeAlarm.label} · Piezo Buzzer (GPIO 14) &amp; Green LED (GPIO 26) Blinking
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSnoozeAlarm}
              className="px-3.5 py-2 text-xs font-semibold text-red-800 bg-white border border-red-200 hover:bg-red-100/60 rounded-lg transition-colors whitespace-nowrap"
            >
              Snooze 5 min
            </button>
            <button
              onClick={onDismissAlarm}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <BellOff className="w-3.5 h-3.5" />
              Dismiss Alarm
            </button>
          </div>
        </div>
      )}

      {/* Interactive 24-Hour Visual Alarm Timeline (Drag & Drop Re-Timing) */}
      <AlarmTimeline24h
        alarms={alarms}
        activeAlarm={activeAlarm}
        now={now}
        onUpdateAlarmTime={onUpdateAlarmTime}
      />

      {/* Add New Alarm Form */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Create Piezo Buzzer Alarm
              </h3>
              <p className="text-xs text-slate-500">
                Synced via Vercel Cloud to ESP32 GPIO 14 Bip-Bip buzzer, Green LED (GPIO 26), and 0.96&quot; OLED
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onTestBuzzerBeep}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5 text-blue-600" />
              Test Bip-Bip Sound
            </button>
            <button
              type="button"
              onClick={onSyncAllAlarmsToEsp32}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync Alarms Now
            </button>
          </div>
        </div>

        {alarmSyncMessage && (
          <p className="text-xs text-blue-700 mt-3">{alarmSyncMessage}</p>
        )}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-4">
          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Alarm Time
            </label>
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg tabular-nums"
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Alarm Label
            </label>
            <input
              type="text"
              maxLength={20}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Study Time, Fajr, Class"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Buzzer Melody
            </label>
            <select
              value={melody}
              onChange={(e) => setMelody(e.target.value as AlarmItem['melody'])}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="classic">Classic Piezo Beep</option>
              <option value="gentle">Gentle Chime</option>
              <option value="urgent">Urgent Siren</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Alarm Face
            </label>
            <select
              value={faceId}
              onChange={(e) => setFaceId(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              {FACE_DEFINITIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-9 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500 mr-1">Repeat:</span>
            {DAY_LABELS.map((dLabel, idx) => {
              const selected = days.includes(idx);
              return (
                <button
                  key={dLabel}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {dLabel}
                </button>
              );
            })}
          </div>

          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Alarm
            </button>
          </div>
        </form>
      </div>

      {/* Scheduled Alarms List */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Scheduled Alarms ({alarms.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Enable, disable, test, or dismiss alarms on both the portal simulator and connected ESP32
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            {cloudSyncEnabled
              ? 'Vercel Cloud Auto-Sync ON'
              : esp32Ip.trim()
                ? `ESP32 Target: ${esp32Ip.trim()}`
                : 'Browser Audio Ready'}
            {buzzerMuted ? ' · Browser Muted' : ''}
          </span>
        </div>

        {alarms.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 mt-4 border border-dashed border-slate-200 rounded-lg">
            No alarms configured yet. Add an alarm above to test the piezo buzzer.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 mt-3">
            {alarms.map((alarm) => {
              const faceName =
                FACE_DEFINITIONS.find((f) => f.id === alarm.faceId)?.name || 'Normal Blink';
              const isThisRinging = activeAlarm?.id === alarm.id;
              return (
                <div
                  key={alarm.id}
                  className="py-3.5 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => onToggleAlarm(alarm.id)}
                      role="switch"
                      aria-checked={alarm.enabled}
                      className={`w-10 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                        alarm.enabled ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                          alarm.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-lg font-bold font-mono text-slate-900 tabular-nums">
                          {alarm.time}
                        </span>
                        <span className="text-xs font-semibold text-slate-800">
                          {alarm.label}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500">
                          {alarm.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        <span>{alarm.melody} buzzer</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>Face: {faceName}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>
                          {alarm.days.length === 7
                            ? 'Every day'
                            : alarm.days.map((d) => DAY_LABELS[d]).join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isThisRinging ? (
                      <button
                        onClick={onDismissAlarm}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap"
                      >
                        <BellOff className="w-3.5 h-3.5" />
                        Dismiss
                      </button>
                    ) : (
                      <button
                        onClick={() => onTestAlarm(alarm)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                      >
                        <BellRing className="w-3.5 h-3.5" />
                        Test Ring
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteAlarm(alarm.id)}
                      aria-label="Delete alarm"
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-slate-100/80 border border-slate-200 rounded-xl p-4 flex items-center gap-3 text-xs text-slate-600">
        <Volume2 className="w-4 h-4 text-slate-700 shrink-0" />
        <span>
          Click <strong className="text-slate-900">Test Ring</strong> to immediately ring both your device speaker and ESP32 GPIO 14 Piezo Buzzer with a loud Bip-Bip alarm pattern + Green LED blink over Vercel Cloud.
        </span>
      </div>
    </div>
  );
};
