import React, { useMemo, useState } from 'react';
import { Check, Code2, Copy, Download } from 'lucide-react';
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

const WIRING_ROWS = [
  { component: '0.96" OLED (SSD1306 I2C)', pin: 'SDA / SCL', esp32: 'GPIO 21 / GPIO 22', power: '3.3V & GND' },
  { component: 'SG90 Servo Motor (Head)', pin: 'PWM Signal (Orange)', esp32: 'GPIO 13', power: '5V (VIN) & GND' },
  { component: 'Piezo Buzzer (Alarm)', pin: 'Positive (+)', esp32: 'GPIO 14', power: 'GND (-)' },
  { component: 'HC-SR04 Ultrasonic Sensor', pin: 'TRIG / ECHO', esp32: 'GPIO 5 / GPIO 18', power: '5V & GND (1k/2k divider on ECHO)' },
  { component: 'Green Status LED', pin: 'Anode (+)', esp32: 'GPIO 26 (220Ω resistor)', power: 'Cathode to GND' },
  { component: 'Red Alert LED', pin: 'Anode (+)', esp32: 'GPIO 27 (220Ω resistor)', power: 'Cathode to GND' },
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

  const firmwareCode = useMemo(
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
    navigator.clipboard?.writeText(firmwareCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([firmwareCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ESP32_MiniFaceBot_${(settings.userName || 'Muhib').replace(/\s+/g, '')}.ino`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Hardware Pinout & Wiring Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          ESP32 Wiring Diagram &amp; Pinout Map
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Exact GPIO mapping matching your ESP32, 0.96&quot; OLED, SG90 Servo, HC-SR04, Buzzer, and Red/Green LEDs
        </p>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-4 font-medium">Component</th>
                <th className="py-2.5 px-4 font-medium">Module Pin</th>
                <th className="py-2.5 px-4 font-medium">ESP32 Pin</th>
                <th className="py-2.5 pl-4 font-medium">Power / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {WIRING_ROWS.map((row) => (
                <tr key={row.component} className="hover:bg-slate-50/70">
                  <td className="py-2.5 pr-4 font-semibold text-slate-900">
                    {row.component}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{row.pin}</td>
                  <td className="py-2.5 px-4 font-mono font-semibold text-blue-700">
                    {row.esp32}
                  </td>
                  <td className="py-2.5 pl-4 text-slate-600">{row.power}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Generated Arduino .ino Sketch */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Ready-to-Flash ESP32 Dual-Mode Sketch (.ino) · Built-In Hotspot Portal
              </h3>
              <p className="text-xs text-slate-500">
                Connects to Home WiFi ({hardware.wifiSsid || 'muhib'}) for live weather &amp; time AND creates Hotspot <span className="font-mono text-slate-800">FaceBot-{(settings.userName || 'Muhib').replace(/[^a-zA-Z0-9]/g, '')}</span> (pass: <span className="font-mono text-slate-800">12345678</span>) → open <span className="font-mono text-blue-700">http://192.168.4.1</span> on any phone!
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

        <pre className="mt-4 p-4 bg-slate-950 text-slate-100 rounded-lg text-[11px] leading-relaxed font-mono overflow-x-auto max-h-[520px] overflow-y-auto">
          <code>{firmwareCode}</code>
        </pre>
      </div>
    </div>
  );
};
