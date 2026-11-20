import React, { useState } from 'react';
import {
  Cpu,
  Eye,
  EyeOff,
  Lightbulb,
  Lock,
  Save,
  Volume2,
  Wifi,
} from 'lucide-react';
import { GreenLedMode, HardwareConfig } from '../types';

interface HardwarePanelProps {
  hardware: HardwareConfig;
  onUpdateHardware: (patch: Partial<HardwareConfig>) => void;
  onChangeGreenLedMode: (mode: GreenLedMode) => void;
  onTestBuzzer: (mode?: 'tone' | 'happy' | 'dc') => void;
  onSaveWifiCredentials: (ssid: string, password: string) => void;
  wifiSaveStatus: string | null;
  onPingEsp32: () => Promise<void>;
  pingStatus: string | null;
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
      {/* Admin Panel: Home WiFi SSID & Password + ESP32 Direct Link */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Admin Panel · Home WiFi &amp; ESP32 Bridge
              </h3>
              <p className="text-xs text-slate-500">
                ESP32 joins Home WiFi (<span className="font-mono text-slate-700">muhib</span> / <span className="font-mono text-slate-700">12345678</span>) and broadcasts Hotspot <span className="font-mono text-slate-700">FaceBot-Muhib</span> at <span className="font-mono text-slate-700">http://192.168.4.1</span>
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Active SSID: {hardware.wifiSsid}
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
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              Save WiFi Settings
            </button>
          </div>
        </form>

        {wifiSaveStatus && (
          <p className="text-xs text-blue-700 mt-3">{wifiSaveStatus}</p>
        )}

        {/* ESP32 Local IP Bridge Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-5 pt-4 border-t border-slate-100 items-end">
          <div className="md:col-span-9">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              ESP32 IP Address (Paste Home WiFi IP shown on OLED or http://192.168.4.1 so AI Agent controls real hardware)
            </label>
            <input
              type="text"
              value={hardware.esp32Ip}
              onChange={(e) => onUpdateHardware({ esp32Ip: e.target.value })}
              placeholder="http://192.168.4.1 or http://192.168.1.50"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="button"
              onClick={onPingEsp32}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Cpu className="w-3.5 h-3.5" />
              Test ESP32 Link
            </button>
          </div>
        </div>

        {pingStatus && (
          <p className="text-xs text-slate-600 mt-2.5">{pingStatus}</p>
        )}
      </div>

      {/* Minimal Hardware Controls: Single Green LED (GPIO 26) & Piezo Buzzer (GPIO 14) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Green LED Card */}
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
          <p className="text-[11px] text-slate-500 mt-3">
            In Auto mode, the Green LED stays ON while FaceBot is awake, turns OFF during Sleep, and blinks rapidly when an Alarm rings.
          </p>
        </div>

        {/* Piezo Buzzer Card */}
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
          <p className="text-[11px] text-slate-500 mt-3">
            Software tone generator avoids all ESP32 timer conflicts. Works out of the box with both Passive melody buzzers and Active DC buzzers.
          </p>
        </div>
      </div>
    </div>
  );
};
