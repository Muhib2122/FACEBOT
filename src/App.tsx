import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  BellOff,
  CloudCheck,
  CloudSun,
  Code2,
  Cpu,
  Download,
  LogIn,
  LogOut,
  Menu,
  Mic,
  PenTool,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import {
  clearTodayInteractionsInFirestore,
  deleteAlarmFromFirestore,
  deleteReactionFromFirestore,
  hex2048ToPixels,
  saveAlarmToFirestore,
  saveInteractionToFirestore,
  savePlaylistToFirestore,
  saveReactionToFirestore,
  saveWorkspaceToFirestore,
  toggleAlarmInFirestore,
} from './utils/firestoreSync';
import {
  ActiveScreenState,
  AgentActionResponse,
  AlarmItem,
  BotMode,
  BotSettings,
  CustomReaction,
  FACE_DEFINITIONS,
  GreenLedMode,
  HardwareConfig,
  InteractionCategory,
  InteractionEvent,
  LocationConfig,
  NavSection,
  PlaylistItem,
  WeatherData,
} from './types';
import { PRESET_CITIES, fetchLiveWeather } from './utils/weatherApi';
import {
  playAlarmMelody,
  playBuzzerTest,
  playShortClick,
  playWakeChime,
} from './utils/buzzerAudio';
import { generateEsp32Firmware } from './utils/firmwareGenerator';
import { DashboardPanel } from './components/DashboardPanel';
import { OledHardwareStage } from './components/OledHardwareStage';
import { AiAgentPanel } from './components/AiAgentPanel';
import { ControlPanel } from './components/ControlPanel';
import { TouchpadStudio } from './components/TouchpadStudio';
import { WeatherProfilePanel } from './components/WeatherProfilePanel';
import { AlarmsPanel } from './components/AlarmsPanel';
import { HardwarePanel } from './components/HardwarePanel';
import { FirmwarePanel } from './components/FirmwarePanel';

const STORAGE_KEY = 'facebot_esp32_portal_v1';
const INTERACTIONS_STORAGE_KEY = 'facebot_daily_interactions_v1';

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
  servoAutoSync: false,
  servoPowerOffWhenIdle: true,
  ultrasonicEnabled: false,
  trackingEnabled: false,
  wakeDistanceCm: 25,
  trackingRangeCm: 60,
  simulatedDistanceCm: 75,
  simulatedUserAngle: 90,
  buzzerMuted: false,
  redLedManual: null,
  greenLedManual: null,
  greenLedMode: 'auto',
  oledScheme: 'ice-blue',
  animationSpeed: 'normal',
  esp32Ip: '',
  esp32Connected: false,
  wifiSsid: 'muhib',
  wifiPassword: '12345678',
  cloudSyncEnabled: true,
  cloudBackendType: 'vercel-api',
  cloudPortalUrl:
    typeof window !== 'undefined' && window.location.origin.startsWith('http')
      ? window.location.origin
      : '',
  firebaseDbUrl: '',
  deviceId: 'muhib-bot-1',
  firmwareVersion: '3.0.0',
  otaAutoCheck: true,
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

interface NavGroup {
  title: string;
  items: {
    id: NavSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: Activity },
      { id: 'agent', label: 'AI Voice Agent', icon: Mic },
    ],
  },
  {
    title: 'OLED & Audio',
    items: [
      { id: 'control', label: 'OLED Display', icon: SlidersHorizontal },
      { id: 'touchpad', label: 'Touchpad Studio', icon: PenTool },
      { id: 'alarms', label: 'Alarms & Buzzer', icon: Bell },
    ],
  },
  {
    title: 'Device & Setup',
    items: [
      { id: 'weather', label: 'Weather & Profile', icon: CloudSun },
      { id: 'hardware', label: 'WiFi & Hardware', icon: Cpu },
      { id: 'firmware', label: 'ESP32 Firmware', icon: Code2 },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createInitialDailyEvents(): InteractionEvent[] {
  const now = new Date();
  const currentHour = now.getHours();
  const baseDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Populate realistic morning-to-now ESP32 activity pattern so the daily spike chart is immediately informative
  const templates: { hour: number; count: number; category: InteractionCategory; label: string; source: 'esp32' | 'voice' | 'portal' }[] = [
    { hour: 7, count: 4, category: 'alarm', label: 'Morning Alarm & Wake Greeting', source: 'esp32' },
    { hour: 9, count: 3, category: 'oled-face', label: 'Live Weather & Watch Check', source: 'esp32' },
    { hour: 11, count: 6, category: 'ai-voice', label: 'Banglish Voice Command', source: 'voice' },
    { hour: 13, count: 2, category: 'hardware', label: 'Green LED & Buzzer Check', source: 'portal' },
    { hour: 15, count: 5, category: 'ai-voice', label: 'Study OLED Text & Focus Mode', source: 'voice' },
    { hour: 18, count: 7, category: 'oled-face', label: 'Evening Face Reactions Cycle', source: 'esp32' },
    { hour: 21, count: 4, category: 'ai-voice', label: 'Night Weather & Sleep Routine', source: 'voice' },
  ];

  const seeded: InteractionEvent[] = [];
  for (const tpl of templates) {
    if (tpl.hour <= currentHour) {
      for (let i = 0; i < tpl.count; i++) {
        const ts = baseDay + tpl.hour * 3600000 + (i * 7 + 3) * 60000;
        if (ts <= now.getTime()) {
          seeded.push({
            id: `seed-${tpl.hour}-${i}`,
            timestamp: ts,
            hour: tpl.hour,
            category: tpl.category,
            label: tpl.label,
            source: tpl.source,
          });
        }
      }
    }
  }

  // Always record the current portal session start at the current hour
  seeded.push({
    id: `boot-${now.getTime()}`,
    timestamp: now.getTime(),
    hour: currentHour,
    category: 'oled-face',
    label: 'Portal Connected · OLED Ready',
    source: 'portal',
  });

  return seeded.sort((a, b) => b.timestamp - a.timestamp);
}

function loadTodayInteractions(): InteractionEvent[] {
  try {
    const raw = localStorage.getItem(INTERACTIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.date === getTodayKey() && Array.isArray(parsed.events)) {
        return parsed.events;
      }
    }
  } catch {
    // ignore
  }
  return createInitialDailyEvents();
}

function pixelsToHex(pixels: number[]): string {
  let hex = '';
  for (let y = 0; y < 64; y++) {
    for (let xb = 0; xb < 16; xb++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (pixels[y * 128 + xb * 8 + bit]) {
          b |= 1 << (7 - bit);
        }
      }
      hex += b.toString(16).padStart(2, '0');
    }
  }
  return hex;
}

export default function App() {
  const saved = useMemo(() => loadSavedState(), []);

  const [navSection, setNavSection] = useState<NavSection>('dashboard');
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
    greenLedMode: saved?.hardware?.greenLedMode ?? 'auto',
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

  // Daily Interaction Analytics State
  const [interactionEvents, setInteractionEvents] = useState<InteractionEvent[]>(() =>
    loadTodayInteractions()
  );
  const [esp32HourlyOverrides, setEsp32HourlyOverrides] = useState<number[] | null>(null);
  const [esp32SyncStatus, setEsp32SyncStatus] = useState<string | null>(null);

  // Focus Pomodoro OLED Timer State
  const [pomodoroSecondsLeft, setPomodoroSecondsLeft] = useState(25 * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroLabel, setPomodoroLabel] = useState('FOCUS');

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
  const [cloudSyncStatus, setCloudSyncStatus] = useState<string | null>(null);
  const [cloudEventSeq, setCloudEventSeq] = useState(0);

  // Firebase Auth & Real-Time Firestore Persistence States
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [fbAuthReady, setFbAuthReady] = useState(false);
  const [fbWorkspaceReady, setFbWorkspaceReady] = useState(false);
  const [fbAuthError, setFbAuthError] = useState<string | null>(null);
  const [fbFatalError, setFbFatalError] = useState<Error | null>(null);

  const [activeScreen, setActiveScreen] = useState<ActiveScreenState>({
    kind: 'face',
    faceId: 0,
    locked: false,
  });

  const [activeAlarm, setActiveAlarm] = useState<AlarmItem | null>(null);
  const lastAlarmMinuteRef = useRef<string>('');
  const autoStepRef = useRef(0);
  const userStepRef = useRef(0);
  const skipNextWorkspaceSyncRef = useRef(false);

  // Cloud event counters so ESP32 Core-0 1.2s poller deduplicates one-shot actions
  const buzzerSeqRef = useRef(0);
  const lastBuzzerModeRef = useRef('tone');
  const bitmapSeqRef = useRef(0);
  const lastBitmapHexRef = useRef('');
  const alarmDismissSeqRef = useRef(0);
  const otaTriggerSeqRef = useRef(0);

  // Keep latest local state accessible during initial first-login migration
  const latestLocalStateRef = useRef({
    mode,
    settings,
    location,
    hardware,
    alarms,
    customReactions,
    interactionEvents,
    playlist,
    activeFaceId: activeScreen.faceId,
  });
  latestLocalStateRef.current = {
    mode,
    settings,
    location,
    hardware,
    alarms,
    customReactions,
    interactionEvents,
    playlist,
    activeFaceId: activeScreen.faceId,
  };

  if (fbFatalError) {
    throw fbFatalError;
  }

  // Firebase Auth State Observer
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      setFbAuthReady(true);
      if (!user) {
        setFbWorkspaceReady(false);
      }
    });
    return () => unsub();
  }, []);

  // Bootstrap parent workspace & attach real-time Firestore listeners once signed in
  useEffect(() => {
    if (!fbAuthReady || !fbUser || !fbUser.emailVerified) {
      setFbWorkspaceReady(false);
      return;
    }

    const uid = fbUser.uid;
    let cancelled = false;
    const unsubs: (() => void)[] = [];

    const bootstrapAndListen = async () => {
      try {
        const wsRef = doc(db, 'users', uid);
        let wsSnap;
        try {
          wsSnap = await getDoc(wsRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${uid}`);
        }

        if (cancelled) return;

        // First-time Google sign-in: create parent workspace first (Master Gate) & migrate existing local data!
        if (!wsSnap.exists()) {
          const snapLocal = latestLocalStateRef.current;
          await saveWorkspaceToFirestore(uid, {
            mode: snapLocal.mode,
            settings: snapLocal.settings,
            location: snapLocal.location,
            hardware: snapLocal.hardware,
            activeFaceId: snapLocal.activeFaceId,
          });
          for (const al of snapLocal.alarms.slice(0, 8)) {
            await saveAlarmToFirestore(uid, al);
          }
          for (const rx of snapLocal.customReactions.filter((r) => r.id !== 'live-touchpad-preview').slice(0, 20)) {
            await saveReactionToFirestore(uid, rx);
          }
          await savePlaylistToFirestore(uid, snapLocal.playlist);
          const todayKey = getTodayKey();
          for (const ev of snapLocal.interactionEvents.slice(0, 25)) {
            await saveInteractionToFirestore(uid, ev, todayKey);
          }
        }

        if (cancelled) return;
        setFbWorkspaceReady(true);

        // 1. Live Workspace Settings Listener
        unsubs.push(
          onSnapshot(
            wsRef,
            (docSnap) => {
              if (!docSnap.exists()) return;
              const d = docSnap.data();
              skipNextWorkspaceSyncRef.current = true;
              if (d.mode === 'auto' || d.mode === 'user') setMode(d.mode);
              setSettings((prev) => ({
                ...prev,
                userName: typeof d.userName === 'string' ? d.userName : prev.userName,
                coldThresholdC: typeof d.coldThresholdC === 'number' ? d.coldThresholdC : prev.coldThresholdC,
                hotThresholdC: typeof d.hotThresholdC === 'number' ? d.hotThresholdC : prev.hotThresholdC,
                autoSleepTimeoutSec:
                  typeof d.autoSleepTimeoutSec === 'number'
                    ? d.autoSleepTimeoutSec
                    : prev.autoSleepTimeoutSec,
                use24HourClock:
                  typeof d.use24HourClock === 'boolean' ? d.use24HourClock : prev.use24HourClock,
                wakeGreetingPrefix:
                  typeof d.wakeGreetingPrefix === 'string'
                    ? d.wakeGreetingPrefix
                    : prev.wakeGreetingPrefix,
              }));
              setLocation((prev) => ({
                ...prev,
                city: typeof d.city === 'string' ? d.city : prev.city,
                country: typeof d.country === 'string' ? d.country : prev.country,
                latitude: typeof d.latitude === 'number' ? d.latitude : prev.latitude,
                longitude: typeof d.longitude === 'number' ? d.longitude : prev.longitude,
                altitude: typeof d.altitude === 'number' ? d.altitude : prev.altitude,
                timezone: typeof d.timezone === 'string' ? d.timezone : prev.timezone,
              }));
              setHardware((prev) => ({
                ...prev,
                wifiSsid: typeof d.wifiSsid === 'string' ? d.wifiSsid : prev.wifiSsid,
                greenLedMode: d.greenLedMode || prev.greenLedMode,
                oledScheme: d.oledScheme || prev.oledScheme,
                animationSpeed: d.animationSpeed || prev.animationSpeed,
                esp32Ip: typeof d.esp32Ip === 'string' ? d.esp32Ip : prev.esp32Ip,
                cloudSyncEnabled:
                  typeof d.cloudSyncEnabled === 'boolean' ? d.cloudSyncEnabled : prev.cloudSyncEnabled,
                cloudBackendType: d.cloudBackendType || prev.cloudBackendType,
                cloudPortalUrl:
                  typeof d.cloudPortalUrl === 'string' && d.cloudPortalUrl.length > 0
                    ? d.cloudPortalUrl
                    : prev.cloudPortalUrl,
                firebaseDbUrl:
                  typeof d.firebaseDbUrl === 'string' ? d.firebaseDbUrl : prev.firebaseDbUrl,
                deviceId: typeof d.deviceId === 'string' ? d.deviceId : prev.deviceId,
                firmwareVersion:
                  typeof d.firmwareVersion === 'string' ? d.firmwareVersion : prev.firmwareVersion,
                otaAutoCheck:
                  typeof d.otaAutoCheck === 'boolean' ? d.otaAutoCheck : prev.otaAutoCheck,
                buzzerMuted:
                  typeof d.buzzerMuted === 'boolean' ? d.buzzerMuted : prev.buzzerMuted,
              }));
            },
            (err) => {
              try {
                handleFirestoreError(err, OperationType.GET, `users/${uid}`);
              } catch (e) {
                setFbFatalError(e instanceof Error ? e : new Error(String(e)));
              }
            }
          )
        );

        // 2. Live Alarms Listener
        const alarmsQ = query(
          collection(db, 'users', uid, 'alarms'),
          where('ownerId', '==', uid)
        );
        unsubs.push(
          onSnapshot(
            alarmsQ,
            (snap) => {
              const loaded: AlarmItem[] = snap.docs.map((d) => {
                const v = d.data();
                return {
                  id: d.id,
                  time: String(v.time || '07:00'),
                  label: String(v.label || 'Alarm'),
                  enabled: Boolean(v.enabled),
                  days: Array.isArray(v.days) ? v.days.map(Number) : [0, 1, 2, 3, 4, 5, 6],
                  faceId: typeof v.faceId === 'number' ? v.faceId : 1,
                  melody:
                    v.melody === 'gentle' || v.melody === 'urgent' ? v.melody : 'classic',
                };
              });
              loaded.sort((a, b) => a.time.localeCompare(b.time));
              setAlarms(loaded);
            },
            (err) => {
              try {
                handleFirestoreError(err, OperationType.LIST, `users/${uid}/alarms`);
              } catch (e) {
                setFbFatalError(e instanceof Error ? e : new Error(String(e)));
              }
            }
          )
        );

        // 3. Live Touchpad Reactions Listener
        const reactionsQ = query(
          collection(db, 'users', uid, 'reactions'),
          where('ownerId', '==', uid)
        );
        unsubs.push(
          onSnapshot(
            reactionsQ,
            (snap) => {
              const loaded: CustomReaction[] = snap.docs.map((d) => {
                const v = d.data();
                return {
                  id: d.id,
                  name: String(v.name || 'Saved Art'),
                  createdAt: v.createdAt?.toMillis?.() ?? Date.now(),
                  pixels: hex2048ToPixels(String(v.pixelsHex || '')),
                  servoStyle: 'center',
                };
              });
              loaded.sort((a, b) => b.createdAt - a.createdAt);
              setCustomReactions((prev) => {
                const preview = prev.find((r) => r.id === 'live-touchpad-preview');
                return preview ? [preview, ...loaded] : loaded;
              });
            },
            (err) => {
              try {
                handleFirestoreError(err, OperationType.LIST, `users/${uid}/reactions`);
              } catch (e) {
                setFbFatalError(e instanceof Error ? e : new Error(String(e)));
              }
            }
          )
        );

        // 4. Live Today's Interaction Events Listener
        const todayKey = getTodayKey();
        const interactionsQ = query(
          collection(db, 'users', uid, 'interactions'),
          where('ownerId', '==', uid),
          where('dateKey', '==', todayKey)
        );
        unsubs.push(
          onSnapshot(
            interactionsQ,
            (snap) => {
              const loaded: InteractionEvent[] = snap.docs.map((d) => {
                const v = d.data();
                return {
                  id: d.id,
                  timestamp: typeof v.timestampMs === 'number' ? v.timestampMs : Date.now(),
                  hour: typeof v.hour === 'number' ? v.hour : 0,
                  category: v.category || 'oled-face',
                  label: String(v.label || 'Event'),
                  source: v.source || 'portal',
                };
              });
              loaded.sort((a, b) => b.timestamp - a.timestamp);
              setInteractionEvents(loaded);
            },
            (err) => {
              try {
                handleFirestoreError(err, OperationType.LIST, `users/${uid}/interactions`);
              } catch (e) {
                setFbFatalError(e instanceof Error ? e : new Error(String(e)));
              }
            }
          )
        );

        // 5. Live Playlist Listener
        const playlistQ = query(
          collection(db, 'users', uid, 'playlist'),
          where('ownerId', '==', uid)
        );
        unsubs.push(
          onSnapshot(
            playlistQ,
            (snap) => {
              if (snap.empty) return;
              const rows = snap.docs
                .map((d) => ({ id: d.id, data: d.data() }))
                .sort((a, b) => Number(a.data.orderIndex ?? 0) - Number(b.data.orderIndex ?? 0));
              setPlaylist(
                rows.map(({ id, data }) => ({
                  id,
                  kind: data.kind || 'face',
                  label: String(data.label || 'Screen'),
                  durationSec: Number(data.durationSec || 5),
                  enabled: Boolean(data.enabled),
                  faceId: typeof data.faceId === 'number' ? data.faceId : 0,
                  customReactionId: data.customReactionId || undefined,
                  textMessage: data.textMessage || undefined,
                }))
              );
            },
            (err) => {
              try {
                handleFirestoreError(err, OperationType.LIST, `users/${uid}/playlist`);
              } catch (e) {
                setFbFatalError(e instanceof Error ? e : new Error(String(e)));
              }
            }
          )
        );
      } catch (err) {
        if (!cancelled) {
          setFbFatalError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    void bootstrapAndListen();

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, [fbAuthReady, fbUser]);

  // Debounced Save of Workspace Settings/Hardware/Location to Firestore
  useEffect(() => {
    if (!fbUser || !fbUser.emailVerified || !fbWorkspaceReady) return;
    if (skipNextWorkspaceSyncRef.current) {
      skipNextWorkspaceSyncRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      saveWorkspaceToFirestore(fbUser.uid, {
        mode,
        settings,
        location,
        hardware,
        activeFaceId: activeScreen.faceId,
      }).catch((err) => {
        setFbFatalError(err instanceof Error ? err : new Error(String(err)));
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    fbUser,
    fbWorkspaceReady,
    mode,
    settings,
    location,
    hardware,
    activeScreen.faceId,
  ]);

  const handleGoogleSignIn = async () => {
    setFbAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in popup was closed.';
      setFbAuthError(msg);
    }
  };

  const handleGoogleSignOut = async () => {
    setFbAuthError(null);
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  };

  // Persist settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mode,
          settings,
          location,
          hardware,
          playlist,
          alarms,
          customReactions,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [mode, settings, location, hardware, playlist, alarms, customReactions]);

  // Persist daily interaction log
  useEffect(() => {
    try {
      localStorage.setItem(
        INTERACTIONS_STORAGE_KEY,
        JSON.stringify({
          date: getTodayKey(),
          events: interactionEvents.slice(0, 250),
        })
      );
    } catch {
      // Ignore
    }
  }, [interactionEvents]);

  const logInteraction = useCallback(
    (category: InteractionCategory, label: string, source: 'portal' | 'esp32' | 'voice' = 'portal') => {
      const current = new Date();
      const ev: InteractionEvent = {
        id: `ev-${current.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: current.getTime(),
        hour: current.getHours(),
        category,
        label,
        source,
      };
      setInteractionEvents((prev) => [ev, ...prev].slice(0, 250));
      if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
        saveInteractionToFirestore(fbUser.uid, ev, getTodayKey()).catch((err) => {
          setFbFatalError(err instanceof Error ? err : new Error(String(err)));
        });
      }
    },
    [fbUser, fbWorkspaceReady]
  );

  // Send live HTTP GET command to real ESP32 over WiFi if IP is configured
  const sendToEsp32 = useCallback(
    (path: string) => {
      const ip = hardware.esp32Ip.trim();
      if (!ip) return;
      const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
      fetch(`${base}${path}`, { mode: 'no-cors' }).catch(() => {});
    },
    [hardware.esp32Ip]
  );

  const postBitmapToEsp32 = useCallback(
    (pixels: number[]) => {
      const hex = pixelsToHex(pixels);
      lastBitmapHexRef.current = hex;
      bitmapSeqRef.current += 1;
      setCloudEventSeq((s) => s + 1);

      const ip = hardware.esp32Ip.trim();
      if (!ip) return;
      const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
      fetch(`${base}/api/bitmap`, {
        method: 'POST',
        mode: 'no-cors',
        body: hex,
      }).catch(() => {});
    },
    [hardware.esp32Ip]
  );

  // Build Cloud State Payload synced to Vercel /api/bot-state or Firebase RTDB
  const buildCloudPayload = useCallback(() => {
    let screenName = 'auto';
    if (activeScreen.locked) {
      if (activeScreen.kind === 'custom-text') screenName = 'text';
      else if (activeScreen.kind === 'custom-bitmap') screenName = 'bitmap';
      else screenName = activeScreen.kind;
    }

    const mappedAlarms = alarms.slice(0, 8).map((a) => {
      const [hh, mm] = a.time.split(':').map(Number);
      const melody = a.melody === 'gentle' ? 1 : a.melody === 'urgent' ? 2 : 0;
      return {
        hour: hh || 7,
        min: mm || 0,
        on: a.enabled,
        face: a.faceId,
        melody,
        label: a.label.slice(0, 18),
      };
    });

    return {
      deviceId: (hardware.deviceId || 'muhib-bot-1').trim(),
      mode,
      screen: screenName,
      faceId: activeScreen.faceId,
      textLine1: activeScreen.textLine1 || '',
      textLine2: activeScreen.textLine2 || '',
      userName: settings.userName || 'Muhib',
      city: location.city || 'Dhaka',
      greenLed: hardware.greenLedMode,
      buzzerSeq: buzzerSeqRef.current,
      buzzerMode: lastBuzzerModeRef.current,
      bitmapSeq: bitmapSeqRef.current,
      bitmapHex: lastBitmapHexRef.current,
      alarms: mappedAlarms,
      alarmDismissSeq: alarmDismissSeqRef.current,
      otaTriggerSeq: otaTriggerSeqRef.current,
      updatedAt: Date.now(),
    };
  }, [
    hardware.deviceId,
    hardware.greenLedMode,
    mode,
    activeScreen,
    settings.userName,
    location.city,
    alarms,
  ]);

  const pushStateToCloud = useCallback(
    async (silent = false) => {
      if (!hardware.cloudSyncEnabled && silent) return;

      const payload = buildCloudPayload();
      const deviceId = encodeURIComponent(payload.deviceId || 'muhib-bot-1');

      try {
        if (hardware.cloudBackendType === 'firebase-rtdb') {
          const fbUrl = hardware.firebaseDbUrl.trim();
          if (!fbUrl) {
            if (!silent) setCloudSyncStatus('Enter your Firebase Realtime Database .json URL first.');
            return;
          }
          const res = await fetch(fbUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(`Firebase responded ${res.status}`);
          if (!silent) {
            setCloudSyncStatus(
              `Synced live state to Firebase RTDB at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`
            );
          }
        } else {
          const base = hardware.cloudPortalUrl.trim().replace(/\/$/, '');
          const endpoint =
            base && typeof window !== 'undefined' && base !== window.location.origin
              ? `${base}/api/bot-state?device=${deviceId}`
              : `/api/bot-state?device=${deviceId}`;

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(`Cloud bridge responded ${res.status}`);
          if (!silent) {
            setCloudSyncStatus(
              `Synced live state to Vercel Cloud (${payload.deviceId}) at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. ESP32 updates within ~1.2s.`
            );
          }
        }
      } catch (err) {
        if (!silent) {
          setCloudSyncStatus(
            `Cloud sync error: ${err instanceof Error ? err.message : 'Unable to reach endpoint'}`
          );
        }
      }
    },
    [
      hardware.cloudSyncEnabled,
      hardware.cloudBackendType,
      hardware.firebaseDbUrl,
      hardware.cloudPortalUrl,
      buildCloudPayload,
    ]
  );

  // Fast 220ms debounced Vercel Cloud Auto-Sync on any state/hardware change
  useEffect(() => {
    if (!hardware.cloudSyncEnabled) return;
    const timer = window.setTimeout(() => {
      void pushStateToCloud(true);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [
    hardware.cloudSyncEnabled,
    hardware.greenLedMode,
    mode,
    activeScreen,
    alarms,
    settings.userName,
    location.city,
    cloudEventSeq,
    pushStateToCloud,
  ]);

  const handleTriggerOtaUpdate = useCallback(async () => {
    otaTriggerSeqRef.current += 1;
    setCloudEventSeq((s) => s + 1);
    await pushStateToCloud(false);
    setCloudSyncStatus(
      `OTA Update signal queued for ${hardware.deviceId || 'muhib-bot-1'} — ESP32 will check /ota/version.json on next 1.2s sync and update automatically!`
    );
    logInteraction('hardware', 'Triggered Vercel Auto-OTA Update', 'portal');
  }, [pushStateToCloud, hardware.deviceId, logInteraction]);

  // Pull real hourly interaction spikes from ESP32 /api/stats
  const handleSyncEsp32Stats = useCallback(async () => {
    const ip = hardware.esp32Ip.trim();
    if (!ip) {
      setEsp32SyncStatus('Add your ESP32 IP in WiFi & Hardware to pull live hardware counters.');
      return;
    }
    const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
    try {
      const res = await fetch(`${base}/api/stats`);
      if (!res.ok) throw new Error('Non-200 response');
      const data = await res.json();
      if (Array.isArray(data?.hourly) && data.hourly.length === 24) {
        setEsp32HourlyOverrides(data.hourly.map((n: unknown) => Number(n) || 0));
        setEsp32SyncStatus(`Synced ${data.total ?? 0} real ESP32 interactions from ${base}.`);
        logInteraction('hardware', 'Synced ESP32 Hourly Stats', 'esp32');
      } else {
        setEsp32SyncStatus('Connected, but ESP32 firmware did not return /api/stats. Upload latest sketch.');
      }
    } catch {
      setEsp32SyncStatus(`Could not read ${base}/api/stats. Ensure device & ESP32 share WiFi/Hotspot.`);
    }
  }, [hardware.esp32Ip, logInteraction]);

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

  // Smooth 24-FPS OLED Animation Frame Tick (Matches ESP32 Core-1 42ms frame loop)
  useEffect(() => {
    const ms =
      hardware.animationSpeed === 'fast'
        ? 28
        : hardware.animationSpeed === 'slow'
          ? 75
          : 42;
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % 100000);
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
          logInteraction('alarm', `Alarm Triggered: ${matched.label}`, 'esp32');
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [alarms, logInteraction]);

  // Live OLED Pomodoro Focus Countdown
  useEffect(() => {
    if (!pomodoroRunning) return;
    const id = window.setInterval(() => {
      setPomodoroSecondsLeft((prev) => {
        if (prev <= 1) {
          setPomodoroRunning(false);
          playWakeChime(hardware.buzzerMuted);
          setActiveScreen({
            kind: 'custom-text',
            faceId: 1,
            textLine1: `${pomodoroLabel} DONE!`,
            textLine2: 'NICE JOB!',
            locked: true,
          });
          sendToEsp32(`/api/screen?kind=text&l1=${encodeURIComponent(`${pomodoroLabel} DONE!`)}&l2=NICE`);
          sendToEsp32('/api/buzzer?mode=happy');
          logInteraction('hardware', `Focus Timer Completed (${pomodoroLabel})`, 'portal');
          return 0;
        }
        const next = prev - 1;
        const mm = String(Math.floor(next / 60)).padStart(2, '0');
        const ss = String(next % 60).padStart(2, '0');
        setActiveScreen({
          kind: 'custom-text',
          faceId: 0,
          textLine1: `${pomodoroLabel} TIMER`,
          textLine2: `${mm}:${ss}`,
          locked: true,
        });
        // Update real ESP32 OLED every 5 seconds to keep WiFi smooth
        if (next % 5 === 0) {
          sendToEsp32(
            `/api/screen?kind=text&l1=${encodeURIComponent(`${pomodoroLabel} TIMER`)}&l2=${encodeURIComponent(`${mm}:${ss}`)}`
          );
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [pomodoroRunning, pomodoroLabel, hardware.buzzerMuted, sendToEsp32, logInteraction]);

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
    if (isSleeping || activeAlarm || activeScreen.locked) {
      return;
    }

    if (mode === 'auto') {
      const stepMs = 5500;
      const timer = window.setTimeout(() => {
        const step = autoStepRef.current;
        autoStepRef.current += 1;

        const isCold = weather !== null && weather.temperature <= settings.coldThresholdC;

        if (step % 5 === 0) {
          setActiveScreen({ kind: 'watch', faceId: 0, locked: false });
        } else if (step % 5 === 1) {
          setActiveScreen({ kind: 'weather', faceId: isCold ? 3 : 0, locked: false });
        } else if (step % 5 === 2) {
          setActiveScreen({ kind: 'greeting', faceId: 1, locked: false });
        } else {
          const awakeFaces = FACE_DEFINITIONS.filter((f) => f.id !== 7);
          const pick = awakeFaces[Math.floor(step / 2) % awakeFaces.length];
          setActiveScreen({ kind: 'face', faceId: pick.id, locked: false });
        }
      }, stepMs);

      return () => window.clearTimeout(timer);
    }

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

  // Compute Single Green LED (GPIO 26) State (smoothly timed at 24-FPS)
  const greenLedOn = useMemo(() => {
    if (hardware.greenLedMode === 'on') return true;
    if (hardware.greenLedMode === 'off') return false;
    if (hardware.greenLedMode === 'blink') return Math.floor(frame / 7) % 2 === 0;
    if (activeAlarm) return Math.floor(frame / 4) % 2 === 0;
    return !isSleeping;
  }, [hardware.greenLedMode, frame, activeAlarm, isSleeping]);

  // Hardware Action Handlers
  const handleChangeGreenLedMode = useCallback(
    (nextMode: GreenLedMode) => {
      setHardware((prev) => ({ ...prev, greenLedMode: nextMode }));
      sendToEsp32(`/api/led?green=${nextMode}`);
      logInteraction('hardware', `Green LED -> ${nextMode.toUpperCase()}`, 'portal');
    },
    [sendToEsp32, logInteraction]
  );

  const handleTestBuzzer = useCallback(
    (sound: 'tone' | 'happy' | 'dc' = 'tone') => {
      if (sound === 'happy') {
        playWakeChime(hardware.buzzerMuted);
      } else {
        playBuzzerTest(hardware.buzzerMuted);
      }
      lastBuzzerModeRef.current = sound;
      buzzerSeqRef.current += 1;
      setCloudEventSeq((s) => s + 1);
      sendToEsp32(`/api/buzzer?mode=${sound}`);
      logInteraction('hardware', `Piezo Buzzer (${sound})`, 'portal');
    },
    [hardware.buzzerMuted, sendToEsp32, logInteraction]
  );

  const handlePutToSleep = () => {
    setActiveAlarm(null);
    setPomodoroRunning(false);
    setIsSleeping(true);
    setActiveScreen({ kind: 'face', faceId: 7, locked: true });
    sendToEsp32('/api/face?id=7');
    logInteraction('oled-face', 'Bot Put to Sleep', 'portal');
  };

  const handleWakeUp = () => {
    setIsSleeping(false);
    setActiveAlarm(null);
    playWakeChime(hardware.buzzerMuted);
    setActiveScreen({ kind: 'face', faceId: 1, locked: false });
    sendToEsp32('/api/face?id=1');
    sendToEsp32('/api/buzzer?mode=happy');
    logInteraction('oled-face', 'Bot Woken Up', 'portal');
  };

  const handleSelectFace = (faceId: number) => {
    playShortClick(hardware.buzzerMuted);
    setActiveAlarm(null);
    setPomodoroRunning(false);
    setIsSleeping(faceId === 7);
    setActiveScreen({ kind: 'face', faceId, locked: true });
    sendToEsp32(`/api/face?id=${faceId}`);
    const def = FACE_DEFINITIONS.find((f) => f.id === faceId);
    logInteraction('oled-face', `OLED Face: ${def?.name || `#${faceId + 1}`}`, 'portal');
  };

  const handleSelectSpecialScreen = (kind: 'watch' | 'weather' | 'greeting') => {
    playShortClick(hardware.buzzerMuted);
    setActiveAlarm(null);
    setPomodoroRunning(false);
    setIsSleeping(false);
    setActiveScreen({ kind, faceId: 0, locked: true });
    sendToEsp32(`/api/screen?kind=${kind}`);
    logInteraction('oled-face', `OLED Screen: ${kind.toUpperCase()}`, 'portal');
  };

  const handleSendQuickText = (line1: string, line2: string) => {
    playShortClick(hardware.buzzerMuted);
    setActiveAlarm(null);
    setPomodoroRunning(false);
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
    logInteraction('oled-face', `OLED Text: "${line1}"`, 'portal');
  };

  const handlePushLivePixels = (pixels: number[]) => {
    const tempId = 'live-touchpad-preview';
    const liveObj: CustomReaction = {
      id: tempId,
      name: 'Live Touchpad',
      createdAt: Date.now(),
      pixels,
      servoStyle: 'center',
    };
    setCustomReactions((prev) => {
      const withoutTemp = prev.filter((r) => r.id !== tempId);
      return [liveObj, ...withoutTemp];
    });
    setActiveAlarm(null);
    setPomodoroRunning(false);
    setIsSleeping(false);
    setActiveScreen({
      kind: 'custom-bitmap',
      faceId: 0,
      customReactionId: tempId,
      locked: true,
    });
    playShortClick(hardware.buzzerMuted);
    postBitmapToEsp32(pixels);
    logInteraction('oled-face', 'Pushed 128x64 Touchpad Bitmap', 'portal');
  };

  const handleSaveReaction = (reaction: CustomReaction) => {
    setCustomReactions((prev) => [
      reaction,
      ...prev.filter((r) => r.id !== 'live-touchpad-preview'),
    ]);
    if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
      saveReactionToFirestore(fbUser.uid, reaction).catch((err) => {
        setFbFatalError(err instanceof Error ? err : new Error(String(err)));
      });
    }
    logInteraction('oled-face', `Saved Touchpad Art: ${reaction.name}`, 'portal');
  };

  const handleDisplayReaction = (reaction: CustomReaction) => {
    setActiveAlarm(null);
    setPomodoroRunning(false);
    setIsSleeping(false);
    setActiveScreen({
      kind: 'custom-bitmap',
      faceId: 0,
      customReactionId: reaction.id,
      locked: true,
    });
    playShortClick(hardware.buzzerMuted);
    postBitmapToEsp32(reaction.pixels);
    logInteraction('oled-face', `Displayed Art: ${reaction.name}`, 'portal');
  };

  const handleDeleteReaction = (id: string) => {
    setCustomReactions((prev) => prev.filter((r) => r.id !== id));
    if (fbUser && fbUser.emailVerified && fbWorkspaceReady && id !== 'live-touchpad-preview') {
      deleteReactionFromFirestore(fbUser.uid, id).catch((err) => {
        setFbFatalError(err instanceof Error ? err : new Error(String(err)));
      });
    }
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
    logInteraction('oled-face', 'Simulated Cold Weather Reaction', 'portal');
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

  const handleAddAlarm = useCallback(
    (alarm: AlarmItem) => {
      setAlarms((prev) => {
        const next = [alarm, ...prev];
        next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
        return next;
      });
      if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
        saveAlarmToFirestore(fbUser.uid, alarm).catch((err) => {
          setFbFatalError(err instanceof Error ? err : new Error(String(err)));
        });
      }
      setAlarmSyncMessage(
        fbUser
          ? `Alarm ${alarm.time} saved to Firebase Cloud and synced to ESP32.`
          : hardware.esp32Ip.trim()
            ? `Alarm ${alarm.time} saved and synced to ESP32.`
            : `Alarm ${alarm.time} saved locally and embedded in your ESP32 firmware.`
      );
      logInteraction('alarm', `Set Alarm ${alarm.time} (${alarm.label})`, 'portal');
    },
    [fbUser, fbWorkspaceReady, hardware.esp32Ip, syncSingleAlarmSlot, logInteraction]
  );

  const handleToggleAlarm = (id: string) => {
    let nextEnabled = true;
    setAlarms((prev) => {
      const next = prev.map((a) => {
        if (a.id === id) {
          nextEnabled = !a.enabled;
          return { ...a, enabled: nextEnabled };
        }
        return a;
      });
      next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
      return next;
    });
    if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
      toggleAlarmInFirestore(fbUser.uid, id, nextEnabled).catch((err) => {
        setFbFatalError(err instanceof Error ? err : new Error(String(err)));
      });
    }
  };

  const handleDismissAlarm = () => {
    setActiveAlarm(null);
    setActiveScreen({ kind: 'face', faceId: 0, locked: false });
    alarmDismissSeqRef.current += 1;
    setCloudEventSeq((s) => s + 1);
    sendToEsp32('/api/alarm/dismiss');
    logInteraction('alarm', 'Dismissed Ringing Alarm', 'portal');
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
    if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
      deleteAlarmFromFirestore(fbUser.uid, id).catch((err) => {
        setFbFatalError(err instanceof Error ? err : new Error(String(err)));
      });
    }
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
    logInteraction('alarm', `Tested Alarm: ${alarm.label}`, 'portal');
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
        : 'Add your ESP32 IP in WiFi & Hardware to push alarms live over WiFi.'
    );
  };

  // Execute structured hardware & OLED actions returned by the AI Voice Agent
  const handleExecuteAgentAction = useCallback(
    (action: AgentActionResponse, source: 'portal' | 'voice'): string[] => {
      const badges: string[] = [];
      const clampedFace = Math.max(0, Math.min(24, Number(action.faceId) || 0));
      const faceDef = FACE_DEFINITIONS.find((f) => f.id === clampedFace);

      if (action.targetMode === 'auto' || action.targetMode === 'user') {
        setMode(action.targetMode);
        sendToEsp32(`/api/mode?mode=${action.targetMode}`);
        badges.push(`Mode: ${action.targetMode.toUpperCase()}`);
      }

      if (action.screenKind === 'sleep') {
        setActiveAlarm(null);
        setPomodoroRunning(false);
        setIsSleeping(true);
        setActiveScreen({ kind: 'face', faceId: 7, locked: true });
        sendToEsp32('/api/face?id=7');
        badges.push('OLED: Sleep');
      } else if (action.screenKind === 'wake') {
        setActiveAlarm(null);
        setPomodoroRunning(false);
        setIsSleeping(false);
        setActiveScreen({ kind: 'face', faceId: clampedFace || 1, locked: true });
        sendToEsp32(`/api/face?id=${clampedFace || 1}`);
        badges.push('OLED: Awake');
      } else if (action.screenKind === 'custom-text' && (action.oledLine1 || action.oledLine2)) {
        const l1 = (action.oledLine1 || '').slice(0, 18);
        const l2 = (action.oledLine2 || '').slice(0, 9);
        setActiveAlarm(null);
        setPomodoroRunning(false);
        setIsSleeping(false);
        setActiveScreen({
          kind: 'custom-text',
          faceId: clampedFace,
          textLine1: l1,
          textLine2: l2,
          locked: true,
        });
        sendToEsp32(
          `/api/screen?kind=text&l1=${encodeURIComponent(l1)}&l2=${encodeURIComponent(l2)}`
        );
        badges.push(`OLED: "${l1}"`);
      } else if (
        action.screenKind === 'watch' ||
        action.screenKind === 'weather' ||
        action.screenKind === 'greeting'
      ) {
        setActiveAlarm(null);
        setPomodoroRunning(false);
        setIsSleeping(false);
        setActiveScreen({ kind: action.screenKind, faceId: clampedFace, locked: true });
        sendToEsp32(`/api/screen?kind=${action.screenKind}`);
        badges.push(`OLED: ${action.screenKind.toUpperCase()}`);
      } else if (action.screenKind === 'face') {
        setActiveAlarm(null);
        setPomodoroRunning(false);
        setIsSleeping(clampedFace === 7);
        setActiveScreen({ kind: 'face', faceId: clampedFace, locked: true });
        sendToEsp32(`/api/face?id=${clampedFace}`);
        badges.push(`Face: ${faceDef?.name || `#${clampedFace + 1}`}`);
      }

      if (
        action.greenLed === 'on' ||
        action.greenLed === 'off' ||
        action.greenLed === 'blink' ||
        action.greenLed === 'auto'
      ) {
        setHardware((prev) => ({ ...prev, greenLedMode: action.greenLed as GreenLedMode }));
        sendToEsp32(`/api/led?green=${action.greenLed}`);
        badges.push(`LED: ${action.greenLed.toUpperCase()}`);
      }

      if (action.buzzerSound && action.buzzerSound !== 'none') {
        if (action.buzzerSound === 'wake' || action.buzzerSound === 'happy') {
          playWakeChime(hardware.buzzerMuted);
          lastBuzzerModeRef.current = 'happy';
          sendToEsp32('/api/buzzer?mode=happy');
        } else if (action.buzzerSound === 'alarm') {
          playAlarmMelody('classic', hardware.buzzerMuted);
          lastBuzzerModeRef.current = 'alarm';
          sendToEsp32('/api/buzzer?mode=alarm');
        } else {
          playBuzzerTest(hardware.buzzerMuted);
          lastBuzzerModeRef.current = 'tone';
          sendToEsp32('/api/buzzer?mode=tone');
        }
        buzzerSeqRef.current += 1;
        setCloudEventSeq((s) => s + 1);
        badges.push(`Buzzer: ${action.buzzerSound}`);
      }

      if (action.alarmTime && /^\d{2}:\d{2}$/.test(action.alarmTime.trim())) {
        const cleanTime = action.alarmTime.trim();
        const cleanLabel = (action.alarmLabel || 'AI Alarm').slice(0, 18);
        const newAlarm: AlarmItem = {
          id: `al-ai-${Date.now()}`,
          time: cleanTime,
          label: cleanLabel,
          enabled: true,
          days: [0, 1, 2, 3, 4, 5, 6],
          faceId: clampedFace || 1,
          melody: 'classic',
        };
        setAlarms((prev) => {
          const next = [newAlarm, ...prev];
          next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
          return next;
        });
        if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
          saveAlarmToFirestore(fbUser.uid, newAlarm).catch((err) => {
            setFbFatalError(err instanceof Error ? err : new Error(String(err)));
          });
        }
        badges.push(`Alarm: ${cleanTime}`);
      }

      logInteraction('ai-voice', action.actionSummary || `AI Agent (${faceDef?.name || 'Reply'})`, source);
      return badges;
    },
    [fbUser, fbWorkspaceReady, hardware.buzzerMuted, sendToEsp32, syncSingleAlarmSlot, logInteraction]
  );

  const handleUpdateHardware = (patch: Partial<HardwareConfig>) => {
    setHardware((prev) => ({ ...prev, ...patch }));
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
    logInteraction('hardware', `Updated WiFi SSID: ${ssid}`, 'portal');
  };

  const handlePingEsp32 = async () => {
    const ip = hardware.esp32Ip.trim();
    if (!ip) {
      setPingStatus('Enter your ESP32 IP first (e.g. http://192.168.4.1 or http://192.168.1.50).');
      return;
    }
    setPingStatus('Sending test command to ESP32...');
    try {
      const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
      await fetch(`${base}/api/face?id=${activeScreen.faceId}`, { mode: 'no-cors' });
      setPingStatus(`Command dispatched to ${base}. Ensure your browser and ESP32 share the same WiFi/Hotspot.`);
      logInteraction('hardware', `Pinged ESP32 (${base})`, 'esp32');
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
    a.download = `FaceBot_ESP32_${(settings.userName || 'Muhib').replace(/\s+/g, '')}.ino`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentSectionMeta = ALL_NAV_ITEMS.find((n) => n.id === navSection);

  const renderSidebarNav = (onAfterSelect?: () => void) => (
    <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="px-3 mb-1.5 text-[11px] font-semibold text-slate-400 tracking-wide">
            {group.title}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = navSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setNavSection(item.id);
                    onAfterSelect?.();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
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
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Grouped Sidebar Navigation */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            FaceBot Portal
          </span>
        </div>

        {renderSidebarNav()}

        {/* Quiet Hardware Profile Footer in Sidebar */}
        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="font-semibold text-slate-800">
            {settings.userName || 'Muhib'}&apos;s ESP32 Node
          </div>
          <div className="tabular-nums">
            {location.city}
            {weather ? ` · ${Math.round(weather.temperature)}°C` : ''}
          </div>
          <div className="text-[11px] text-slate-400">
            Muhib Creation
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
          <div className="relative w-64 max-w-[82vw] bg-white h-full flex flex-col border-r border-slate-200 z-10">
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
            {renderSidebarNav(() => setMobileMenuOpen(false))}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Clean Top Header Bar */}
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
              <span className="text-slate-400 hidden sm:inline">FaceBot ESP32</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
              <h1 className="font-semibold text-slate-900 truncate">
                {currentSectionMeta?.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {fbUser ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600 pr-1">
                  <CloudCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-medium text-slate-800 max-w-[130px] truncate">
                    {fbUser.displayName || fbUser.email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5 text-blue-600" />
                Sign in with Google
              </button>
            )}

            <button
              onClick={handleQuickExportIno}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export ESP32 .ino
            </button>
          </div>
        </header>

        {fbAuthError && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 lg:px-8 py-2 text-xs text-amber-800 flex items-center justify-between gap-2">
            <span>Google Sign-In: {fbAuthError}</span>
            <button
              type="button"
              onClick={() => setFbAuthError(null)}
              className="text-amber-700 hover:text-amber-900 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Focused Workspace (No Cluttered Duplicated Rig on Every Page) */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1280px] w-full mx-auto space-y-6">
          {/* Global Active Alarm Alert Bar (only shown if an alarm is currently ringing) */}
          {activeAlarm && navSection !== 'control' && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-red-900 tabular-nums">
                  Alarm Ringing · {activeAlarm.time} · {activeAlarm.label}
                </p>
                <p className="text-xs text-red-700">
                  Piezo Buzzer active on GPIO 14
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleSnoozeAlarm}
                  className="px-3 py-2 text-xs font-semibold text-red-800 bg-white border border-red-200 hover:bg-red-100/60 rounded-lg transition-colors"
                >
                  Snooze 5m
                </button>
                <button
                  onClick={handleDismissAlarm}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* 1. Dashboard Section (Analytics Line Chart + KPIs + Log + OLED Focus Timer) */}
          {navSection === 'dashboard' && (
            <DashboardPanel
              events={interactionEvents}
              esp32HourlyOverrides={esp32HourlyOverrides}
              esp32SyncStatus={esp32SyncStatus}
              mode={mode}
              activeScreen={activeScreen}
              settings={settings}
              location={location}
              weather={weather}
              hardware={hardware}
              isSleeping={isSleeping}
              greenLedOn={greenLedOn}
              pomodoroSecondsLeft={pomodoroSecondsLeft}
              pomodoroRunning={pomodoroRunning}
              pomodoroLabel={pomodoroLabel}
              onSyncEsp32Stats={handleSyncEsp32Stats}
              onResetStats={() => {
                setInteractionEvents([]);
                setEsp32HourlyOverrides(null);
                setEsp32SyncStatus(null);
                if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
                  clearTodayInteractionsInFirestore(fbUser.uid, getTodayKey()).catch((err) => {
                    setFbFatalError(err instanceof Error ? err : new Error(String(err)));
                  });
                }
              }}
              onStartPomodoro={(mins, label) => {
                setPomodoroLabel(label);
                setPomodoroSecondsLeft(mins * 60);
                setPomodoroRunning(true);
                setIsSleeping(false);
                logInteraction('hardware', `Started OLED ${label} Timer (${mins}m)`, 'portal');
              }}
              onTogglePomodoro={() => setPomodoroRunning((r) => !r)}
              onResetPomodoro={() => {
                setPomodoroRunning(false);
                setPomodoroSecondsLeft(25 * 60);
                setPomodoroLabel('FOCUS');
              }}
              onNavigate={setNavSection}
            />
          )}

          {/* 2. AI Voice Agent Section (Full Device Mic & Speaker + Live Side OLED) */}
          {navSection === 'agent' && (
            <AiAgentPanel
              settings={settings}
              location={location}
              weather={weather}
              now={now}
              frame={frame}
              mode={mode}
              isSleeping={isSleeping}
              greenLedOn={greenLedOn}
              hardware={hardware}
              activeScreen={activeScreen}
              activeAlarm={activeAlarm}
              customReactions={customReactions}
              alarmCount={alarms.length}
              todayInteractions={interactionEvents.length}
              onExecuteAgentAction={handleExecuteAgentAction}
              onChangeGreenLedMode={handleChangeGreenLedMode}
              onTestBuzzer={() => handleTestBuzzer('tone')}
            />
          )}

          {/* 3. Dedicated OLED Display & Live Control Section */}
          {navSection === 'control' && (
            <div className="space-y-6">
              <OledHardwareStage
                mode={mode}
                activeScreen={activeScreen}
                frame={frame}
                now={now}
                settings={settings}
                weather={weather}
                location={location}
                hardware={hardware}
                isSleeping={isSleeping}
                greenLedOn={greenLedOn}
                activeAlarm={activeAlarm}
                customReactions={customReactions}
                onChangeOledScheme={(scheme) => handleUpdateHardware({ oledScheme: scheme })}
                onChangeAnimationSpeed={(animationSpeed) =>
                  handleUpdateHardware({ animationSpeed })
                }
                onChangeGreenLedMode={handleChangeGreenLedMode}
                onTestBuzzer={() => handleTestBuzzer('tone')}
                onToggleMute={() =>
                  handleUpdateHardware({ buzzerMuted: !hardware.buzzerMuted })
                }
                onPutToSleep={handlePutToSleep}
                onWakeUp={handleWakeUp}
                onDismissAlarm={handleDismissAlarm}
                onSnoozeAlarm={handleSnoozeAlarm}
                onUnlockScreen={() => {
                  setIsSleeping(false);
                  setActiveAlarm(null);
                  setPomodoroRunning(false);
                  setActiveScreen((prev) => ({ ...prev, locked: false }));
                }}
              />

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
                  logInteraction('oled-face', `Switched to ${nextMode.toUpperCase()} Mode`, 'portal');
                }}
                onSelectFace={handleSelectFace}
                onSelectSpecialScreen={handleSelectSpecialScreen}
                onSendQuickText={handleSendQuickText}
                onUpdatePlaylist={(nextPlaylist) => {
                  setPlaylist(nextPlaylist);
                  if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
                    savePlaylistToFirestore(fbUser.uid, nextPlaylist).catch((err) => {
                      setFbFatalError(err instanceof Error ? err : new Error(String(err)));
                    });
                  }
                }}
              />
            </div>
          )}

          {/* 4. Dedicated 128x64 Touchpad Studio */}
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

          {/* 5. Dedicated Weather & Profile */}
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
              onShowWeatherOnOled={() => {
                handleSelectSpecialScreen('weather');
                setNavSection('control');
              }}
              onShowGreetingOnOled={() => {
                handleSelectSpecialScreen('greeting');
                setNavSection('control');
              }}
            />
          )}

          {/* 6. Dedicated Alarms & Buzzer */}
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

          {/* 7. Dedicated WiFi & Hardware (with Vercel Cloud Anywhere Sync & OTA) */}
          {navSection === 'hardware' && (
            <HardwarePanel
              hardware={hardware}
              onUpdateHardware={handleUpdateHardware}
              onChangeGreenLedMode={handleChangeGreenLedMode}
              onTestBuzzer={handleTestBuzzer}
              onSaveWifiCredentials={handleSaveWifiCredentials}
              wifiSaveStatus={wifiSaveStatus}
              onPingEsp32={handlePingEsp32}
              pingStatus={pingStatus}
              onPushCloudState={() => pushStateToCloud(false)}
              onTriggerOtaUpdate={handleTriggerOtaUpdate}
              cloudSyncStatus={cloudSyncStatus}
            />
          )}

          {/* 8. Dedicated ESP32 Firmware */}
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

        {/* Quiet Professional Footer — Muhib Creation */}
        <footer className="mt-auto border-t border-slate-200 bg-white px-4 sm:px-6 lg:px-8 py-4">
          <div className="max-w-[1280px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <div className="font-medium text-slate-700">
              Muhib Creation · FaceBot ESP32 AI Portal
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setNavSection('dashboard')}
                className="hover:text-slate-900 transition-colors"
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={() => setNavSection('agent')}
                className="hover:text-slate-900 transition-colors"
              >
                AI Voice Agent
              </button>
              <button
                type="button"
                onClick={() => setNavSection('control')}
                className="hover:text-slate-900 transition-colors"
              >
                OLED Display
              </button>
              <button
                type="button"
                onClick={() => setNavSection('firmware')}
                className="hover:text-slate-900 transition-colors"
              >
                Firmware
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
