import React, { useState } from 'react';
import {
  Cloud,
  Cpu,
  DownloadCloud,
  Eye,
  EyeOff,
  Lightbulb,
  Lock,
  RefreshCw,
  Save,
  Volume2,
  Wifi,
} from 'lucide-react';
import { CloudBackendType, GreenLedMode, HardwareConfig } from '../types';

interface HardwarePanelProps {
  hardware: HardwareConfig;
  onUpdateHardware: (patch: Partial<HardwareConfig>) => void;
  onChangeGreenLedMode: (mode: GreenLedMode) => void;
  onTestBuzzer: (mode?: 'tone' | 'happy' | 'dc') => void;
  onSaveWifiCredentials: (ssid: string, password: string) => void;
  wifiSaveStatus: string | null;
  onPingEsp32: () => Promise<void>;
  pingStatus: string | null;
  onPushCloudState: () => Promise<void>;
  onTriggerOtaUpdate: () => Promise<void>;
  cloudSyncStatus: string | null;
}

export const HardwarePanel: React.FC<HardwarePanelProps> = ({
  hardware,
  onUpdateHardware,
  onChangeGreenLedMode,
  onTestBuzzer,
  onSaveWifiCredentials,
  wifiSaveStatus,
  onPingEsp32,
  pingStatus,
  onPushCloudState,
  onTriggerOtaUpdate,
  cloudSyncStatus,
}) => {
  const [testingBuzzer, setTestingBuzzer] = useState(false);
  const [ssidInput, setSsidInput] = useState(hardware.wifiSsid);
  const [passInput, setPassInput] = useState(hardware.wifiPassword);
  const [showPassword, setShowPassword] = useState(false);

  const handleTestBuzzer = (mode: 'tone' | 'happy' | 'dc') => {
    setTestingBuzzer(true);
    onTestBuzzer(mode);
    setTimeout(() => setTestingBuzzer(false), 320);
  };

  const handleWifiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssidInput.trim()) return;
    onSaveWifiCredentials(ssidInput.trim(), passInput);
  };

  return (
    <div className="space-y-6">
      {/* Vercel Cloud Anywhere Control & GitHub OTA Auto-Update */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Vercel Cloud Anywhere Control &amp; Auto OTA Update
              </h3>
              <p className="text-xs text-slate-500">
                ESP32 stays on Home WiFi and polls your Vercel Web Portal every 1.2s on Core 0 — control from anywhere without joining ESP32 WiFi
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onUpdateHardware({ cloudSyncEnabled: !hardware.cloudSyncEnabled })
            }
            role="switch"
            aria-checked={hardware.cloudSyncEnabled}
            className={`w-10 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
              hardware.cloudSyncEnabled ? 'bg-blue-600' : 'bg-slate-200'
            }`}
          >
            <span
              className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                hardware.cloudSyncEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-4">
          <div className="md:col-span-5">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Published Vercel Portal URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={hardware.cloudPortalUrl}
                onChange={(e) => onUpdateHardware({ cloudPortalUrl: e.target.value })}
                placeholder="https://muhib-facebot.vercel.app"
                className="flex-1 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={() =>
                  onUpdateHardware({ cloudPortalUrl: window.location.origin })
                }
                className="px-2.5 py-2 text-[11px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                Use Current
              </button>
            </div>
          </div>

          <div className="md:col-span-4">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Cloud State Backend
            </label>
            <select
              value={hardware.cloudBackendType}
              onChange={(e) =>
                onUpdateHardware({
                  cloudBackendType: e.target.value as CloudBackendType,
                })
              }
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="vercel-api">Vercel Built-in API (/api/bot-state)</option>
              <option value="firebase-rtdb">Firebase Realtime DB (.json URL)</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Device ID
            </label>
            <input
              type="text"
              value={hardware.deviceId}
              onChange={(e) => onUpdateHardware({ deviceId: e.target.value })}
              placeholder="muhib-bot-1"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
            />
          </div>

          {hardware.cloudBackendType === 'firebase-rtdb' && (
            <div className="md:col-span-12">
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Firebase Realtime Database JSON URL (100% persistent free cloud state)
              </label>
              <input
                type="url"
                value={hardware.firebaseDbUrl}
                onChange={(e) => onUpdateHardware({ firebaseDbUrl: e.target.value })}
                placeholder="https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app/facebot/muhib-bot-1.json"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-4 pt-4 border-t border-slate-100 items-end">
          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Firmware Version
            </label>
            <input
              type="text"
              value={hardware.firmwareVersion}
              onChange={(e) => onUpdateHardware({ firmwareVersion: e.target.value })}
              placeholder="3.0.0"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg tabular-nums"
            />
          </div>

          <div className="md:col-span-4 flex items-center justify-between gap-3 py-2 px-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div>
              <div className="text-xs font-semibold text-slate-800">Auto-Check Vercel OTA</div>
              <div className="text-[11px] text-slate-500">Checks /ota/version.json on boot</div>
            </div>
            <button
              type="button"
              onClick={() => onUpdateHardware({ otaAutoCheck: !hardware.otaAutoCheck })}
              role="switch"
              aria-checked={hardware.otaAutoCheck}
              className={`w-10 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                hardware.otaAutoCheck ? 'bg-blue-600' : 'bg-slate-200'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                  hardware.otaAutoCheck ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="md:col-span-5 flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={onPushCloudState}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Push Live State
            </button>
            <button
              type="button"
              onClick={onTriggerOtaUpdate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              Trigger OTA Update
            </button>
          </div>
        </div>

        {cloudSyncStatus && (
          <p className="text-xs text-blue-700 mt-3">{cloudSyncStatus}</p>
        )}
      </div>

      {/* Home WiFi Configuration & Optional Local IP Bridge */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Home WiFi Configuration
              </h3>
              <p className="text-xs text-slate-500">
                ESP32 stays connected to your home WiFi (<span className="font-mono text-slate-700">{hardware.wifiSsid || 'muhib'}</span>) for Vercel Cloud Sync, Weather &amp; NTP Time
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-500">
            SSID: {hardware.wifiSsid}
          </span>
        </div>

        <form onSubmit={handleWifiSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-4 items-end">
          <div className="md:col-span-4">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Home WiFi Name (SSID)
            </label>
            <input
              type="text"
              required
              value={ssidInput}
              onChange={(e) => setSsidInput(e.target.value)}
              placeholder="muhib"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="md:col-span-5">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Home WiFi Password
            </label>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                placeholder="12345678"
                className="w-full pl-9 pr-9 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              Save Home WiFi
            </button>
          </div>
        </form>

        {wifiSaveStatus && (
          <p className="text-xs text-blue-700 mt-3">{wifiSaveStatus}</p>
        )}

        {/* Optional Local LAN IP Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-5 pt-4 border-t border-slate-100 items-end">
          <div className="md:col-span-9">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Optional Local LAN IP (Not needed when using Vercel Cloud Sync above)
            </label>
            <input
              type="text"
              value={hardware.esp32Ip}
              onChange={(e) => onUpdateHardware({ esp32Ip: e.target.value })}
              placeholder="http://192.168.1.50"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="button"
              onClick={onPingEsp32}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Cpu className="w-3.5 h-3.5" />
              Test Local IP
            </button>
          </div>
        </div>

        {pingStatus && (
          <p className="text-xs text-slate-600 mt-2.5">{pingStatus}</p>
        )}
      </div>

      {/* Minimal Hardware Controls: Single Green LED (GPIO 26) & Piezo Buzzer (GPIO 14) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-emerald-600" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Single Green LED (GPIO 26 · No Resistor)
                </h3>
                <p className="text-xs text-slate-500">
                  Long leg (+) → GPIO 26 · Short leg (−) → GND · Direct 3.3V safe
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-700 uppercase">
              {hardware.greenLedMode}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-4">
            {(
              [
                { id: 'auto', label: 'Auto' },
                { id: 'on', label: 'Always ON' },
                { id: 'blink', label: 'Blink' },
                { id: 'off', label: 'OFF' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeGreenLedMode(opt.id)}
                className={`px-3 py-2.5 text-xs font-semibold rounded-lg border transition-colors ${
                  hardware.greenLedMode === opt.id
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-blue-600" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Piezo Buzzer (GPIO 14)
                </h3>
                <p className="text-xs text-slate-500">
                  Positive (+) → GPIO 14 · Negative (−) → GND · Passive &amp; Active supported
                </p>
              </div>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {hardware.buzzerMuted ? 'Browser Muted' : 'Audio Ready'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5 pt-4">
            <button
              type="button"
              onClick={() => handleTestBuzzer('tone')}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-lg border transition-colors ${
                testingBuzzer
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              Beep Test
            </button>
            <button
              type="button"
              onClick={() => handleTestBuzzer('happy')}
              className="px-3 py-2.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100/70 rounded-lg transition-colors"
            >
              Happy Chime
            </button>
            <button
              type="button"
              onClick={() => handleTestBuzzer('dc')}
              className="px-3 py-2.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Active DC Beep
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
