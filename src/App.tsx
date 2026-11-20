import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CloudSun,
  Code2,
  Cpu,
  Download,
  Menu,
  PenTool,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  ActiveScreenState,
  AlarmItem,
  BotMode,
  BotSettings,
  CustomReaction,
  FACE_DEFINITIONS,
  HardwareConfig,
  LocationConfig,
  NavSection,
  PlaylistItem,
  ServoMotionStyle,
  WeatherData,
} from './types';
import { PRESET_CITIES, fetchLiveWeather } from './utils/weatherApi';
import { playAlarmMelody, playShortClick, playWakeChime } from './utils/buzzerAudio';
import { generateEsp32Firmware } from './utils/firmwareGenerator';
import { OledHardwareStage } from './components/OledHardwareStage';
import { ControlPanel } from './components/ControlPanel';
import { TouchpadStudio } from './components/TouchpadStudio';
import { WeatherProfilePanel } from './components/WeatherProfilePanel';
import { AlarmsPanel } from './components/AlarmsPanel';
import { HardwarePanel } from './components/HardwarePanel';
import { FirmwarePanel } from './components/FirmwarePanel';

const STORAGE_KEY = 'facebot_esp32_portal_v1';

const DEFAULT_SETTINGS: BotSettings = {
  userName: 'Muhib',
  coldThresholdC: 18,
  hotThresholdC: 34,
  autoSleepTimeoutSec: 90,
  use24HourClock: false,
  wakeGreetingPrefix: 'Hi',
};

const DEFAULT_LOCATION: LocationConfig = PRESET_CITIES[0]; // Dhaka

const DEFAULT_HARDWARE: HardwareConfig = {
  servoManualOverride: false,
  servoAngle: 90,
  servoAutoSync: true,
  servoPowerOffWhenIdle: true,
  ultrasonicEnabled: true,
  trackingEnabled: true,
  wakeDistanceCm: 25,
  trackingRangeCm: 60,
  simulatedDistanceCm: 75,
  simulatedUserAngle: 90,
  buzzerMuted: false,
  redLedManual: null,
  greenLedManual: null,
  oledScheme: 'ice-blue',
  animationSpeed: 'normal',
  esp32Ip: '',
  esp32Connected: false,
  wifiSsid: 'muhib',
  wifiPassword: '12345678',
};

const DEFAULT_PLAYLIST: PlaylistItem[] = [
  { id: 'pl-1', kind: 'watch', label: 'Watch UI & Date', durationSec: 8, enabled: true },
  { id: 'pl-2', kind: 'face', label: 'Face: Normal Blink', durationSec: 5, faceId: 0, enabled: true },
  { id: 'pl-3', kind: 'weather', label: 'Live Weather & Reaction', durationSec: 6, enabled: true },
  { id: 'pl-4', kind: 'greeting', label: 'Time-of-Day Greeting', durationSec: 5, enabled: true },
  { id: 'pl-5', kind: 'face', label: 'Face: Super Happy', durationSec: 5, faceId: 1, enabled: true },
  { id: 'pl-6', kind: 'face', label: 'Face: Kawaii Cat', durationSec: 5, faceId: 15, enabled: true },
];

const DEFAULT_ALARMS: AlarmItem[] = [
  {
    id: 'al-default-1',
    time: '07:00',
    label: 'Good Morning Muhib',
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
    faceId: 1,
    melody: 'classic',
  },
];

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'control', label: 'Live Control', icon: SlidersHorizontal },
  { id: 'touchpad', label: 'OLED Touchpad', icon: PenTool },
  { id: 'weather', label: 'Weather & Profile', icon: CloudSun },
  { id: 'alarms', label: 'Alarms & Buzzer', icon: Bell },
  { id: 'hardware', label: 'Admin & Hardware', icon: Cpu },
  { id: 'firmware', label: 'ESP32 Firmware', icon: Code2 },
];

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function App() {
  const saved = useMemo(() => loadSavedState(), []);

  const [navSection, setNavSection] = useState<NavSection>('control');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mode, setMode] = useState<BotMode>(saved?.mode ?? 'auto');
  const [settings, setSettings] = useState<BotSettings>({
    ...DEFAULT_SETTINGS,
    ...(saved?.settings ?? {}),
  });
  const [location, setLocation] = useState<LocationConfig>({
    ...DEFAULT_LOCATION,
    ...(saved?.location ?? {}),
  });
  const [hardware, setHardware] = useState<HardwareConfig>({
    ...DEFAULT_HARDWARE,
    ...(saved?.hardware ?? {}),
  });
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(
    Array.isArray(saved?.playlist) && saved.playlist.length > 0 ? saved.playlist : DEFAULT_PLAYLIST
  );
  const [alarms, setAlarms] = useState<AlarmItem[]>(
    Array.isArray(saved?.alarms) ? saved.alarms : DEFAULT_ALARMS
  );
  const [customReactions, setCustomReactions] = useState<CustomReaction[]>(
    Array.isArray(saved?.customReactions) ? saved.customReactions : []
  );

  // Live Runtime States
  const [frame, setFrame] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [isSleeping, setIsSleeping] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<string | null>(null);
  const [alarmSyncMessage, setAlarmSyncMessage] = useState<string | null>(null);
  const [wifiSaveStatus, setWifiSaveStatus] = useState<string | null>(null);

  const [activeScreen, setActiveScreen] = useState<ActiveScreenState>({
    kind: 'face',
    faceId: 0,
    locked: false,
  });

  const [activeAlarm, setActiveAlarm] = useState<AlarmItem | null>(null);
  const lastAlarmMinuteRef = useRef<string>('');
  const autoStepRef = useRef(0);
  const userStepRef = useRef(0);
  const wakeTimerRef = useRef<number | null>(null);

  // Persist user configuration to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mode,
          settings,
          location,
          hardware: { ...hardware, simulatedDistanceCm: 75 },
          playlist,
          alarms,
          customReactions,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [mode, settings, location, hardware, playlist, alarms, customReactions]);

  // Send live HTTP command to real ESP32 over LAN if IP is configured
  const sendToEsp32 = useCallback(
    (path: string) => {
      const ip = hardware.esp32Ip.trim();
      if (!ip) return;
      const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
      fetch(`${base}${path}`, { mode: 'no-cors' }).catch(() => {});
    },
    [hardware.esp32Ip]
  );

  // Fetch Live Weather from Open-Meteo whenever location changes
  const refreshWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const data = await fetchLiveWeather(location);
      setWeather(data);
    } catch {
      setWeatherError('Could not reach Open-Meteo weather API. Check internet connection.');
    } finally {
      setWeatherLoading(false);
    }
  }, [location]);

  useEffect(() => {
    refreshWeather();
    const interval = window.setInterval(refreshWeather, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshWeather]);

  // Animation Frame Tick respecting user-selected Animation Speed
  useEffect(() => {
    const ms =
      hardware.animationSpeed === 'fast'
        ? 130
        : hardware.animationSpeed === 'slow'
          ? 360
          : 220;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % 10000);
    }, ms);
    return () => window.clearInterval(id);
  }, [hardware.animationSpeed]);

  // 1-Second Clock & Real Alarm Checker
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = new Date();
      setNow(current);

      const hh = String(current.getHours()).padStart(2, '0');
      const mm = String(current.getMinutes()).padStart(2, '0');
      const key = `${hh}:${mm}`;
      const dayIdx = current.getDay();

      if (key !== lastAlarmMinuteRef.current && current.getSeconds() < 3) {
        const matched = alarms.find(
          (a) => a.enabled && a.time === key && a.days.includes(dayIdx)
        );
        if (matched) {
          lastAlarmMinuteRef.current = key;
          setIsSleeping(false);
          setActiveAlarm(matched);
          setActiveScreen({
            kind: 'alarm',
            faceId: matched.faceId,
            alarmId: matched.id,
            locked: true,
          });
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [alarms]);

  // Repeating Piezo Buzzer when an alarm is actively ringing
  useEffect(() => {
    if (!activeAlarm) return;
    playAlarmMelody(activeAlarm.melody, hardware.buzzerMuted);
    const id = window.setInterval(() => {
      playAlarmMelody(activeAlarm.melody, hardware.buzzerMuted);
    }, 1600);
    return () => window.clearInterval(id);
  }, [activeAlarm, hardware.buzzerMuted]);

  // Auto Mode & User Mode Screen Sequencer
  useEffect(() => {
    if (isSleeping || activeAlarm || activeScreen.locked || activeScreen.kind === 'proximity-wake') {
      return;
    }

    if (mode === 'auto') {
      // Auto Mode sequence: alternates Watch, Weather (with cold reaction), Greeting, and rotating 25 faces
      const stepMs = 5500;
      const timer = window.setTimeout(() => {
        const step = autoStepRef.current;
        autoStepRef.current += 1;

        const isCold = weather !== null && weather.temperature <= settings.coldThresholdC;

        if (step % 5 === 0) {
          setActiveScreen({ kind: 'watch', faceId: 0, locked: false });
        } else if (step % 5 === 1) {
          if (isCold) {
            setActiveScreen({ kind: 'weather', faceId: 3, locked: false });
          } else {
            setActiveScreen({ kind: 'weather', faceId: 0, locked: false });
          }
        } else if (step % 5 === 2) {
          setActiveScreen({ kind: 'greeting', faceId: 1, locked: false });
        } else {
          // Cycle smoothly across all 25 expressions (skipping 7=Sleepy while awake)
          const awakeFaces = FACE_DEFINITIONS.filter((f) => f.id !== 7);
          const pick = awakeFaces[Math.floor(step / 2) % awakeFaces.length];
          setActiveScreen({ kind: 'face', faceId: pick.id, locked: false });
        }
      }, stepMs);

      return () => window.clearTimeout(timer);
    }

    // User Mode: Follow exact custom playlist durations
    const enabledItems = playlist.filter((item) => item.enabled);
    if (enabledItems.length === 0) return;

    const currentIdx = userStepRef.current % enabledItems.length;
    const currentItem = enabledItems[currentIdx];

    const timer = window.setTimeout(() => {
      userStepRef.current = (currentIdx + 1) % enabledItems.length;
      const nextItem = enabledItems[userStepRef.current];
      setActiveScreen({
        kind: nextItem.kind,
        faceId: nextItem.faceId ?? 0,
        customReactionId: nextItem.customReactionId,
        textLine1: nextItem.textMessage,
        locked: false,
      });
    }, Math.max(2, currentItem.durationSec) * 1000);

    return () => window.clearTimeout(timer);
  }, [
    mode,
    isSleeping,
    activeAlarm,
    activeScreen,
    playlist,
    weather,
    settings.coldThresholdC,
  ]);

  // Trigger Proximity Wake-Up Sequence (HC-SR04 <= wakeDistanceCm)
  const triggerProximityWake = useCallback(() => {
    if (!hardware.ultrasonicEnabled) return;
    setIsSleeping(false);
    playWakeChime(hardware.buzzerMuted);
    const happyFace = Math.random() > 0.5 ? 1 : 4; // Super Happy or In Love
    setActiveScreen({
      kind: 'proximity-wake',
      faceId: happyFace,
      locked: false,
    });
    sendToEsp32(`/api/face?id=${happyFace}`);

    if (wakeTimerRef.current) window.clearTimeout(wakeTimerRef.current);
    wakeTimerRef.current = window.setTimeout(() => {
      setActiveScreen({ kind: 'face', faceId: 0, locked: false });
    }, 4500);
  }, [hardware.ultrasonicEnabled, hardware.buzzerMuted, sendToEsp32]);

  // Monitor simulated HC-SR04 distance changes
  const handleDistanceChange = (cm: number) => {
    setHardware((prev) => ({ ...prev, simulatedDistanceCm: cm }));
    if (hardware.ultrasonicEnabled && isSleeping && cm <= hardware.wakeDistanceCm) {
      triggerProximityWake();
    }
  };

  const handleWaveHand = () => {
    if (!hardware.ultrasonicEnabled) return;
    setHardware((prev) => ({
      ...prev,
      simulatedDistanceCm: Math.max(8, prev.wakeDistanceCm - 8),
    }));
    triggerProximityWake();
    window.setTimeout(() => {
      setHardware((prev) => ({ ...prev, simulatedDistanceCm: 75 }));
    }, 2400);
  };

  const handlePutToSleep = () => {
    setActiveAlarm(null);
    setIsSleeping(true);
    setActiveScreen({ kind: 'face', faceId: 7, locked: false });
    sendToEsp32('/api/face?id=7');
  };

  const handleWakeUp = () => {
    triggerProximityWake();
  };

  // Detect if user/object is currently inside HC-SR04 tracking range
  const userDetected =
    hardware.ultrasonicEnabled &&
    hardware.simulatedDistanceCm <= hardware.trackingRangeCm;

  // Compute Expressive SG90 Servo Head Angle (0°..180°, center 90°) + Idle Servo Power-Off
  const { currentServoAngle, servoPowered } = useMemo(() => {
    if (hardware.servoManualOverride) {
      return { currentServoAngle: hardware.servoAngle, servoPowered: true };
    }

    if (!hardware.servoAutoSync) {
      return {
        currentServoAngle: 90,
        servoPowered: !hardware.servoPowerOffWhenIdle,
      };
    }

    // No object detected & idle (not alarming, not waking, not locked to an active reaction)
    const isIdleNoObject =
      !userDetected &&
      !activeAlarm &&
      activeScreen.kind !== 'proximity-wake' &&
      (!activeScreen.locked || activeScreen.kind === 'watch' || activeScreen.kind === 'weather' || isSleeping);

    if (isIdleNoObject && hardware.servoPowerOffWhenIdle) {
      return { currentServoAngle: 90, servoPowered: false };
    }

    let style: ServoMotionStyle = 'center';
    if (activeAlarm) {
      style = 'angry-shake';
    } else if (isSleeping) {
      style = 'sleepy-droop';
    } else if (activeScreen.kind === 'proximity-wake') {
      style = 'happy-sway';
    } else if (activeScreen.kind === 'custom-bitmap') {
      const cr = customReactions.find((r) => r.id === activeScreen.customReactionId);
      style = cr?.servoStyle ?? 'center';
    } else if (
      activeScreen.kind === 'weather' &&
      weather &&
      weather.temperature <= settings.coldThresholdC
    ) {
      style = 'shiver';
    } else if (activeScreen.kind === 'face') {
      const def = FACE_DEFINITIONS.find((f) => f.id === activeScreen.faceId);
      style = def?.servoStyle ?? 'center';
    }

    // Anchor head around tracked user direction when detected; otherwise 90° straight
    const base =
      userDetected && hardware.trackingEnabled ? hardware.simulatedUserAngle : 90;
    const clampAngle = (a: number) => Math.max(15, Math.min(165, a));

    let targetAngle = base;
    switch (style) {
      case 'happy-sway':
        targetAngle = clampAngle(frame % 4 < 2 ? base - 20 : base + 20);
        break;
      case 'surprised-tilt':
        targetAngle = clampAngle(base + 24);
        break;
      case 'angry-shake':
        targetAngle = clampAngle(frame % 2 === 0 ? base - 18 : base + 18);
        break;
      case 'sleepy-droop':
        targetAngle = clampAngle(base + 16);
        break;
      case 'shiver':
        targetAngle = clampAngle(frame % 2 === 0 ? base - 6 : base + 6);
        break;
      case 'look-around': {
        const offsets = [-24, 0, 24];
        targetAngle = clampAngle(base + offsets[Math.floor(frame / 3) % 3]);
        break;
      }
      case 'center':
      default:
        targetAngle = base;
        break;
    }

    const activeMotion = style !== 'center' || userDetected;
    return {
      currentServoAngle: targetAngle,
      servoPowered: activeMotion || !hardware.servoPowerOffWhenIdle,
    };
  }, [
    hardware.servoManualOverride,
    hardware.servoAutoSync,
    hardware.servoAngle,
    hardware.servoPowerOffWhenIdle,
    hardware.trackingEnabled,
    hardware.simulatedUserAngle,
    userDetected,
    activeAlarm,
    isSleeping,
    activeScreen,
    customReactions,
    weather,
    settings.coldThresholdC,
    frame,
  ]);

  // Compute Red & Green Physical LED States
  const isColdAlert = weather !== null && weather.temperature <= settings.coldThresholdC;
  const greenLedOn =
    hardware.greenLedManual !== null
      ? hardware.greenLedManual
      : !activeAlarm && !isSleeping;
  const redLedOn =
    hardware.redLedManual !== null
      ? hardware.redLedManual
      : Boolean(activeAlarm)
        ? frame % 2 === 0
        : (activeScreen.kind === 'face' &&
            (activeScreen.faceId === 5 || activeScreen.faceId === 19)) ||
          (activeScreen.kind === 'weather' && isColdAlert);

  // Handlers
  const handleSelectFace = (faceId: number) => {
    playShortClick(hardware.buzzerMuted);
    setActiveAlarm(null);
    setIsSleeping(faceId === 7);
    setActiveScreen({ kind: 'face', faceId, locked: true });
    sendToEsp32(`/api/face?id=${faceId}`);
  };

  const handleSelectSpecialScreen = (kind: 'watch' | 'weather' | 'greeting') => {
    playShortClick(hardware.buzzerMuted);
    setActiveAlarm(null);
    setIsSleeping(false);
    setActiveScreen({ kind, faceId: 0, locked: true });
    sendToEsp32(`/api/screen?kind=${kind}`);
  };

  const handleSendQuickText = (line1: string, line2: string) => {
    playShortClick(hardware.buzzerMuted);
    setActiveAlarm(null);
    setIsSleeping(false);
    setActiveScreen({
      kind: 'custom-text',
      faceId: 0,
      textLine1: line1,
      textLine2: line2,
      locked: true,
    });
    sendToEsp32(
      `/api/screen?kind=text&l1=${encodeURIComponent(line1)}&l2=${encodeURIComponent(line2)}`
    );
  };

  const handlePushLivePixels = (pixels: number[]) => {
    const tempId = 'live-touchpad-preview';
    const liveObj: CustomReaction = {
      id: tempId,
      name: 'Live Touchpad',
      createdAt: Date.now(),
      pixels,
      servoStyle: 'happy-sway',
    };
    setCustomReactions((prev) => {
      const withoutTemp = prev.filter((r) => r.id !== tempId);
      return [liveObj, ...withoutTemp];
    });
    setActiveAlarm(null);
    setIsSleeping(false);
    setActiveScreen({
      kind: 'custom-bitmap',
      faceId: 0,
      customReactionId: tempId,
      locked: true,
    });
    playShortClick(hardware.buzzerMuted);
  };

  const handleSaveReaction = (reaction: CustomReaction) => {
    setCustomReactions((prev) => [
      reaction,
      ...prev.filter((r) => r.id !== 'live-touchpad-preview'),
    ]);
  };

  const handleDisplayReaction = (reaction: CustomReaction) => {
    setActiveAlarm(null);
    setIsSleeping(false);
    setActiveScreen({
      kind: 'custom-bitmap',
      faceId: 0,
      customReactionId: reaction.id,
      locked: true,
    });
    playShortClick(hardware.buzzerMuted);
  };

  const handleDeleteReaction = (id: string) => {
    setCustomReactions((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSimulateColdWeather = () => {
    setWeather((prev) => ({
      temperature: 10.5,
      apparentTemperature: 8.2,
      humidity: prev?.humidity ?? 78,
      windSpeed: prev?.windSpeed ?? 16,
      weatherCode: 3,
      conditionLabel: 'Cold Breeze',
      isDay: true,
      elevation: location.altitude,
      utcOffsetSeconds: prev?.utcOffsetSeconds ?? 21600,
      timezone: prev?.timezone ?? location.timezone,
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSimulatedCold: true,
    }));
    setIsSleeping(false);
    setActiveScreen({ kind: 'weather', faceId: 3, locked: true });
    playShortClick(hardware.buzzerMuted);
  };

  const syncSingleAlarmSlot = useCallback(
    (alarm: AlarmItem, slot: number) => {
      const [hh, mm] = alarm.time.split(':').map(Number);
      const melodyCode = alarm.melody === 'gentle' ? 1 : alarm.melody === 'urgent' ? 2 : 0;
      sendToEsp32(
        `/api/alarm/set?slot=${slot}&hour=${hh || 0}&min=${mm || 0}&on=${alarm.enabled ? 1 : 0}&face=${alarm.faceId}&melody=${melodyCode}&label=${encodeURIComponent(alarm.label)}`
      );
    },
    [sendToEsp32]
  );

  const handleAddAlarm = (alarm: AlarmItem) => {
    setAlarms((prev) => {
      const next = [alarm, ...prev];
      next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
      return next;
    });
    setAlarmSyncMessage(
      hardware.esp32Ip.trim()
        ? `Alarm ${alarm.time} saved and synced to ESP32.`
        : `Alarm ${alarm.time} saved locally and embedded in your ESP32 firmware.`
    );
  };

  const handleToggleAlarm = (id: string) => {
    setAlarms((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a));
      next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
      return next;
    });
  };

  const handleDeleteAlarm = (id: string) => {
    if (activeAlarm?.id === id) {
      handleDismissAlarm();
    }
    setAlarms((prev) => {
      const next = prev.filter((a) => a.id !== id);
      next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
      return next;
    });
  };

  const handleTestAlarm = (alarm: AlarmItem) => {
    setIsSleeping(false);
    setActiveAlarm(alarm);
    setActiveScreen({
      kind: 'alarm',
      faceId: alarm.faceId,
      alarmId: alarm.id,
      locked: true,
    });
    const slot = Math.max(0, alarms.findIndex((a) => a.id === alarm.id));
    sendToEsp32(`/api/alarm/test?slot=${slot}`);
  };

  const handleDismissAlarm = () => {
    setActiveAlarm(null);
    setActiveScreen({ kind: 'face', faceId: 0, locked: false });
    sendToEsp32('/api/alarm/dismiss');
  };

  const handleSnoozeAlarm = () => {
    if (!activeAlarm) return;
    const snoozeDate = new Date(Date.now() + 5 * 60 * 1000);
    const hh = String(snoozeDate.getHours()).padStart(2, '0');
    const mm = String(snoozeDate.getMinutes()).padStart(2, '0');
    const snoozeTime = `${hh}:${mm}`;
    const snoozedAlarm: AlarmItem = {
      ...activeAlarm,
      id: `al-snooze-${Date.now()}`,
      time: snoozeTime,
      label: `${activeAlarm.label.slice(0, 12)} (Snooze)`,
      enabled: true,
    };
    setActiveAlarm(null);
    setActiveScreen({ kind: 'face', faceId: 7, locked: false });
    sendToEsp32('/api/alarm/dismiss');
    handleAddAlarm(snoozedAlarm);
    setAlarmSyncMessage(`Snoozed for 5 minutes — next ring at ${snoozeTime}.`);
  };

  const handleSyncAllAlarmsToEsp32 = () => {
    alarms.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
    setAlarmSyncMessage(
      hardware.esp32Ip.trim()
        ? `Dispatched ${Math.min(alarms.length, 8)} alarm(s) to ${hardware.esp32Ip.trim()}.`
        : 'Add your ESP32 local IP in Hardware & Servo to push alarms live over WiFi.'
    );
  };

  const handleUpdateHardware = (patch: Partial<HardwareConfig>) => {
    setHardware((prev) => {
      const next = { ...prev, ...patch };
      if (patch.servoAngle !== undefined) {
        sendToEsp32(`/api/servo?angle=${patch.servoAngle}`);
      }
      if (patch.servoManualOverride !== undefined) {
        sendToEsp32(`/api/servo?auto=${patch.servoManualOverride ? 0 : 1}`);
      }
      if (patch.servoPowerOffWhenIdle !== undefined) {
        sendToEsp32(`/api/servo?idleoff=${patch.servoPowerOffWhenIdle ? 1 : 0}`);
      }
      if (patch.ultrasonicEnabled !== undefined) {
        sendToEsp32(`/api/sensor?ultrasonic=${patch.ultrasonicEnabled ? 1 : 0}`);
      }
      if (patch.trackingEnabled !== undefined) {
        sendToEsp32(`/api/sensor?tracking=${patch.trackingEnabled ? 1 : 0}`);
      }
      return next;
    });
  };

  const handleSaveWifiCredentials = (ssid: string, password: string) => {
    setHardware((prev) => ({ ...prev, wifiSsid: ssid, wifiPassword: password }));
    if (hardware.esp32Ip.trim()) {
      sendToEsp32(
        `/api/wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(password)}`
      );
      setWifiSaveStatus(
        `Saved "${ssid}" and sent to ESP32 (${hardware.esp32Ip.trim()}). The ESP32 will reboot onto the new WiFi.`
      );
    } else {
      setWifiSaveStatus(
        `Saved Home WiFi "${ssid}" locally and updated your downloadable ESP32 .ino firmware.`
      );
    }
  };

  const handlePingEsp32 = async () => {
    const ip = hardware.esp32Ip.trim();
    if (!ip) {
      setPingStatus('Enter your ESP32 local IP address first (e.g. http://192.168.1.50).');
      return;
    }
    setPingStatus('Sending test command to ESP32...');
    try {
      const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
      await fetch(`${base}/api/face?id=${activeScreen.faceId}`, { mode: 'no-cors' });
      setPingStatus(`Command dispatched to ${base}. Ensure your browser and ESP32 share the same WiFi.`);
    } catch {
      setPingStatus('Could not reach ESP32 IP. Verify WiFi connection and IP address.');
    }
  };

  const handleQuickExportIno = () => {
    const code = generateEsp32Firmware(
      settings,
      location,
      hardware,
      alarms,
      playlist,
      customReactions,
      weather?.utcOffsetSeconds ?? 21600
    );
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ESP32_MiniFaceBot_${(settings.userName || 'Muhib').replace(/\s+/g, '')}.ino`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentSectionMeta = NAV_ITEMS.find((n) => n.id === navSection);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar Navigation */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            FaceBot Portal
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = navSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setNavSection(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Quiet Hardware Summary Footer */}
        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="font-semibold text-slate-800">{settings.userName || 'Muhib'}&apos;s ESP32 Bot</div>
          <div className="tabular-nums">
            {location.city}
            {weather ? ` · ${Math.round(weather.temperature)}°C` : ''}
          </div>
          <div>
            {mode === 'auto' ? 'Auto Mode' : 'User Mode'} · 25 Faces
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <span className="text-base font-bold text-slate-900">FaceBot Portal</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = navSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setNavSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left + 1 Primary Action on right */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">ESP32 Mini Face Bot</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
              <h1 className="font-semibold text-slate-900 truncate">
                {currentSectionMeta?.label}
              </h1>
            </div>
          </div>

          <button
            onClick={handleQuickExportIno}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export ESP32 .ino
          </button>
        </header>

        {/* Scrollable Workspace */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1280px] w-full mx-auto space-y-6">
          {/* Persistent Live 0.96" OLED & Hardware Rig */}
          <OledHardwareStage
            mode={mode}
            activeScreen={activeScreen}
            frame={frame}
            now={now}
            settings={settings}
            weather={weather}
            location={location}
            hardware={hardware}
            currentServoAngle={currentServoAngle}
            servoPowered={servoPowered}
            userDetected={userDetected}
            isSleeping={isSleeping}
            greenLedOn={greenLedOn}
            redLedOn={redLedOn}
            activeAlarm={activeAlarm}
            customReactions={customReactions}
            onChangeOledScheme={(scheme) => handleUpdateHardware({ oledScheme: scheme })}
            onChangeAnimationSpeed={(animationSpeed) =>
              handleUpdateHardware({ animationSpeed })
            }
            onToggleMute={() =>
              handleUpdateHardware({ buzzerMuted: !hardware.buzzerMuted })
            }
            onPutToSleep={handlePutToSleep}
            onWakeUp={handleWakeUp}
            onWaveHand={handleWaveHand}
            onDistanceChange={handleDistanceChange}
            onUserAngleChange={(simulatedUserAngle) =>
              setHardware((prev) => ({ ...prev, simulatedUserAngle }))
            }
            onDismissAlarm={handleDismissAlarm}
            onSnoozeAlarm={handleSnoozeAlarm}
            onUnlockScreen={() => {
              setIsSleeping(false);
              setActiveAlarm(null);
              setActiveScreen((prev) => ({ ...prev, locked: false }));
            }}
          />

          {/* Active Section Panel */}
          {navSection === 'control' && (
            <ControlPanel
              mode={mode}
              activeScreen={activeScreen}
              oledScheme={hardware.oledScheme}
              playlist={playlist}
              customReactions={customReactions}
              onChangeMode={(nextMode) => {
                setMode(nextMode);
                setActiveScreen((prev) => ({ ...prev, locked: false }));
                sendToEsp32(`/api/mode?mode=${nextMode}`);
              }}
              onSelectFace={handleSelectFace}
              onSelectSpecialScreen={handleSelectSpecialScreen}
              onSendQuickText={handleSendQuickText}
              onUpdatePlaylist={setPlaylist}
            />
          )}

          {navSection === 'touchpad' && (
            <TouchpadStudio
              oledScheme={hardware.oledScheme}
              customReactions={customReactions}
              onSaveReaction={handleSaveReaction}
              onDeleteReaction={handleDeleteReaction}
              onDisplayReaction={handleDisplayReaction}
              onPushLivePixels={handlePushLivePixels}
            />
          )}

          {navSection === 'weather' && (
            <WeatherProfilePanel
              settings={settings}
              location={location}
              weather={weather}
              weatherLoading={weatherLoading}
              weatherError={weatherError}
              onUpdateSettings={(patch) => {
                setSettings((prev) => {
                  const next = { ...prev, ...patch };
                  if (patch.userName !== undefined) {
                    sendToEsp32(`/api/config?name=${encodeURIComponent(next.userName)}`);
                  }
                  return next;
                });
              }}
              onUpdateLocation={(loc) => {
                setLocation(loc);
                sendToEsp32(
                  `/api/config?city=${encodeURIComponent(loc.city)}&lat=${loc.latitude.toFixed(4)}&lon=${loc.longitude.toFixed(4)}`
                );
              }}
              onRefreshWeather={refreshWeather}
              onSimulateColdWeather={handleSimulateColdWeather}
              onShowWeatherOnOled={() => handleSelectSpecialScreen('weather')}
              onShowGreetingOnOled={() => handleSelectSpecialScreen('greeting')}
            />
          )}

          {navSection === 'alarms' && (
            <AlarmsPanel
              alarms={alarms}
              activeAlarm={activeAlarm}
              esp32Ip={hardware.esp32Ip}
              alarmSyncMessage={alarmSyncMessage}
              onAddAlarm={handleAddAlarm}
              onToggleAlarm={handleToggleAlarm}
              onDeleteAlarm={handleDeleteAlarm}
              onTestAlarm={handleTestAlarm}
              onDismissAlarm={handleDismissAlarm}
              onSnoozeAlarm={handleSnoozeAlarm}
              onSyncAllAlarmsToEsp32={handleSyncAllAlarmsToEsp32}
            />
          )}

          {navSection === 'hardware' && (
            <HardwarePanel
              hardware={hardware}
              currentServoAngle={currentServoAngle}
              servoPowered={servoPowered}
              userDetected={userDetected}
              onUpdateHardware={handleUpdateHardware}
              onSaveWifiCredentials={handleSaveWifiCredentials}
              wifiSaveStatus={wifiSaveStatus}
              onPingEsp32={handlePingEsp32}
              pingStatus={pingStatus}
            />
          )}

          {navSection === 'firmware' && (
            <FirmwarePanel
              settings={settings}
              location={location}
              hardware={hardware}
              alarms={alarms}
              playlist={playlist}
              customReactions={customReactions}
              utcOffsetSeconds={weather?.utcOffsetSeconds ?? 21600}
            />
          )}
        </main>
      </div>
    </div>
  );
}
