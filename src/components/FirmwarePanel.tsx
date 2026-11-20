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
import {
  generateArduinoMotionFirmware,
  generateEsp32Firmware,
} from '../utils/firmwareGenerator';

interface FirmwarePanelProps {
  settings: BotSettings;
  location: LocationConfig;
  hardware: HardwareConfig;
  alarms: AlarmItem[];
  playlist: PlaylistItem[];
  customReactions: CustomReaction[];
  utcOffsetSeconds?: number;
}

const ARDUINO_WIRING_ROWS = [
  { component: 'SG90 Servo Motor (Head)', pin: 'Orange / Red / Brown', boardPin: 'D9 / 5V / GND', notes: 'Native 5V PWM — zero jitter' },
  { component: 'HC-SR04 Ultrasonic Sensor', pin: 'TRIG / ECHO / VCC / GND', boardPin: 'D6 / D7 / 5V / GND', notes: 'Native 5V — no resistor needed' },
  { component: 'ESP32 Sync (RX ← TX2)', pin: 'Arduino D10 (RX)', boardPin: 'ESP32 GPIO 17 (TX2)', notes: 'Direct wire' },
  { component: 'ESP32 Sync (TX → RX2)', pin: 'Arduino D11 (TX)', boardPin: 'ESP32 GPIO 16 (RX2)', notes: 'Via 1kΩ + 2kΩ voltage divider' },
  { component: 'Common Ground', pin: 'Arduino GND', boardPin: 'ESP32 GND', notes: 'Required for UART sync' },
];

const ESP32_WIRING_ROWS = [
  { component: '0.96" OLED (SSD1306 I2C)', pin: 'SDA / SCL / VCC / GND', boardPin: 'GPIO 21 / 22 / 3.3V / GND', notes: 'I2C address 0x3C' },
  { component: 'Piezo Buzzer (Alarm)', pin: 'Positive (+) / Negative (-)', boardPin: 'GPIO 14 / GND', notes: 'Supports Passive & Active' },
  { component: 'Green Status LED', pin: 'Long Leg (+) / Short Leg (-)', boardPin: 'GPIO 26 (220Ω) / GND', notes: 'Mirrored on onboard GPIO 2' },
  { component: 'Red Alert LED', pin: 'Long Leg (+) / Short Leg (-)', boardPin: 'GPIO 27 (220Ω) / GND', notes: 'Alert / Cold / Angry' },
  { component: 'Arduino UART2 Link', pin: 'RX2 / TX2 / GND', boardPin: 'GPIO 16 / GPIO 17 / GND', notes: '9600 baud live sync' },
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
  const [selectedBoard, setSelectedBoard] = useState<'arduino' | 'esp32'>('arduino');
  const [copied, setCopied] = useState(false);

  const arduinoCode = useMemo(
    () => generateArduinoMotionFirmware(hardware),
    [hardware]
  );

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

  const activeCode = selectedBoard === 'arduino' ? arduinoCode : esp32Code;
  const activeWiring = selectedBoard === 'arduino' ? ARDUINO_WIRING_ROWS : ESP32_WIRING_ROWS;

  const handleCopy = () => {
    navigator.clipboard?.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([activeCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeUser = (settings.userName || 'Muhib').replace(/\s+/g, '');
    a.download =
      selectedBoard === 'arduino'
        ? `FaceBot_Arduino_ServoSensor_${safeUser}.ino`
        : `FaceBot_ESP32_BrainPortal_${safeUser}.ino`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Dual-MCU Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Dual-MCU Architecture (Arduino Uno/Nano + ESP32)
              </h3>
              <p className="text-xs text-slate-500">
                Arduino handles native 5V Servo + HC-SR04 tracking; ESP32 handles OLED + Hotspot Web Portal + LEDs + Buzzer over UART2
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              onClick={() => {
                setSelectedBoard('arduino');
                setCopied(false);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                selectedBoard === 'arduino'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              1. Arduino (Servo + HC-SR04)
            </button>
            <button
              onClick={() => {
                setSelectedBoard('esp32');
                setCopied(false);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                selectedBoard === 'esp32'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              2. ESP32 (OLED + Web + LEDs + Buzzer)
            </button>
          </div>
        </div>

        {/* Wiring Table for Selected Board */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-4 font-medium">Component</th>
                <th className="py-2.5 px-4 font-medium">Module Pin</th>
                <th className="py-2.5 px-4 font-medium">
                  {selectedBoard === 'arduino' ? 'Arduino / Link Pin' : 'ESP32 Pin'}
                </th>
                <th className="py-2.5 pl-4 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeWiring.map((row) => (
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

      {/* Live Generated .ino Sketch */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {selectedBoard === 'arduino'
                  ? 'Step 1: Arduino Uno/Nano Sketch (.ino) — SG90 Servo + HC-SR04'
                  : 'Step 2: ESP32 Sketch (.ino) — OLED + Hotspot Portal + LEDs + Buzzer'}
              </h3>
              <p className="text-xs text-slate-500">
                {selectedBoard === 'arduino'
                  ? 'Zero external libraries needed. Smooth non-blocking servo tracking, median-filtered HC-SR04, auto idle power-off, and 9600-baud UART sync.'
                  : `Connects to Home WiFi (${hardware.wifiSsid || 'muhib'}) + Hotspot FaceBot-${(settings.userName || 'Muhib').replace(/[^a-zA-Z0-9]/g, '')} (12345678) → http://192.168.4.1`}
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
          <code>{activeCode}</code>
        </pre>
      </div>
    </div>
  );
};
