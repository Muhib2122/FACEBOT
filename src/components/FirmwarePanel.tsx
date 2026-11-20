import React, { useMemo, useState } from 'react';
import { Check, Code2, Copy, Cpu, Download } from 'lucide-react';
import {
  AlarmItem,
  BotSettings,
  CustomReaction,
  HardwareConfig,
  LocationConfig,
  PlaylistItem,
} from '../types';
import { generateEsp32Firmware } from '../utils/firmwareGenerator';

interface FirmwarePanelProps {
  settings: BotSettings;
  location: LocationConfig;
  hardware: HardwareConfig;
  alarms: AlarmItem[];
  playlist: PlaylistItem[];
  customReactions: CustomReaction[];
  utcOffsetSeconds?: number;
}

const ESP32_WIRING_ROWS = [
  {
    component: '0.96" OLED (SSD1306 I2C)',
    pin: 'SDA / SCL / VCC / GND',
    boardPin: 'GPIO 21 / 22 / 3.3V / GND',
    notes: '4 wires · I2C address 0x3C · Use 3.3V',
  },
  {
    component: 'Piezo Buzzer (Alarm & Chime)',
    pin: 'Positive (+) / Negative (-)',
    boardPin: 'GPIO 14 / GND',
    notes: '2 wires · Works with Passive & Active buzzers',
  },
  {
    component: '1× Green LED (No Resistor)',
    pin: 'Long leg (+) / Short leg (-)',
    boardPin: 'GPIO 26 / GND',
    notes: '2 wires · Direct 3.3V safe (Vf ~3.0–3.2V) · Mirrors onboard LED',
  },
  {
    component: 'ESP32 Power & Programming',
    pin: 'Micro-USB / USB-C',
    boardPin: '5V USB Port',
    notes: 'Select "ESP32 Dev Module" in Arduino IDE · Only 3 libraries needed',
  },
];

export const FirmwarePanel: React.FC<FirmwarePanelProps> = ({
  settings,
  location,
  hardware,
  alarms,
  playlist,
  customReactions,
  utcOffsetSeconds = 21600,
}) => {
  const [copied, setCopied] = useState(false);

  const esp32Code = useMemo(
    () =>
      generateEsp32Firmware(
        settings,
        location,
        hardware,
        alarms,
        playlist,
        customReactions,
        utcOffsetSeconds
      ),
    [settings, location, hardware, alarms, playlist, customReactions, utcOffsetSeconds]
  );

  const handleCopy = () => {
    navigator.clipboard?.writeText(esp32Code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([esp32Code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeUser = (settings.userName || 'Muhib').replace(/\s+/g, '');
    a.download = `FaceBot_ESP32_${safeUser}.ino`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const safeApName = `FaceBot-${(settings.userName || 'Muhib').replace(/[^a-zA-Z0-9]/g, '') || 'Muhib'}`;

  return (
    <div className="space-y-6">
      {/* Ultra-Clean Zero-Resistor ESP32 Wiring Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Single-Board ESP32 Minimal Wiring (8 Wires Total · Zero Resistors)
              </h3>
              <p className="text-xs text-slate-500">
                ESP32 + 0.96" SSD1306 OLED + Piezo Buzzer + 1× Green LED — No Arduino, No Servo, No HC-SR04, No Resistors
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
            Libraries: SSD1306 · GFX · ArduinoJson
          </span>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-4 font-medium">Component</th>
                <th className="py-2.5 px-4 font-medium">Module Pin</th>
                <th className="py-2.5 px-4 font-medium">ESP32 Pin</th>
                <th className="py-2.5 pl-4 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ESP32_WIRING_ROWS.map((row) => (
                <tr key={row.component} className="hover:bg-slate-50/70">
                  <td className="py-2.5 pr-4 font-semibold text-slate-900">
                    {row.component}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{row.pin}</td>
                  <td className="py-2.5 px-4 font-mono font-semibold text-blue-700">
                    {row.boardPin}
                  </td>
                  <td className="py-2.5 pl-4 text-slate-600">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Generated ESP32 .ino Sketch */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                ESP32 Arduino Sketch (.ino) — OLED + Buzzer + Green LED + Dual-Mode WiFi
              </h3>
              <p className="text-xs text-slate-500">
                Home WiFi (<span className="font-mono">{hardware.wifiSsid || 'muhib'}</span>) + Built-in Hotspot <span className="font-mono">{safeApName}</span> (pass: <span className="font-mono">12345678</span>) → <span className="font-mono">http://192.168.4.1</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Sketch
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download .ino
            </button>
          </div>
        </div>

        <pre className="mt-4 p-4 bg-slate-950 text-slate-100 rounded-lg text-[11px] leading-relaxed font-mono overflow-x-auto max-h-[540px] overflow-y-auto">
          <code>{esp32Code}</code>
        </pre>
      </div>
    </div>
  );
};
