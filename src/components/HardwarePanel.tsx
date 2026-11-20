import React, { useState } from 'react';
import {
  Cpu,
  Eye,
  EyeOff,
  Lock,
  Radio,
  RotateCw,
  Save,
  Volume2,
  Wifi,
} from 'lucide-react';
import { HardwareConfig } from '../types';
import { playBuzzerTest } from '../utils/buzzerAudio';

interface HardwarePanelProps {
  hardware: HardwareConfig;
  currentServoAngle: number;
  servoPowered: boolean;
  userDetected: boolean;
  onUpdateHardware: (patch: Partial<HardwareConfig>) => void;
  onSaveWifiCredentials: (ssid: string, password: string) => void;
  wifiSaveStatus: string | null;
  onPingEsp32: () => Promise<void>;
  pingStatus: string | null;
}

export const HardwarePanel: React.FC<HardwarePanelProps> = ({
  hardware,
  currentServoAngle,
  servoPowered,
  userDetected,
  onUpdateHardware,
  onSaveWifiCredentials,
  wifiSaveStatus,
  onPingEsp32,
  pingStatus,
}) => {
  const [testingBuzzer, setTestingBuzzer] = useState(false);
  const [ssidInput, setSsidInput] = useState(hardware.wifiSsid);
  const [passInput, setPassInput] = useState(hardware.wifiPassword);
  const [showPassword, setShowPassword] = useState(false);

  const handleManualServoAngle = (angle: number) => {
    onUpdateHardware({
      servoManualOverride: true,
      servoAngle: Math.max(0, Math.min(180, angle)),
    });
  };

  const handleTestBuzzer = () => {
    setTestingBuzzer(true);
    playBuzzerTest(hardware.buzzerMuted);
    setTimeout(() => setTestingBuzzer(false), 320);
  };

  const handleWifiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssidInput.trim()) return;
    onSaveWifiCredentials(ssidInput.trim(), passInput);
  };

  return (
    <div className="space-y-6">
      {/* Admin Panel: Home WiFi SSID & Password Configuration */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Admin Panel · Home WiFi Configuration
              </h3>
              <p className="text-xs text-slate-500">
                Set your home WiFi SSID &amp; password (initial default: <span className="font-mono text-slate-700">muhib</span> / <span className="font-mono text-slate-700">12345678</span>) — saved to ESP32 flash &amp; firmware
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
              ESP32 Local IP Address (from Arduino Serial Monitor after WiFi connects)
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

      {/* SG90 Servo Motor & HC-SR04 Co-Mounted User Tracking */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <RotateCw className="w-4 h-4 text-slate-600" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  SG90 Servo Head Control
                </h3>
                <p className="text-xs text-slate-500">
                  0°–180° · Center 90° · GPIO 13 · {servoPowered ? 'Motor Powered ON' : 'Motor Idle OFF (90°)'}
                </p>
              </div>
            </div>
            <span className="text-sm font-mono font-bold text-slate-900 tabular-nums">
              {Math.round(currentServoAngle)}°
            </span>
          </div>

          <div className="pt-4 space-y-4">
            {/* Sync Mode Switch */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  Expressive Auto Head Movement
                </div>
                <div className="text-[11px] text-slate-500">
                  Happy sways 70°↔110°, Surprised tilts, Angry shakes, Sleepy droops
                </div>
              </div>
              <button
                onClick={() =>
                  onUpdateHardware({
                    servoManualOverride: !hardware.servoManualOverride,
                    servoAutoSync: hardware.servoManualOverride,
                  })
                }
                role="switch"
                aria-checked={!hardware.servoManualOverride}
                className={`w-10 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                  !hardware.servoManualOverride ? 'bg-blue-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                    !hardware.servoManualOverride ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Idle Servo Power Off at 90° Switch */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  Auto Servo OFF When No Object Found
                </div>
                <div className="text-[11px] text-slate-500">
                  Centers straight at 90° and detaches PWM (<code className="font-mono">headServo.detach()</code>) when nobody is in range
                </div>
              </div>
              <button
                onClick={() =>
                  onUpdateHardware({
                    servoPowerOffWhenIdle: !hardware.servoPowerOffWhenIdle,
                  })
                }
                role="switch"
                aria-checked={hardware.servoPowerOffWhenIdle}
                className={`w-10 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                  hardware.servoPowerOffWhenIdle ? 'bg-blue-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                    hardware.servoPowerOffWhenIdle ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Manual Servo Angle Slider */}
            <div className="pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-medium text-slate-700">Manual Angle Override</span>
                <span className="font-mono text-slate-600 tabular-nums">
                  {hardware.servoAngle}°
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={180}
                value={hardware.servoManualOverride ? hardware.servoAngle : Math.round(currentServoAngle)}
                onChange={(e) => handleManualServoAngle(Number(e.target.value))}
                className="w-full hw-slider"
              />
              <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-1 tabular-nums">
                <span>0° Left</span>
                <span>90° Straight</span>
                <span>180° Right</span>
              </div>
            </div>

            {/* Quick Angle Presets */}
            <div className="flex flex-wrap gap-2">
              {[0, 45, 70, 90, 110, 135, 180].map((deg) => (
                <button
                  key={deg}
                  onClick={() => handleManualServoAngle(deg)}
                  className={`px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg border transition-colors tabular-nums ${
                    hardware.servoManualOverride && hardware.servoAngle === deg
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {deg}°{deg === 90 ? ' Center' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* HC-SR04 Ultrasonic Sensor & Co-Mounted User Tracking */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-slate-600" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  HC-SR04 Proximity &amp; User Tracking
                </h3>
                <p className="text-xs text-slate-500">
                  OLED mounted above HC-SR04 · {userDetected ? 'User Locked in Range' : 'No Object — Looking Straight (90°)'}
                </p>
              </div>
            </div>
            <button
              onClick={() =>
                onUpdateHardware({ ultrasonicEnabled: !hardware.ultrasonicEnabled })
              }
              role="switch"
              aria-checked={hardware.ultrasonicEnabled}
              className={`w-10 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                hardware.ultrasonicEnabled ? 'bg-blue-600' : 'bg-slate-200'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                  hardware.ultrasonicEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="pt-4 space-y-4">
            {/* Follow User Direction Toggle */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  Face Detected User Direction
                </div>
                <div className="text-[11px] text-slate-500">
                  Turns OLED + HC-SR04 toward user inside tracking range; rests straight at 90° when empty
                </div>
              </div>
              <button
                onClick={() =>
                  onUpdateHardware({ trackingEnabled: !hardware.trackingEnabled })
                }
                disabled={!hardware.ultrasonicEnabled}
                role="switch"
                aria-checked={hardware.trackingEnabled}
                className={`w-10 h-6 rounded-full transition-colors p-0.5 shrink-0 disabled:opacity-40 ${
                  hardware.trackingEnabled ? 'bg-blue-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                    hardware.trackingEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-700">Sleep Wake Radius</span>
                  <span className="font-mono font-semibold text-blue-600 tabular-nums">
                    ≤ {hardware.wakeDistanceCm} cm
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={45}
                  disabled={!hardware.ultrasonicEnabled}
                  value={hardware.wakeDistanceCm}
                  onChange={(e) =>
                    onUpdateHardware({ wakeDistanceCm: Number(e.target.value) })
                  }
                  className="w-full hw-slider disabled:opacity-40"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-700">User Tracking Range</span>
                  <span className="font-mono font-semibold text-slate-800 tabular-nums">
                    ≤ {hardware.trackingRangeCm} cm
                  </span>
                </div>
                <input
                  type="range"
                  min={25}
                  max={100}
                  disabled={!hardware.ultrasonicEnabled || !hardware.trackingEnabled}
                  value={hardware.trackingRangeCm}
                  onChange={(e) =>
                    onUpdateHardware({ trackingRangeCm: Number(e.target.value) })
                  }
                  className="w-full hw-slider disabled:opacity-40"
                />
              </div>
            </div>

            {/* Physical Red/Green LEDs & Buzzer Test */}
            <div className="pt-4 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-800 mb-2.5">
                LED &amp; Piezo Buzzer Manual Test
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() =>
                    onUpdateHardware({
                      greenLedManual:
                        hardware.greenLedManual === true
                          ? false
                          : hardware.greenLedManual === false
                            ? null
                            : true,
                    })
                  }
                  className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    hardware.greenLedManual === true
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Green LED:{' '}
                  {hardware.greenLedManual === null
                    ? 'Auto'
                    : hardware.greenLedManual
                      ? 'ON'
                      : 'OFF'}
                </button>

                <button
                  onClick={() =>
                    onUpdateHardware({
                      redLedManual:
                        hardware.redLedManual === true
                          ? false
                          : hardware.redLedManual === false
                            ? null
                            : true,
                    })
                  }
                  className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    hardware.redLedManual === true
                      ? 'border-red-600 bg-red-50 text-red-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Red LED:{' '}
                  {hardware.redLedManual === null
                    ? 'Auto'
                    : hardware.redLedManual
                      ? 'ON'
                      : 'OFF'}
                </button>

                <button
                  onClick={handleTestBuzzer}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    testingBuzzer
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Beep Test
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
