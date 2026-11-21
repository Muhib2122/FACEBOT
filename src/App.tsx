import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  BellOff,
  Check,
  CloudCheck,
  CloudSun,
  Cpu,
  Film,
  Image as ImageIcon,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Mic,
  Pause,
  PenTool,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Timer,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import {
  clearTodayInteractionsInFirestore,
  deleteAlarmFromFirestore,
  deleteGalleryShotFromFirestore,
  deleteGifFromFirestore,
  deleteReactionFromFirestore,
  hex2048ToPixels,
  pixelsToHex2048,
  saveAlarmToFirestore,
  saveGalleryShotToFirestore,
  saveGifToFirestore,
  saveInteractionToFirestore,
  savePlaylistToFirestore,
  saveReactionToFirestore,
  saveWorkspaceToFirestore,
  toggleAlarmInFirestore,
  updateGifSpeedInFirestore,
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
  OledScreenshot,
  PlaylistItem,
  SavedGifItem,
  WeatherData,
} from './types';
import { PRESET_CITIES, fetchLiveWeather } from './utils/weatherApi';
import {
  playAlarmMelody,
  playBuzzerTest,
  playShortClick,
  playWakeChime,
  playWifiStatusBuzzer5Sec,
  stopBuzzerAudio,
  unlockBuzzerAudio,
} from './utils/buzzerAudio';
import { DashboardPanel } from './components/DashboardPanel';
import { OledHardwareStage } from './components/OledHardwareStage';
import { AiAgentPanel } from './components/AiAgentPanel';
import { ControlPanel } from './components/ControlPanel';
import { TouchpadStudio } from './components/TouchpadStudio';
import { GifStudioPanel } from './components/GifStudioPanel';
import { GalleryPanel } from './components/GalleryPanel';
import { WeatherProfilePanel } from './components/WeatherProfilePanel';
import { AlarmsPanel } from './components/AlarmsPanel';
import { HardwarePanel } from './components/HardwarePanel';
import { IntroSplashScreen } from './components/IntroSplashScreen';
import { WifiStatusOledToast } from './components/WifiStatusOledToast';
import { generateBootLogoPixels, generateWifiStatusPixels } from './utils/oledRenderer';
import { createStarterGifs } from './utils/gifOledCodec';

const BRAND_LOGO_URL = '/assets/aistudio/image_d35aba0a.png';

const STORAGE_KEY = 'facebot_esp32_portal_v1';
const INTERACTIONS_STORAGE_KEY = 'facebot_daily_interactions_v1';
const GIFS_STORAGE_KEY = 'facebot_saved_gifs_v1';
const WEATHER_CACHE_KEY = 'facebot_cached_weather_v1';

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
  firmwareVersion: '4.1.0',
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
      { id: 'gifs', label: 'GIF Studio', icon: Film },
      { id: 'gallery', label: 'Gallery', icon: ImageIcon },
      { id: 'alarms', label: 'Alarms & Buzzer', icon: Bell },
    ],
  },
  {
    title: 'Device & Setup',
    items: [
      { id: 'weather', label: 'Weather & Profile', icon: CloudSun },
      { id: 'hardware', label: 'WiFi & Hardware', icon: Cpu },
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

function loadSavedGifs(): SavedGifItem[] {
  try {
    const raw = localStorage.getItem(GIFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (g): g is SavedGifItem =>
            Boolean(g) &&
            typeof g.id === 'string' &&
            typeof g.name === 'string' &&
            Array.isArray(g.framesHex) &&
            g.framesHex.length > 0
        );
        return valid;
      }
    }
  } catch {
    // Fallback to starter animations
  }
  return createStarterGifs();
}

function loadCachedWeather(): WeatherData | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.temperature === 'number') {
      return parsed as WeatherData;
    }
  } catch {
    // ignore
  }
  return null;
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
  const modeRef = useRef<BotMode>(mode);
  modeRef.current = mode;
  // Remembers preferred online mode ('user' or 'auto') so WiFi reconnect automatically restores User Mode!
  const preferredOnlineModeRef = useRef<BotMode>(saved?.mode === 'user' ? 'user' : 'auto');
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
  const [galleryScreenshots, setGalleryScreenshots] = useState<OledScreenshot[]>(
    Array.isArray(saved?.galleryScreenshots) ? saved.galleryScreenshots : []
  );
  const [savedGifs, setSavedGifs] = useState<SavedGifItem[]>(() => loadSavedGifs());

  // Daily Interaction Analytics State
  const [interactionEvents, setInteractionEvents] = useState<InteractionEvent[]>(() =>
    loadTodayInteractions()
  );
  const [esp32HourlyOverrides, setEsp32HourlyOverrides] = useState<number[] | null>(null);
  const [esp32SyncStatus, setEsp32SyncStatus] = useState<string | null>(null);

  // Focus Pomodoro OLED Timer State (Wall-clock accurate, smooth 1s updates with zero 1.2s stutter)
  const [pomodoroSecondsLeft, setPomodoroSecondsLeft] = useState(25 * 60);
  const [pomodoroTotalSec, setPomodoroTotalSec] = useState(25 * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroLabel, setPomodoroLabel] = useState('FOCUS');
  const [pomodoroEndAtMs, setPomodoroEndAtMs] = useState<number>(0);
  const pomodoroEndAtMsRef = useRef<number>(0);
  const pomodoroSecondsLeftRef = useRef<number>(25 * 60);
  pomodoroSecondsLeftRef.current = pomodoroSecondsLeft;
  const lastSyncedTimerSecRef = useRef<number>(-1);

  // Live Runtime States (Weather cached locally so offline Auto Mode keeps weather + alarms working)
  const [frame, setFrame] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [isSleeping, setIsSleeping] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const isOnlineRef = useRef<boolean>(isOnline);
  isOnlineRef.current = isOnline;
  // Unified Real-Time Connectivity (Physical ESP32 Heartbeat + Portal WiFi Network)
  const [esp32HardwareOnline, setEsp32HardwareOnline] = useState<boolean>(false);
  const [esp32EverSeen, setEsp32EverSeen] = useState<boolean>(false);
  const [esp32LastSeenAt, setEsp32LastSeenAt] = useState<number>(0);
  const esp32HardwareOnlineRef = useRef<boolean>(false);
  const esp32EverSeenRef = useRef<boolean>(false);
  // Effective Bot WiFi Online State:
  // - If Portal WiFi/Network is OFF -> ALWAYS false (immediate Auto Mode + 5s WiFi OFF alert)
  // - If physical ESP32 has connected -> strictly tracks live ESP32 hardware heartbeat
  // - Before physical ESP32 pairs -> tracks live Portal WiFi so User Mode & automatic WiFi ON/OFF alerts always work!
  const esp32Online = isOnline && (esp32EverSeen ? esp32HardwareOnline : true);
  const esp32OnlineRef = useRef<boolean>(esp32Online);
  esp32OnlineRef.current = esp32Online;
  const lastEffectiveOnlineRef = useRef<boolean>(esp32Online);
  const lastConfirmedEsp32SeenAtRef = useRef<number>(0);
  const missedHeartbeatCountRef = useRef<number>(0);
  const lastWifiAlertMetaRef = useRef<{ connected: boolean; atMs: number }>({
    connected: esp32Online,
    atMs: 0,
  });
  const [wifiOverlay, setWifiOverlay] = useState<{ connected: boolean; secondsLeft: number } | null>(null);
  const wifiOverlayIntervalRef = useRef<number | null>(null);
  const [globalSyncing, setGlobalSyncing] = useState(false);
  const [globalSyncFeedback, setGlobalSyncFeedback] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(() => loadCachedWeather());
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

  const [showIntroSplash, setShowIntroSplash] = useState(true);
  const [activeScreen, setActiveScreen] = useState<ActiveScreenState>({
    kind: 'boot-logo',
    faceId: 1,
    locked: true,
  });
  const activeScreenRef = useRef<ActiveScreenState>(activeScreen);
  activeScreenRef.current = activeScreen;
  const bootLogoTimerRef = useRef<number | null>(null);
  const wifiStatusTimerRef = useRef<number | null>(null);
  const wifiBuzzerIntervalRef = useRef<number | null>(null);
  const wifiPriorityUntilMsRef = useRef<number>(0);
  const prevScreenBeforeWifiRef = useRef<ActiveScreenState | null>(null);
  const bootDayKeyRef = useRef<string>(getTodayKey());

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
  const alarmTestSeqRef = useRef(0);
  const alarmTestSlotRef = useRef(0);
  const otaTriggerSeqRef = useRef(0);

  // Unlock browser Web Audio API on the very first click/tap so scheduled alarms ALWAYS ring loud
  useEffect(() => {
    const unlock = () => unlockBuzzerAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Keep latest local state accessible during initial first-login migration
  const latestLocalStateRef = useRef({
    mode,
    settings,
    location,
    hardware,
    alarms,
    customReactions,
    galleryScreenshots,
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
    galleryScreenshots,
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
          for (const shot of snapLocal.galleryScreenshots.slice(0, 20)) {
            await saveGalleryShotToFirestore(uid, shot);
          }
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

        // 6. Live OLED Screenshot Gallery Listener
        const galleryQ = query(
          collection(db, 'users', uid, 'gallery'),
          where('ownerId', '==', uid)
        );
        unsubs.push(
          onSnapshot(
            galleryQ,
            (snap) => {
              const loaded: OledScreenshot[] = snap.docs.map((d) => {
                const v = d.data();
                return {
                  id: d.id,
                  title: String(v.title || 'OLED Screenshot'),
                  screenKind: String(v.screenKind || 'face'),
                  oledScheme:
                    v.oledScheme === 'white' || v.oledScheme === 'dual-yellow-blue'
                      ? v.oledScheme
                      : 'ice-blue',
                  pixelsHex: String(v.pixelsHex || ''),
                  capturedAtMs:
                    typeof v.capturedAtMs === 'number'
                      ? v.capturedAtMs
                      : v.createdAt?.toMillis?.() ?? Date.now(),
                };
              });
              loaded.sort((a, b) => b.capturedAtMs - a.capturedAtMs);
              setGalleryScreenshots(loaded);
            },
            (err) => {
              try {
                handleFirestoreError(err, OperationType.LIST, `users/${uid}/gallery`);
              } catch (e) {
                setFbFatalError(e instanceof Error ? e : new Error(String(e)));
              }
            }
          )
        );

        // 7. Live Permanent Animated GIFs Listener (Stored in Google Firestore, NOT on ESP32)
        const gifsQ = query(
          collection(db, 'users', uid, 'gifs'),
          where('ownerId', '==', uid)
        );
        let didInitialGifsHydrate = false;
        unsubs.push(
          onSnapshot(
            gifsQ,
            (snap) => {
              const loaded: SavedGifItem[] = snap.docs
                .map((d) => {
                  const v = d.data();
                  const frames = Array.isArray(v.framesHex)
                    ? v.framesHex.filter((f): f is string => typeof f === 'string' && f.length >= 2048)
                    : [];
                  return {
                    id: d.id,
                    name: String(v.name || 'facebot_gif'),
                    frameDelayMs: typeof v.frameDelayMs === 'number' ? v.frameDelayMs : 100,
                    framesHex: frames,
                    threshold: typeof v.threshold === 'number' ? v.threshold : 128,
                    inverted: Boolean(v.inverted),
                    createdAt:
                      typeof v.createdAtMs === 'number'
                        ? v.createdAtMs
                        : v.createdAt?.toMillis?.() ?? Date.now(),
                  };
                })
                .filter((g) => g.framesHex.length > 0);
              loaded.sort((a, b) => b.createdAt - a.createdAt);

              if (!didInitialGifsHydrate && loaded.length === 0) {
                didInitialGifsHydrate = true;
                // First-time Firestore hydration: preserve any local GIFs permanently into Firestore
                const localGifs = loadSavedGifs();
                if (localGifs.length > 0) {
                  setSavedGifs(localGifs);
                  Promise.all(localGifs.slice(0, 15).map((g) => saveGifToFirestore(uid, g))).catch(
                    (err) => {
                      console.warn('Initial GIF Firestore seed warning:', err);
                    }
                  );
                  return;
                }
              }
              didInitialGifsHydrate = true;
              setSavedGifs(loaded);
            },
            (err) => {
              try {
                handleFirestoreError(err, OperationType.LIST, `users/${uid}/gifs`);
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
          galleryScreenshots: galleryScreenshots.slice(0, 30),
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [mode, settings, location, hardware, playlist, alarms, customReactions, galleryScreenshots]);

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

  // Persist Animated GIF Gallery in its own localStorage bucket so large GIFs never block main state
  useEffect(() => {
    try {
      localStorage.setItem(GIFS_STORAGE_KEY, JSON.stringify(savedGifs.slice(0, 30)));
    } catch {
      // Ignore quota exceeded
    }
  }, [savedGifs]);

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
    let textLine1 = activeScreen.textLine1 || '';
    let textLine2 = activeScreen.textLine2 || '';

    if (activeScreen.locked) {
      if (activeScreen.kind === 'custom-text') {
        screenName = 'text';
      } else if (activeScreen.kind === 'timer') {
        screenName = 'text';
        const remSec =
          activeScreen.timerPausedSec !== undefined
            ? activeScreen.timerPausedSec
            : activeScreen.timerEndAtMs
              ? Math.max(0, Math.ceil((activeScreen.timerEndAtMs - Date.now()) / 1000))
              : pomodoroSecondsLeftRef.current;
        const mm = String(Math.floor(remSec / 60)).padStart(2, '0');
        const ss = String(remSec % 60).padStart(2, '0');
        textLine1 = `${(activeScreen.timerLabel || pomodoroLabel || 'FOCUS').toUpperCase()} TIMER`;
        textLine2 = `${mm}:${ss}`;
      } else if (
        activeScreen.kind === 'custom-bitmap' ||
        activeScreen.kind === 'boot-logo' ||
        activeScreen.kind === 'custom-gif' ||
        activeScreen.kind === 'wifi-status'
      ) {
        screenName = 'bitmap';
      } else {
        screenName = activeScreen.kind;
      }
    }

    const mappedAlarms = alarms.slice(0, 8).map((a) => {
      const [hh, mm] = a.time.split(':').map(Number);
      const melody = a.melody === 'gentle' ? 1 : a.melody === 'urgent' ? 2 : 0;
      return {
        hour: Number.isFinite(hh) ? hh : 7,
        min: Number.isFinite(mm) ? mm : 0,
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
      textLine1,
      textLine2,
      userName: settings.userName || 'Muhib',
      city: location.city || 'Dhaka',
      greenLed:
        activeScreen.kind === 'wifi-status' || wifiPriorityUntilMsRef.current > Date.now()
          ? 'blink'
          : hardware.greenLedMode,
      buzzerSeq: buzzerSeqRef.current,
      buzzerMode: lastBuzzerModeRef.current,
      bitmapSeq: bitmapSeqRef.current,
      bitmapHex: lastBitmapHexRef.current,
      alarms: mappedAlarms,
      alarmDismissSeq: alarmDismissSeqRef.current,
      alarmTestSeq: alarmTestSeqRef.current,
      alarmTestSlot: alarmTestSlotRef.current,
      otaTriggerSeq: otaTriggerSeqRef.current,
      timerActive: pomodoroRunning,
      timerLabel: pomodoroLabel,
      timerEndAtMs: pomodoroRunning ? pomodoroEndAtMsRef.current : 0,
      timerEndEpochSec: pomodoroRunning ? Math.round(pomodoroEndAtMsRef.current / 1000) : 0,
      timerDurationSec: pomodoroTotalSec,
      wifiOfflineAuto: true,
      wifiPriorityUntilMs:
        wifiPriorityUntilMsRef.current > Date.now() ? wifiPriorityUntilMsRef.current : 0,
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
    pomodoroRunning,
    pomodoroLabel,
    pomodoroTotalSec,
  ]);

  const getBotStateEndpoint = useCallback(
    (extraQuery = '') => {
      const deviceId = encodeURIComponent((hardware.deviceId || 'muhib-bot-1').trim());
      const base = hardware.cloudPortalUrl.trim().replace(/\/$/, '');
      const qs = `device=${deviceId}${extraQuery ? `&${extraQuery}` : ''}`;
      return base && typeof window !== 'undefined' && base !== window.location.origin
        ? `${base}/api/bot-state?${qs}`
        : `/api/bot-state?${qs}`;
    },
    [hardware.deviceId, hardware.cloudPortalUrl]
  );

  const pushStateToCloud = useCallback(
    async (silent = false) => {
      if (!hardware.cloudSyncEnabled && silent) return;

      const payload = buildCloudPayload();

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
          const endpoint = getBotStateEndpoint();

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(`Cloud bridge responded ${res.status}`);
          try {
            const data = await res.json();
            if (typeof data?.esp32LastSeenAt === 'number' && data.esp32LastSeenAt > 0) {
              setEsp32LastSeenAt(data.esp32LastSeenAt);
            }
          } catch {
            // Ignore non-JSON body
          }
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
      getBotStateEndpoint,
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

  // Fetch Live Weather from Open-Meteo whenever location changes (and cache locally for offline Auto Mode)
  const refreshWeather = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setWeatherError('Offline — using last synced weather in Auto Mode.');
      return;
    }
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const data = await fetchLiveWeather(location);
      setWeather(data);
      try {
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
      } catch {
        // Ignore storage quota
      }
    } catch {
      setWeatherError('Offline or weather API unreachable — keeping last synced weather.');
    } finally {
      setWeatherLoading(false);
    }
  }, [location]);

  useEffect(() => {
    refreshWeather();
    const interval = window.setInterval(refreshWeather, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshWeather]);

  // #1 TOP PRIORITY 5-second WiFi ON / OFF OLED Screen + 5-second Buzzer + 5-second Green LED (overrides Auto/User mode & every page!)
  const triggerWifiStatusScreen = useCallback(
    (connected: boolean, forceReplay = false) => {
      const nowMs = Date.now();
      // Deduplicate simultaneous browser-event + fetch-error triggers for the same state within 1.5s
      if (
        !forceReplay &&
        lastWifiAlertMetaRef.current.atMs > 0 &&
        lastWifiAlertMetaRef.current.connected === connected &&
        nowMs - lastWifiAlertMetaRef.current.atMs < 1500
      ) {
        return;
      }
      lastWifiAlertMetaRef.current = { connected, atMs: nowMs };

      if (wifiStatusTimerRef.current) {
        window.clearTimeout(wifiStatusTimerRef.current);
        wifiStatusTimerRef.current = null;
      }
      if (wifiOverlayIntervalRef.current) {
        window.clearInterval(wifiOverlayIntervalRef.current);
        wifiOverlayIntervalRef.current = null;
      }
      if (wifiBuzzerIntervalRef.current) {
        window.clearInterval(wifiBuzzerIntervalRef.current);
        wifiBuzzerIntervalRef.current = null;
      }
      if (bootLogoTimerRef.current) {
        window.clearTimeout(bootLogoTimerRef.current);
        bootLogoTimerRef.current = null;
      }

      // Snapshot previous active screen so it resumes smoothly after the 5-second WiFi priority page
      if (activeScreenRef.current.kind !== 'wifi-status') {
        prevScreenBeforeWifiRef.current = activeScreenRef.current;
      }

      const durationMs = 5000;
      const expiresAt = Date.now() + durationMs;
      wifiPriorityUntilMsRef.current = expiresAt;

      setIsSleeping(false);

      // 5-Second Piezo Buzzer Alert on BOTH WiFi ON & WiFi OFF (Portal speaker + Physical ESP32 GPIO 14)
      playWifiStatusBuzzer5Sec(connected, hardware.buzzerMuted);
      const hwBuzzerMode = connected ? 'happy' : 'alarm';
      const triggerEsp32BuzzerPulse = () => {
        lastBuzzerModeRef.current = hwBuzzerMode;
        buzzerSeqRef.current += 1;
        setCloudEventSeq((s) => s + 1);
        sendToEsp32(`/api/buzzer?mode=${hwBuzzerMode}`);
      };
      triggerEsp32BuzzerPulse();
      let pulseCount = 1;
      wifiBuzzerIntervalRef.current = window.setInterval(() => {
        if (pulseCount >= 4 || Date.now() >= expiresAt - 200) {
          if (wifiBuzzerIntervalRef.current) {
            window.clearInterval(wifiBuzzerIntervalRef.current);
            wifiBuzzerIntervalRef.current = null;
          }
          return;
        }
        pulseCount += 1;
        triggerEsp32BuzzerPulse();
      }, 1250);

      // Push 128x64 WiFi ON / OFF emoji bitmap to ESP32 with #1 top priority
      postBitmapToEsp32(generateWifiStatusPixels(connected));

      if (!connected) {
        // WiFi lost -> automatically switch bot to AUTO mode while keeping cached weather, alarms & clock
        setMode('auto');
      } else {
        // WiFi restored -> refresh weather immediately
        void refreshWeather();
      }

      setActiveScreen({
        kind: 'wifi-status',
        faceId: connected ? 1 : 9,
        wifiConnected: connected,
        locked: true,
      });

      // Show live 5-second OLED WiFi Emoji overlay on EVERY page
      setWifiOverlay({ connected, secondsLeft: 5 });
      wifiOverlayIntervalRef.current = window.setInterval(() => {
        const rem = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        if (rem <= 0) {
          if (wifiOverlayIntervalRef.current) {
            window.clearInterval(wifiOverlayIntervalRef.current);
            wifiOverlayIntervalRef.current = null;
          }
          setWifiOverlay(null);
        } else {
          setWifiOverlay({ connected, secondsLeft: rem });
        }
      }, 150);

      logInteraction(
        'hardware',
        connected
          ? 'WiFi Connected · 5s Priority OLED + 5s Buzzer'
          : 'WiFi OFF · Auto Mode · 5s Priority OLED + 5s Buzzer',
        'esp32'
      );

      // Hold WiFi ON / OFF page at #1 priority for exactly 5 seconds, then stop buzzer & restore previous page/mode
      wifiStatusTimerRef.current = window.setTimeout(() => {
        wifiPriorityUntilMsRef.current = 0;
        setWifiOverlay(null);
        if (wifiOverlayIntervalRef.current) {
          window.clearInterval(wifiOverlayIntervalRef.current);
          wifiOverlayIntervalRef.current = null;
        }
        if (wifiBuzzerIntervalRef.current) {
          window.clearInterval(wifiBuzzerIntervalRef.current);
          wifiBuzzerIntervalRef.current = null;
        }
        stopBuzzerAudio();

        const previous = prevScreenBeforeWifiRef.current;
        prevScreenBeforeWifiRef.current = null;

        setActiveScreen((prev) => {
          if (prev.kind !== 'wifi-status') return prev;
          if (pomodoroEndAtMsRef.current > Date.now()) {
            return {
              kind: 'timer',
              faceId: 0,
              timerLabel: previous?.timerLabel || 'FOCUS',
              timerEndAtMs: pomodoroEndAtMsRef.current,
              timerTotalSec: previous?.timerTotalSec || 25 * 60,
              locked: true,
            };
          }
          if (previous && previous.kind !== 'boot-logo' && previous.kind !== 'wifi-status') {
            return previous;
          }
          return { kind: 'face', faceId: connected ? 1 : 0, locked: false };
        });
      }, durationMs);
    },
    [hardware.buzzerMuted, refreshWeather, postBitmapToEsp32, logInteraction, sendToEsp32]
  );

  const dismissWifiOverlay = useCallback(() => {
    wifiPriorityUntilMsRef.current = 0;
    if (wifiStatusTimerRef.current) {
      window.clearTimeout(wifiStatusTimerRef.current);
      wifiStatusTimerRef.current = null;
    }
    if (wifiOverlayIntervalRef.current) {
      window.clearInterval(wifiOverlayIntervalRef.current);
      wifiOverlayIntervalRef.current = null;
    }
    if (wifiBuzzerIntervalRef.current) {
      window.clearInterval(wifiBuzzerIntervalRef.current);
      wifiBuzzerIntervalRef.current = null;
    }
    stopBuzzerAudio();
    setWifiOverlay(null);
    const previous = prevScreenBeforeWifiRef.current;
    prevScreenBeforeWifiRef.current = null;
    setActiveScreen((prev) => {
      if (prev.kind !== 'wifi-status') return prev;
      if (pomodoroEndAtMsRef.current > Date.now()) {
        return {
          kind: 'timer',
          faceId: 0,
          timerLabel: previous?.timerLabel || 'FOCUS',
          timerEndAtMs: pomodoroEndAtMsRef.current,
          timerTotalSec: previous?.timerTotalSec || 25 * 60,
          locked: true,
        };
      }
      if (previous && previous.kind !== 'boot-logo' && previous.kind !== 'wifi-status') {
        return previous;
      }
      return { kind: 'face', faceId: 0, locked: false };
    });
  }, []);

  // Centralized Unified Connectivity Transition Engine:
  // Handles BOTH Physical ESP32 WiFi ON/OFF AND Portal Network WiFi ON/OFF automatically!
  const applyConnectivityTransition = useCallback(
    (
      nextNetOnline: boolean,
      nextHwOnline: boolean | null,
      lastSeenAt?: number,
      forceImmediate = false
    ) => {
      const nowMs = Date.now();
      isOnlineRef.current = nextNetOnline;
      setIsOnline(nextNetOnline);

      let resolvedHwOnline = esp32HardwareOnlineRef.current;
      let resolvedEverSeen = esp32EverSeenRef.current;
      let justPairedPhysicalEsp32 = false;

      if (!nextNetOnline) {
        resolvedHwOnline = false;
        esp32HardwareOnlineRef.current = false;
        setEsp32HardwareOnline(false);
      } else if (nextHwOnline !== null) {
        if (nextHwOnline) {
          if (!resolvedEverSeen) {
            justPairedPhysicalEsp32 = true;
          }
          resolvedEverSeen = true;
          resolvedHwOnline = true;
          esp32EverSeenRef.current = true;
          esp32HardwareOnlineRef.current = true;
          setEsp32EverSeen(true);
          setEsp32HardwareOnline(true);
          lastConfirmedEsp32SeenAtRef.current = nowMs;
          missedHeartbeatCountRef.current = 0;
          setEsp32LastSeenAt(typeof lastSeenAt === 'number' && lastSeenAt > 0 ? lastSeenAt : nowMs);
        } else if (resolvedEverSeen && resolvedHwOnline) {
          // Smart offline detection:
          // - If warm server explicitly reports lastSeenAt > 0 & esp32Online === false (>=12s elapsed), go offline IMMEDIATELY!
          // - Only debounce 3 polls (~6s) if lastSeenAt === 0 (cold Vercel serverless instance shield)
          const confirmedStaleByWarmServer = typeof lastSeenAt === 'number' && lastSeenAt > 0;
          if (forceImmediate || confirmedStaleByWarmServer) {
            resolvedHwOnline = false;
            esp32HardwareOnlineRef.current = false;
            setEsp32HardwareOnline(false);
          } else {
            missedHeartbeatCountRef.current += 1;
            const msSinceConfirmed = nowMs - lastConfirmedEsp32SeenAtRef.current;
            if (msSinceConfirmed >= 6000 && missedHeartbeatCountRef.current >= 3) {
              resolvedHwOnline = false;
              esp32HardwareOnlineRef.current = false;
              setEsp32HardwareOnline(false);
            }
          }
        }
      }

      const nextEffectiveOnline = nextNetOnline && (resolvedEverSeen ? resolvedHwOnline : true);
      const prevEffectiveOnline = lastEffectiveOnlineRef.current;
      lastEffectiveOnlineRef.current = nextEffectiveOnline;
      esp32OnlineRef.current = nextEffectiveOnline;

      if (prevEffectiveOnline !== nextEffectiveOnline) {
        if (!nextEffectiveOnline) {
          // WiFi OFF -> remember active mode, automatically switch to Auto Mode, lock User Mode & fire 5s OLED+Buzzer+LED!
          if (modeRef.current === 'user') {
            preferredOnlineModeRef.current = 'user';
          }
          setMode('auto');
          triggerWifiStatusScreen(false);
        } else {
          // WiFi ON -> unlock User Mode, automatically restore preferred User Mode if active before, & fire 5s OLED+Buzzer+LED!
          if (preferredOnlineModeRef.current === 'user') {
            setMode('user');
            sendToEsp32('/api/mode?mode=user');
          }
          triggerWifiStatusScreen(true);
        }
      } else if (justPairedPhysicalEsp32) {
        // Physical ESP32 just connected to WiFi & checked into Cloud for the first time -> fire 5s WiFi ON alert!
        triggerWifiStatusScreen(true);
      }
    },
    [triggerWifiStatusScreen, sendToEsp32]
  );

  // Strict Offline Auto-Mode Lock: prevent User Mode from ever staying active while WiFi/ESP32 is Offline
  useEffect(() => {
    if (!esp32Online && mode !== 'auto') {
      if (mode === 'user') {
        preferredOnlineModeRef.current = 'user';
      }
      setMode('auto');
    }
  }, [esp32Online, mode]);

  // Poll Real ESP32 Bot Heartbeat & Live Network Reachability every 2s (0-2s automatic WiFi OFF/ON detection!)
  const pollEsp32Heartbeat = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      applyConnectivityTransition(false, false, 0, true);
      return false;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 3000);
    try {
      const endpoint = getBotStateEndpoint('source=portal');
      const res = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const hwOnline = Boolean(data?.esp32Online);
        const lastSeen = typeof data?.esp32LastSeenAt === 'number' ? data.esp32LastSeenAt : 0;
        applyConnectivityTransition(true, hwOnline, lastSeen);
        return esp32OnlineRef.current;
      }
      // Server responded with HTTP error but network IS reachable
      applyConnectivityTransition(true, null);
    } catch {
      window.clearTimeout(timeoutId);
      // Fallback: check local ESP32 LAN IP directly if user is on local WiFi without internet
      const ip = hardware.esp32Ip.trim();
      if (ip) {
        try {
          const base = ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`;
          const lanRes = await fetch(`${base}/api/stats`, { cache: 'no-store' });
          if (lanRes.ok) {
            applyConnectivityTransition(true, true, Date.now(), true);
            return true;
          }
        } catch {
          // LAN also unreachable
        }
      }
      // Network/WiFi is genuinely unreachable -> immediately switch to Offline Auto Mode + 5s WiFi OFF Alert!
      applyConnectivityTransition(false, false, 0, true);
    }
    return esp32OnlineRef.current;
  }, [getBotStateEndpoint, hardware.esp32Ip, applyConnectivityTransition]);

  // Automatic Real-Time WiFi Online / Offline Monitor (0ms browser events + 2s active probe + tab-resume check)
  useEffect(() => {
    const handleBrowserOnline = () => {
      // Immediately reflect WiFi restoration & fire 5s WiFi ON alert + restore mode, then verify ESP32 heartbeat
      applyConnectivityTransition(true, esp32EverSeenRef.current ? null : null, 0, true);
      void pollEsp32Heartbeat();
    };
    const handleBrowserOffline = () => {
      // Immediately fire 5s WiFi OFF OLED + Buzzer + LED + Auto Mode switch (0ms lag!)
      applyConnectivityTransition(false, false, 0, true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void pollEsp32Heartbeat();
      }
    };

    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const navConn = (
      navigator as Navigator & {
        connection?: {
          addEventListener?: (t: string, cb: () => void) => void;
          removeEventListener?: (t: string, cb: () => void) => void;
        };
      }
    ).connection;
    const handleConnectionChange = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        applyConnectivityTransition(false, false, 0, true);
      } else {
        void pollEsp32Heartbeat();
      }
    };
    navConn?.addEventListener?.('change', handleConnectionChange);

    void pollEsp32Heartbeat();

    const heartbeatId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void pollEsp32Heartbeat();
    }, 2000);

    return () => {
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      navConn?.removeEventListener?.('change', handleConnectionChange);
      window.clearInterval(heartbeatId);
      if (wifiStatusTimerRef.current) {
        window.clearTimeout(wifiStatusTimerRef.current);
      }
      if (wifiOverlayIntervalRef.current) {
        window.clearInterval(wifiOverlayIntervalRef.current);
      }
      if (wifiBuzzerIntervalRef.current) {
        window.clearInterval(wifiBuzzerIntervalRef.current);
      }
    };
  }, [pollEsp32Heartbeat, applyConnectivityTransition]);

  // Global Full-System Sync Handler (available on EVERY page in the top header bar)
  const handleGlobalSync = useCallback(async () => {
    if (globalSyncing) return;
    setGlobalSyncing(true);
    setGlobalSyncFeedback(null);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      applyConnectivityTransition(false, false, 0, true);
      triggerWifiStatusScreen(false, true);
      setGlobalSyncFeedback('Offline · Auto Mode');
      setGlobalSyncing(false);
      window.setTimeout(() => setGlobalSyncFeedback(null), 2600);
      return;
    }

    try {
      const tasks: Promise<unknown>[] = [
        pushStateToCloud(false),
        refreshWeather(),
        pollEsp32Heartbeat(),
        hardware.esp32Ip.trim() ? handleSyncEsp32Stats() : Promise.resolve(),
      ];

      if (fbUser && fbUser.emailVerified) {
        tasks.push(
          saveWorkspaceToFirestore(fbUser.uid, {
            mode,
            settings,
            location,
            hardware,
            activeFaceId: activeScreen.faceId,
          }),
          savePlaylistToFirestore(fbUser.uid, playlist)
        );
      }

      await Promise.allSettled(tasks);
      sendToEsp32(`/api/mode?mode=${mode}`);
      playShortClick(hardware.buzzerMuted);
      setGlobalSyncFeedback('Synced');
      logInteraction('hardware', `Full System Sync (${mode.toUpperCase()} mode)`, 'portal');
    } catch {
      setGlobalSyncFeedback('Sync Failed');
    } finally {
      setGlobalSyncing(false);
      window.setTimeout(() => setGlobalSyncFeedback(null), 2400);
    }
  }, [
    globalSyncing,
    applyConnectivityTransition,
    triggerWifiStatusScreen,
    pushStateToCloud,
    refreshWeather,
    pollEsp32Heartbeat,
    hardware,
    fbUser,
    mode,
    settings,
    location,
    activeScreen.faceId,
    playlist,
    handleSyncEsp32Stats,
    sendToEsp32,
    logInteraction,
  ]);

  const handleGlobalModeSwitch = useCallback(
    (nextMode: BotMode) => {
      // Strictly block User Mode while WiFi/ESP32 is Offline
      if (nextMode === 'user' && !esp32OnlineRef.current) {
        playShortClick(hardware.buzzerMuted);
        setMode('auto');
        return;
      }
      preferredOnlineModeRef.current = nextMode;
      if (mode === nextMode) return;
      setMode(nextMode);
      playShortClick(hardware.buzzerMuted);
      sendToEsp32(`/api/mode?mode=${nextMode}`);
      setActiveScreen((prev) =>
        prev.kind === 'timer' || prev.kind === 'alarm' || prev.kind === 'wifi-status'
          ? prev
          : { ...prev, locked: false }
      );
      logInteraction('oled-face', `Switched to ${nextMode.toUpperCase()} Mode`, 'portal');
    },
    [mode, hardware.buzzerMuted, sendToEsp32, logInteraction]
  );

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

  // 1-Second Clock & Real Alarm Checker (Works seamlessly online AND offline in Auto Mode!)
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = new Date();
      setNow(current);

      const hh = String(current.getHours()).padStart(2, '0');
      const mm = String(current.getMinutes()).padStart(2, '0');
      const key = `${hh}:${mm}`;
      const dayIdx = current.getDay();

      if (key !== lastAlarmMinuteRef.current) {
        const matched = alarms.find(
          (a) => a.enabled && a.time === key && a.days.includes(dayIdx)
        );
        if (matched) {
          lastAlarmMinuteRef.current = key;
          const slotIdx = Math.max(0, alarms.findIndex((a) => a.id === matched.id));
          alarmTestSlotRef.current = slotIdx;
          alarmTestSeqRef.current += 1;
          setCloudEventSeq((s) => s + 1);
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

  // Smooth Wall-Clock Focus Timer (24-FPS portal OLED + server-computed ESP32 cloud countdown + 1s LAN push)
  useEffect(() => {
    if (!pomodoroRunning) {
      lastSyncedTimerSecRef.current = -1;
      return;
    }
    if (!pomodoroEndAtMsRef.current || pomodoroEndAtMsRef.current <= Date.now()) {
      const nextEnd = Date.now() + Math.max(1, pomodoroSecondsLeftRef.current) * 1000;
      pomodoroEndAtMsRef.current = nextEnd;
      setPomodoroEndAtMs(nextEnd);
    }

    const tickTimer = () => {
      const remaining = Math.max(0, Math.ceil((pomodoroEndAtMsRef.current - Date.now()) / 1000));
      setPomodoroSecondsLeft((prev) => (prev === remaining ? prev : remaining));

      // Push exact 1s update over local LAN only if esp32Ip is configured and WiFi priority banner isn't active
      if (
        remaining > 0 &&
        remaining !== lastSyncedTimerSecRef.current &&
        wifiPriorityUntilMsRef.current <= Date.now()
      ) {
        lastSyncedTimerSecRef.current = remaining;
        const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
        const ss = String(remaining % 60).padStart(2, '0');
        sendToEsp32(
          `/api/screen?kind=text&l1=${encodeURIComponent(`${pomodoroLabel} TIMER`)}&l2=${encodeURIComponent(`${mm}:${ss}`)}`
        );
      }

      if (remaining <= 0) {
        lastSyncedTimerSecRef.current = 0;
        setPomodoroRunning(false);
        pomodoroEndAtMsRef.current = 0;
        setPomodoroEndAtMs(0);
        playWakeChime(hardware.buzzerMuted);
        lastBuzzerModeRef.current = 'happy';
        buzzerSeqRef.current += 1;
        setCloudEventSeq((s) => s + 1);
        setActiveScreen({
          kind: 'custom-text',
          faceId: 1,
          textLine1: `${pomodoroLabel} DONE!`,
          textLine2: 'NICE JOB!',
          locked: true,
        });
        sendToEsp32(
          `/api/screen?kind=text&l1=${encodeURIComponent(`${pomodoroLabel} DONE!`)}&l2=NICE`
        );
        sendToEsp32('/api/buzzer?mode=happy');
        logInteraction('hardware', `Focus Timer Completed (${pomodoroLabel})`, 'portal');
      }
    };

    tickTimer();
    const id = window.setInterval(tickTimer, 100);
    return () => window.clearInterval(id);
  }, [
    pomodoroRunning,
    pomodoroLabel,
    hardware.buzzerMuted,
    sendToEsp32,
    logInteraction,
  ]);

  const handleStartPomodoro = useCallback(
    (totalSeconds: number, label: string) => {
      const safeSec = Math.max(5, Math.round(totalSeconds));
      const endAtMs = Date.now() + safeSec * 1000;
      pomodoroEndAtMsRef.current = endAtMs;
      setPomodoroEndAtMs(endAtMs);
      lastSyncedTimerSecRef.current = safeSec;
      setPomodoroLabel(label);
      setPomodoroTotalSec(safeSec);
      setPomodoroSecondsLeft(safeSec);
      setPomodoroRunning(true);
      setIsSleeping(false);
      setActiveAlarm(null);
      playShortClick(hardware.buzzerMuted);
      setActiveScreen({
        kind: 'timer',
        faceId: 0,
        timerLabel: label,
        timerEndAtMs: endAtMs,
        timerTotalSec: safeSec,
        locked: true,
      });
      const mm = String(Math.floor(safeSec / 60)).padStart(2, '0');
      const ss = String(safeSec % 60).padStart(2, '0');
      sendToEsp32(
        `/api/screen?kind=text&l1=${encodeURIComponent(`${label} TIMER`)}&l2=${encodeURIComponent(`${mm}:${ss}`)}`
      );
      logInteraction('hardware', `Started OLED ${label} Timer (${mm}:${ss})`, 'portal');
    },
    [hardware.buzzerMuted, sendToEsp32, logInteraction]
  );

  const handleTogglePomodoro = useCallback(() => {
    playShortClick(hardware.buzzerMuted);
    if (pomodoroRunning) {
      const left =
        pomodoroEndAtMsRef.current > 0
          ? Math.max(0, Math.ceil((pomodoroEndAtMsRef.current - Date.now()) / 1000))
          : pomodoroSecondsLeftRef.current;
      pomodoroEndAtMsRef.current = 0;
      setPomodoroEndAtMs(0);
      setPomodoroRunning(false);
      setPomodoroSecondsLeft(left);
      setActiveScreen({
        kind: 'timer',
        faceId: 0,
        timerLabel: pomodoroLabel,
        timerTotalSec: Math.max(pomodoroTotalSec, left, 1),
        timerPausedSec: left,
        locked: true,
      });
    } else {
      const resumeSec = pomodoroSecondsLeftRef.current > 0 ? pomodoroSecondsLeftRef.current : pomodoroTotalSec || 25 * 60;
      const endAtMs = Date.now() + resumeSec * 1000;
      pomodoroEndAtMsRef.current = endAtMs;
      setPomodoroEndAtMs(endAtMs);
      lastSyncedTimerSecRef.current = -1;
      setPomodoroSecondsLeft(resumeSec);
      setIsSleeping(false);
      setActiveAlarm(null);
      setPomodoroRunning(true);
      setActiveScreen({
        kind: 'timer',
        faceId: 0,
        timerLabel: pomodoroLabel,
        timerEndAtMs: endAtMs,
        timerTotalSec: Math.max(pomodoroTotalSec, resumeSec),
        locked: true,
      });
    }
  }, [pomodoroRunning, pomodoroLabel, pomodoroTotalSec, hardware.buzzerMuted]);

  const handleResetPomodoro = useCallback(() => {
    pomodoroEndAtMsRef.current = 0;
    setPomodoroEndAtMs(0);
    lastSyncedTimerSecRef.current = -1;
    setPomodoroRunning(false);
    setPomodoroTotalSec(25 * 60);
    setPomodoroSecondsLeft(25 * 60);
    setPomodoroLabel('FOCUS');
    setActiveScreen((prev) =>
      prev.kind === 'timer' ? { kind: 'face', faceId: 0, locked: false } : prev
    );
  }, []);

  // Repeating Piezo Buzzer (Bip-Bip-Bip) when an alarm is actively ringing
  useEffect(() => {
    if (!activeAlarm) {
      stopBuzzerAudio();
      return;
    }
    playAlarmMelody(activeAlarm.melody, hardware.buzzerMuted);
    const id = window.setInterval(() => {
      playAlarmMelody(activeAlarm.melody, hardware.buzzerMuted);
    }, 1250);
    return () => {
      window.clearInterval(id);
      stopBuzzerAudio();
    };
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

  // Compute Single Green LED (GPIO 26) State (smoothly timed at 24-FPS, #1 priority blink on WiFi ON/OFF!)
  const greenLedOn = useMemo(() => {
    if (activeScreen.kind === 'wifi-status') return Math.floor(frame / 3) % 2 === 0;
    if (hardware.greenLedMode === 'on') return true;
    if (hardware.greenLedMode === 'off') return false;
    if (hardware.greenLedMode === 'blink') return Math.floor(frame / 7) % 2 === 0;
    if (activeAlarm) return Math.floor(frame / 4) % 2 === 0;
    return !isSleeping;
  }, [activeScreen.kind, hardware.greenLedMode, frame, activeAlarm, isSleeping]);

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

  const triggerFiveSecBootLogo = useCallback(() => {
    // Never interrupt active 5-second top-priority WiFi ON/OFF alert page
    if (wifiPriorityUntilMsRef.current > Date.now()) {
      return;
    }
    if (bootLogoTimerRef.current) {
      window.clearTimeout(bootLogoTimerRef.current);
      bootLogoTimerRef.current = null;
    }
    setIsSleeping(false);
    setActiveAlarm(null);
    setActiveScreen({ kind: 'boot-logo', faceId: 1, locked: true });
    // Push 128x64 monochrome Muhib Creation logo bitmap to already-flashed ESP32 via Vercel Cloud!
    postBitmapToEsp32(generateBootLogoPixels());

    bootLogoTimerRef.current = window.setTimeout(() => {
      bootLogoTimerRef.current = null;
      setActiveScreen((prev) =>
        prev.kind === 'boot-logo' ? { kind: 'face', faceId: 0, locked: false } : prev
      );
    }, 5000);
  }, [postBitmapToEsp32]);

  // Trigger 5-second OLED & ESP32 Boot Logo on fresh system start
  const initialBootFiredRef = useRef(false);
  useEffect(() => {
    if (initialBootFiredRef.current) return;
    initialBootFiredRef.current = true;
    triggerFiveSecBootLogo();
    return () => {
      if (bootLogoTimerRef.current) {
        window.clearTimeout(bootLogoTimerRef.current);
      }
    };
  }, [triggerFiveSecBootLogo]);

  // Also trigger 5-second Boot Logo automatically at the start of every new day (midnight rollover)
  useEffect(() => {
    const todayKey = getTodayKey();
    if (todayKey !== bootDayKeyRef.current) {
      bootDayKeyRef.current = todayKey;
      triggerFiveSecBootLogo();
    }
  }, [now, triggerFiveSecBootLogo]);

  const handleWakeUp = () => {
    playWakeChime(hardware.buzzerMuted);
    sendToEsp32('/api/buzzer?mode=happy');
    triggerFiveSecBootLogo();
    logInteraction('oled-face', 'Bot Booted / Woken Up (5s Logo)', 'portal');
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
          ? `Alarm ${alarm.time} saved to Firebase Cloud and auto-synced to ESP32.`
          : hardware.cloudSyncEnabled
            ? `Alarm ${alarm.time} saved and auto-syncing to ESP32 via Vercel Cloud.`
            : hardware.esp32Ip.trim()
              ? `Alarm ${alarm.time} saved and synced to ESP32.`
              : `Alarm ${alarm.time} saved locally.`
      );
      logInteraction('alarm', `Set Alarm ${alarm.time} (${alarm.label})`, 'portal');
    },
    [fbUser, fbWorkspaceReady, hardware.cloudSyncEnabled, hardware.esp32Ip, syncSingleAlarmSlot, logInteraction]
  );

  const handleToggleAlarm = (id: string) => {
    const target = alarms.find((a) => a.id === id);
    if (!target) return;
    const nextEnabled = !target.enabled;
    setAlarms((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, enabled: nextEnabled } : a));
      next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
      return next;
    });
    if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
      toggleAlarmInFirestore(fbUser.uid, id, nextEnabled).catch((err) => {
        setFbFatalError(err instanceof Error ? err : new Error(String(err)));
      });
    }
  };

  const handleUpdateAlarmTime = useCallback(
    (id: string, newTime: string) => {
      const target = alarms.find((a) => a.id === id);
      if (!target || target.time === newTime) return;
      const committed: AlarmItem = { ...target, time: newTime };
      setAlarms((prev) => {
        const next = prev.map((a) => (a.id === id ? { ...a, time: newTime } : a));
        next.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
        return next;
      });
      if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
        saveAlarmToFirestore(fbUser.uid, committed).catch((err) => {
          setFbFatalError(err instanceof Error ? err : new Error(String(err)));
        });
      }
      setAlarmSyncMessage(
        `Re-timed "${committed.label}" to ${newTime} — auto-syncing to ESP32 via Vercel Cloud.`
      );
      logInteraction('alarm', `Re-timed Alarm "${committed.label}" to ${newTime}`, 'portal');
    },
    [alarms, fbUser, fbWorkspaceReady, syncSingleAlarmSlot, logInteraction]
  );

  const handleDismissAlarm = () => {
    stopBuzzerAudio();
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
    unlockBuzzerAudio();
    if (hardware.buzzerMuted) {
      setHardware((prev) => ({ ...prev, buzzerMuted: false }));
    }
    const slot = Math.max(0, alarms.findIndex((a) => a.id === alarm.id));
    alarmTestSlotRef.current = slot;
    alarmTestSeqRef.current += 1;
    lastBuzzerModeRef.current = 'alarm';
    buzzerSeqRef.current += 1;
    setCloudEventSeq((s) => s + 1);
    setIsSleeping(false);
    setActiveAlarm(alarm);
    setActiveScreen({
      kind: 'alarm',
      faceId: alarm.faceId,
      alarmId: alarm.id,
      locked: true,
    });
    sendToEsp32(`/api/alarm/test?slot=${slot}`);
    setAlarmSyncMessage(
      `Ringing "${alarm.label}" (Bip-Bip buzzer + Green LED) — syncing to ESP32 via Vercel Cloud!`
    );
    logInteraction('alarm', `Tested Alarm: ${alarm.label}`, 'portal');
  };

  const handleSnoozeAlarm = () => {
    if (!activeAlarm) return;
    stopBuzzerAudio();
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
    alarmDismissSeqRef.current += 1;
    setCloudEventSeq((s) => s + 1);
    sendToEsp32('/api/alarm/dismiss');
    handleAddAlarm(snoozedAlarm);
    setAlarmSyncMessage(`Snoozed for 5 minutes — next ring at ${snoozeTime}.`);
  };

  const handleSyncAllAlarmsToEsp32 = () => {
    alarms.slice(0, 8).forEach((item, idx) => syncSingleAlarmSlot(item, idx));
    void pushStateToCloud(false);
    setAlarmSyncMessage(
      hardware.cloudSyncEnabled
        ? `Synced ${Math.min(alarms.length, 8)} alarm(s) to Vercel Cloud (${hardware.deviceId || 'muhib-bot-1'}) — ESP32 updates within 1.2s!`
        : hardware.esp32Ip.trim()
          ? `Dispatched ${Math.min(alarms.length, 8)} alarm(s) to ${hardware.esp32Ip.trim()}.`
          : 'Enable Vercel Cloud Sync in WiFi & Hardware to push alarms to ESP32.'
    );
  };

  // Execute structured hardware & OLED actions returned by the AI Voice Agent
  const handleExecuteAgentAction = useCallback(
    (action: AgentActionResponse, source: 'portal' | 'voice'): string[] => {
      const badges: string[] = [];
      const clampedFace = Math.max(0, Math.min(24, Number(action.faceId) || 0));
      const faceDef = FACE_DEFINITIONS.find((f) => f.id === clampedFace);

      if (action.targetMode === 'auto' || action.targetMode === 'user') {
        if (action.targetMode === 'user' && !esp32OnlineRef.current) {
          setMode('auto');
          badges.push('User Mode Locked (Offline)');
        } else {
          preferredOnlineModeRef.current = action.targetMode;
          setMode(action.targetMode);
          sendToEsp32(`/api/mode?mode=${action.targetMode}`);
          badges.push(`Mode: ${action.targetMode.toUpperCase()}`);
        }
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
        `Saved Home WiFi "${ssid}" locally and synced with your cloud profile.`
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

  // Stream active Animated GIF frames to already-flashed ESP32 via Local LAN (/api/bitmap) and/or Vercel Cloud
  useEffect(() => {
    if (activeScreen.kind !== 'custom-gif' || !activeScreen.activeGifId || isSleeping || activeAlarm) {
      return;
    }
    const gif = savedGifs.find((g) => g.id === activeScreen.activeGifId);
    if (!gif || gif.framesHex.length === 0) return;

    const ip = hardware.esp32Ip.trim();
    const base = ip ? (ip.startsWith('http') ? ip.replace(/\/$/, '') : `http://${ip}`) : '';

    const pushFrameHexToLan = (hex: string) => {
      if (!base) return;
      fetch(`${base}/api/bitmap`, {
        method: 'POST',
        mode: 'no-cors',
        body: hex,
      }).catch(() => {});
    };

    // Push frame 0 immediately to both LAN and Cloud so ESP32 updates right away
    lastBitmapHexRef.current = gif.framesHex[0];
    bitmapSeqRef.current += 1;
    setCloudEventSeq((s) => s + 1);
    pushFrameHexToLan(gif.framesHex[0]);

    if (gif.framesHex.length <= 1) return;

    let lanIdx = 1;
    let lanTimer: number | null = null;
    if (base) {
      const lanDelay = Math.max(100, Math.min(1000, gif.frameDelayMs));
      lanTimer = window.setInterval(() => {
        const hex = gif.framesHex[lanIdx % gif.framesHex.length];
        lanIdx = (lanIdx + 1) % gif.framesHex.length;
        pushFrameHexToLan(hex);
      }, lanDelay);
    }

    let cloudIdx = 1;
    let cloudTimer: number | null = null;
    if (hardware.cloudSyncEnabled) {
      cloudTimer = window.setInterval(() => {
        const hex = gif.framesHex[cloudIdx % gif.framesHex.length];
        cloudIdx = (cloudIdx + 1) % gif.framesHex.length;
        lastBitmapHexRef.current = hex;
        bitmapSeqRef.current += 1;
        setCloudEventSeq((s) => s + 1);
      }, 1350);
    }

    return () => {
      if (lanTimer !== null) window.clearInterval(lanTimer);
      if (cloudTimer !== null) window.clearInterval(cloudTimer);
    };
  }, [
    activeScreen.kind,
    activeScreen.activeGifId,
    isSleeping,
    activeAlarm,
    savedGifs,
    hardware.esp32Ip,
    hardware.cloudSyncEnabled,
  ]);

  // Animated GIF Studio Handlers (Permanently persisted in Google Firestore)
  const handleSaveGif = useCallback(
    async (gif: SavedGifItem) => {
      setSavedGifs((prev) => [gif, ...prev.filter((g) => g.id !== gif.id)].slice(0, 60));
      playShortClick(hardware.buzzerMuted);
      if (fbUser && fbUser.emailVerified) {
        try {
          await saveGifToFirestore(fbUser.uid, gif);
        } catch (err) {
          setFbFatalError(err instanceof Error ? err : new Error(String(err)));
        }
      }
      logInteraction('oled-face', `Saved GIF to Firestore: ${gif.name} (${gif.framesHex.length} frames)`, 'portal');
    },
    [fbUser, hardware.buzzerMuted, logInteraction]
  );

  const handleSaveMultipleGifs = useCallback(
    async (gifs: SavedGifItem[]) => {
      if (gifs.length === 0) return;
      setSavedGifs((prev) => {
        const incomingIds = new Set(gifs.map((g) => g.id));
        return [...gifs, ...prev.filter((g) => !incomingIds.has(g.id))].slice(0, 60);
      });
      playShortClick(hardware.buzzerMuted);
      if (fbUser && fbUser.emailVerified) {
        for (const gif of gifs) {
          try {
            await saveGifToFirestore(fbUser.uid, gif);
          } catch (err) {
            setFbFatalError(err instanceof Error ? err : new Error(String(err)));
            break;
          }
        }
      }
      logInteraction('oled-face', `Saved ZIP Pack (${gifs.length} GIFs) to Firestore`, 'portal');
    },
    [fbUser, hardware.buzzerMuted, logInteraction]
  );

  const handleDeleteGif = useCallback(
    async (id: string) => {
      setSavedGifs((prev) => prev.filter((g) => g.id !== id));
      setActiveScreen((prev) =>
        prev.kind === 'custom-gif' && prev.activeGifId === id
          ? { kind: 'face', faceId: 0, locked: false }
          : prev
      );
      if (fbUser && fbUser.emailVerified) {
        try {
          await deleteGifFromFirestore(fbUser.uid, id);
        } catch (err) {
          setFbFatalError(err instanceof Error ? err : new Error(String(err)));
        }
      }
      logInteraction('oled-face', 'Deleted GIF permanently from Firestore', 'portal');
    },
    [fbUser, logInteraction]
  );

  const handlePlayGif = useCallback(
    (gif: SavedGifItem, speedOverrideMs?: number) => {
      const nextDelay = speedOverrideMs ?? gif.frameDelayMs;
      if (speedOverrideMs !== undefined && speedOverrideMs !== gif.frameDelayMs) {
        setSavedGifs((prev) =>
          prev.map((g) => (g.id === gif.id ? { ...g, frameDelayMs: nextDelay } : g))
        );
      }
      setIsSleeping(false);
      setActiveAlarm(null);
      setPomodoroRunning(false);
      setActiveScreen({
        kind: 'custom-gif',
        faceId: 0,
        activeGifId: gif.id,
        locked: true,
      });
      playShortClick(hardware.buzzerMuted);
      logInteraction('oled-face', `Playing GIF on OLED: ${gif.name}`, 'portal');
    },
    [hardware.buzzerMuted, logInteraction]
  );

  const handleStopGif = useCallback(() => {
    setActiveScreen({ kind: 'face', faceId: 0, locked: false });
    sendToEsp32('/api/mode?mode=auto');
    playShortClick(hardware.buzzerMuted);
  }, [hardware.buzzerMuted, sendToEsp32]);

  const handleUpdateGifSpeed = useCallback(
    (id: string, frameDelayMs: number) => {
      const clamped = Math.max(30, Math.min(1000, Math.round(frameDelayMs)));
      setSavedGifs((prev) =>
        prev.map((g) => (g.id === id ? { ...g, frameDelayMs: clamped } : g))
      );
      if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
        updateGifSpeedInFirestore(fbUser.uid, id, clamped).catch((err) => {
          console.warn('Could not persist GIF speed to Firestore:', err);
        });
      }
    },
    [fbUser, fbWorkspaceReady]
  );

  // Export all saved settings, alarms, custom reactions, playlist & gallery as a portable local JSON backup
  const handleExportBackup = useCallback((): string => {
    const savedReactions = customReactions
      .filter((r) => r.id !== 'live-touchpad-preview')
      .map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        pixelsHex: pixelsToHex2048(r.pixels),
        servoStyle: r.servoStyle || 'center',
      }));

    const backupPayload = {
      schema: 'facebot-esp32-backup',
      version: 1,
      app: 'Muhib Creation · FaceBot ESP32 AI Portal',
      exportedAt: new Date().toISOString(),
      mode,
      settings,
      location,
      hardware,
      alarms,
      playlist,
      customReactions: savedReactions,
      galleryScreenshots: galleryScreenshots.slice(0, 40),
      savedGifs: savedGifs.slice(0, 30),
    };

    const json = JSON.stringify(backupPayload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = `facebot-backup-${getTodayKey()}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logInteraction('hardware', `Exported JSON Backup (${filename})`, 'portal');
    return filename;
  }, [
    mode,
    settings,
    location,
    hardware,
    alarms,
    playlist,
    customReactions,
    galleryScreenshots,
    savedGifs,
    logInteraction,
  ]);

  // Restore all saved settings, alarms, custom reactions, playlist & gallery from a local JSON backup
  const handleImportBackup = useCallback(
    async (rawJson: string): Promise<{ ok: boolean; message: string }> => {
      let parsed: Record<string, unknown>;
      try {
        const obj = JSON.parse(rawJson);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          return { ok: false, message: 'Invalid backup file: root must be a JSON object.' };
        }
        parsed = obj as Record<string, unknown>;
      } catch {
        return { ok: false, message: 'Invalid JSON syntax. Please select a valid FaceBot backup file.' };
      }

      const hasKnownFields =
        'settings' in parsed ||
        'alarms' in parsed ||
        'customReactions' in parsed ||
        'hardware' in parsed ||
        'playlist' in parsed;
      if (!hasKnownFields) {
        return {
          ok: false,
          message: 'Unrecognized JSON file — no FaceBot settings, alarms, or reactions found.',
        };
      }

      const nextMode: BotMode = parsed.mode === 'user' ? 'user' : 'auto';
      const nextSettings: BotSettings = {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings && typeof parsed.settings === 'object'
          ? (parsed.settings as Partial<BotSettings>)
          : {}),
      };
      const nextLocation: LocationConfig = {
        ...DEFAULT_LOCATION,
        ...(parsed.location && typeof parsed.location === 'object'
          ? (parsed.location as Partial<LocationConfig>)
          : {}),
      };
      const nextHardware: HardwareConfig = {
        ...DEFAULT_HARDWARE,
        ...(parsed.hardware && typeof parsed.hardware === 'object'
          ? (parsed.hardware as Partial<HardwareConfig>)
          : {}),
      };

      const nextAlarms: AlarmItem[] = Array.isArray(parsed.alarms)
        ? parsed.alarms
            .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
            .slice(0, 20)
            .map((a, idx) => ({
              id: typeof a.id === 'string' && a.id.trim() ? a.id : `al-imp-${Date.now()}-${idx}`,
              time:
                typeof a.time === 'string' && /^[0-2][0-9]:[0-5][0-9]$/.test(a.time)
                  ? a.time
                  : '07:00',
              label: typeof a.label === 'string' && a.label.trim() ? a.label.slice(0, 32) : 'Alarm',
              enabled: Boolean(a.enabled),
              days: Array.isArray(a.days)
                ? a.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
                : [0, 1, 2, 3, 4, 5, 6],
              faceId: Math.max(0, Math.min(24, Math.round(Number(a.faceId) || 1))),
              melody:
                a.melody === 'gentle' || a.melody === 'urgent' ? a.melody : 'classic',
            }))
        : alarms;

      const nextReactions: CustomReaction[] = Array.isArray(parsed.customReactions)
        ? parsed.customReactions
            .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
            .slice(0, 30)
            .map((r, idx) => {
              const pixels =
                typeof r.pixelsHex === 'string' && r.pixelsHex.length >= 2048
                  ? hex2048ToPixels(r.pixelsHex)
                  : Array.isArray(r.pixels) && r.pixels.length === 128 * 64
                    ? r.pixels.map((p) => (p ? 1 : 0))
                    : new Array<number>(128 * 64).fill(0);
              return {
                id: typeof r.id === 'string' && r.id.trim() ? r.id : `rx-imp-${Date.now()}-${idx}`,
                name:
                  typeof r.name === 'string' && r.name.trim()
                    ? r.name.slice(0, 40)
                    : `Restored Art ${idx + 1}`,
                createdAt: Number(r.createdAt) || Date.now(),
                pixels,
                servoStyle: 'center',
              };
            })
        : customReactions;

      const nextPlaylist: PlaylistItem[] =
        Array.isArray(parsed.playlist) && parsed.playlist.length > 0
          ? parsed.playlist
              .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
              .slice(0, 50)
              .map((p, idx) => ({
                id: typeof p.id === 'string' && p.id.trim() ? p.id : `pl-imp-${idx}`,
                kind: (
                  ['face', 'watch', 'weather', 'greeting', 'custom-bitmap', 'custom-text'] as const
                ).includes(p.kind as PlaylistItem['kind'])
                  ? (p.kind as PlaylistItem['kind'])
                  : 'face',
                label: typeof p.label === 'string' ? p.label.slice(0, 48) : 'Screen',
                durationSec: Math.max(2, Math.min(300, Math.round(Number(p.durationSec) || 5))),
                enabled: Boolean(p.enabled),
                faceId: typeof p.faceId === 'number' ? Math.max(0, Math.min(24, p.faceId)) : 0,
                customReactionId:
                  typeof p.customReactionId === 'string' ? p.customReactionId : undefined,
                textMessage: typeof p.textMessage === 'string' ? p.textMessage : undefined,
              }))
          : playlist;

      const nextGallery: OledScreenshot[] = Array.isArray(parsed.galleryScreenshots)
        ? parsed.galleryScreenshots
            .filter((g): g is Record<string, unknown> => Boolean(g && typeof g === 'object'))
            .slice(0, 40)
            .map((g, idx) => ({
              id: typeof g.id === 'string' && g.id.trim() ? g.id : `shot-imp-${Date.now()}-${idx}`,
              title: typeof g.title === 'string' ? g.title.slice(0, 48) : 'Restored Capture',
              screenKind: typeof g.screenKind === 'string' ? g.screenKind.slice(0, 24) : 'face',
              oledScheme:
                g.oledScheme === 'white' || g.oledScheme === 'dual-yellow-blue'
                  ? g.oledScheme
                  : 'ice-blue',
              pixelsHex: String(g.pixelsHex || '').padEnd(2048, '0').slice(0, 2048),
              capturedAtMs: Number(g.capturedAtMs) || Date.now(),
            }))
        : galleryScreenshots;

      const nextGifs: SavedGifItem[] = Array.isArray(parsed.savedGifs)
        ? parsed.savedGifs
            .filter((g): g is Record<string, unknown> => Boolean(g && typeof g === 'object'))
            .slice(0, 30)
            .map((g, idx) => ({
              id: typeof g.id === 'string' && g.id.trim() ? g.id : `gif-imp-${Date.now()}-${idx}`,
              name:
                typeof g.name === 'string' && g.name.trim()
                  ? g.name.slice(0, 24)
                  : `restored_gif_${idx + 1}`,
              framesHex: Array.isArray(g.framesHex)
                ? g.framesHex
                    .filter((f): f is string => typeof f === 'string' && f.length >= 2048)
                    .slice(0, 30)
                    .map((f) => f.slice(0, 2048))
                : [],
              frameDelayMs: Math.max(30, Math.min(1000, Math.round(Number(g.frameDelayMs) || 100))),
              threshold: Math.max(10, Math.min(245, Math.round(Number(g.threshold) || 128))),
              inverted: Boolean(g.inverted),
              createdAt: Number(g.createdAt) || Date.now(),
            }))
            .filter((g) => g.framesHex.length > 0)
        : savedGifs;

      setMode(nextMode);
      setSettings(nextSettings);
      setLocation(nextLocation);
      setHardware(nextHardware);
      setAlarms(nextAlarms);
      setCustomReactions(nextReactions);
      setPlaylist(nextPlaylist);
      setGalleryScreenshots(nextGallery);
      setSavedGifs(nextGifs);
      setCloudEventSeq((s) => s + 1);

      // Sync restored backup to Firebase Firestore if user is signed in
      if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
        try {
          await saveWorkspaceToFirestore(fbUser.uid, {
            mode: nextMode,
            settings: nextSettings,
            location: nextLocation,
            hardware: nextHardware,
            activeFaceId: activeScreen.faceId,
          });
          for (const al of nextAlarms.slice(0, 12)) {
            await saveAlarmToFirestore(fbUser.uid, al);
          }
          for (const rx of nextReactions.slice(0, 20)) {
            await saveReactionToFirestore(fbUser.uid, rx);
          }
          await savePlaylistToFirestore(fbUser.uid, nextPlaylist);
          for (const shot of nextGallery.slice(0, 20)) {
            await saveGalleryShotToFirestore(fbUser.uid, shot);
          }
          for (const gif of nextGifs.slice(0, 30)) {
            await saveGifToFirestore(fbUser.uid, gif);
          }
        } catch (err) {
          console.warn('Partial Firestore sync after backup restore:', err);
        }
      }

      logInteraction(
        'hardware',
        `Restored JSON Backup (${nextAlarms.length} alarms, ${nextReactions.length} reactions, ${nextGifs.length} GIFs)`,
        'portal'
      );

      return {
        ok: true,
        message: `Restored backup: ${nextAlarms.length} alarm(s), ${nextReactions.length} custom reaction(s), ${nextPlaylist.length} playlist item(s), ${nextGallery.length} gallery capture(s), and ${nextGifs.length} GIF(s).`,
      };
    },
    [
      alarms,
      customReactions,
      playlist,
      galleryScreenshots,
      savedGifs,
      fbUser,
      fbWorkspaceReady,
      activeScreen.faceId,
      logInteraction,
    ]
  );

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

  const handleIntroFinish = useCallback(() => {
    setShowIntroSplash(false);
    triggerFiveSecBootLogo();
  }, [triggerFiveSecBootLogo]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Full-Screen 5-Second Animated Startup Intro Splash with Auto-Skip + Bottom Skip Option */}
      {showIntroSplash && (
        <IntroSplashScreen durationSec={5} onFinish={handleIntroFinish} />
      )}

      {/* Desktop Grouped Sidebar Navigation */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200">
          <img
            src={BRAND_LOGO_URL}
            alt="Muhib Creation FaceBot Logo"
            className="w-9 h-9 rounded-lg object-contain shrink-0"
            referrerPolicy="no-referrer"
          />
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
              <div className="flex items-center gap-2.5">
                <img
                  src={BRAND_LOGO_URL}
                  alt="FaceBot Logo"
                  className="w-7 h-7 rounded-md object-contain shrink-0"
                  referrerPolicy="no-referrer"
                />
                <span className="text-base font-bold text-slate-900">FaceBot Portal</span>
              </div>
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
        {/* Clean Global Top Header Bar (Visible on EVERY Page: Device Online/Offline + Auto/User Mode + Sync) */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="h-14 sm:h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
                aria-label="Open navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <img
                src={BRAND_LOGO_URL}
                alt="FaceBot Logo"
                className="w-7 h-7 rounded-md object-contain shrink-0 lg:hidden"
                referrerPolicy="no-referrer"
              />
              <div className="flex items-center gap-2 text-sm truncate">
                <span className="text-slate-400 hidden md:inline">FaceBot ESP32</span>
                <span className="text-slate-300 hidden md:inline" aria-hidden="true">/</span>
                <h1 className="font-semibold text-slate-900 truncate">
                  {currentSectionMeta?.label}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {fbUser ? (
                <div className="flex items-center gap-2">
                  <div className="hidden xl:flex items-center gap-1.5 text-xs text-slate-600 pr-1">
                    <CloudCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="font-medium text-slate-800 max-w-[120px] truncate">
                      {fbUser.displayName || fbUser.email}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogleSignOut}
                    className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Sign Out</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign in with Google</span>
                  <span className="sm:hidden">Sign In</span>
                </button>
              )}
            </div>
          </div>

          {/* Global Bot Control Strip — ALWAYS visible on EVERY page */}
          <div className="px-4 sm:px-6 lg:px-8 py-2 bg-slate-50/90 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            {/* Left: Real Physical ESP32 Bot WiFi Online / Offline Status + WiFi Emoji Quick Trigger */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  void pollEsp32Heartbeat().then((liveOnline) => {
                    triggerWifiStatusScreen(liveOnline, true);
                  });
                }}
                title={
                  esp32Online
                    ? esp32EverSeen
                      ? 'ESP32 Bot is connected to WiFi & syncing live. Click to preview 5s Priority WiFi Connected OLED + Buzzer + LED.'
                      : 'WiFi Online & Ready. Click to preview 5s Priority WiFi Connected OLED + Buzzer + LED.'
                    : 'WiFi / ESP32 Offline — Auto Mode Active & User Mode Locked. Click to re-check & preview 5s WiFi OFF OLED.'
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                  esp32Online
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    esp32Online ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  }`}
                />
                {esp32Online ? (
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                )}
                <span>
                  {esp32Online
                    ? esp32EverSeen
                      ? 'ESP32 Online'
                      : 'WiFi Online'
                    : !isOnline
                      ? 'WiFi Offline'
                      : 'ESP32 Offline'}
                </span>
                {esp32Online && esp32EverSeen && esp32LastSeenAt > 0 && (
                  <span className="hidden sm:inline text-[10px] font-normal text-emerald-700/80">
                    · WiFi Live
                  </span>
                )}
              </button>

              {/* Live Focus Timer Indicator across EVERY page when active */}
              {(pomodoroRunning || activeScreen.kind === 'timer') && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200 whitespace-nowrap">
                  <Timer className="w-3.5 h-3.5 text-blue-600" />
                  <span className="font-mono tabular-nums">
                    {String(Math.floor(pomodoroSecondsLeft / 60)).padStart(2, '0')}:
                    {String(pomodoroSecondsLeft % 60).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    onClick={handleTogglePomodoro}
                    className="ml-0.5 p-0.5 rounded hover:bg-blue-200/70 text-blue-700"
                    title={pomodoroRunning ? 'Pause Timer' : 'Resume Timer'}
                  >
                    {pomodoroRunning ? (
                      <Pause className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Right: Auto / User Mode Selector + Global Sync Button (EVERY page) */}
            <div className="flex items-center gap-2 ml-auto">
              <div
                className="inline-flex items-center bg-slate-200/80 p-0.5 rounded-lg border border-slate-200"
                role="group"
                aria-label="Bot Operation Mode"
              >
                <button
                  type="button"
                  onClick={() => handleGlobalModeSwitch('auto')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    mode === 'auto'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Auto Mode
                </button>
                <button
                  type="button"
                  disabled={!esp32Online}
                  onClick={() => handleGlobalModeSwitch('user')}
                  title={
                    esp32Online
                      ? 'Switch to User Mode custom playlist'
                      : 'ESP32 Offline — User Mode is locked until WiFi reconnects'
                  }
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    !esp32Online
                      ? 'text-slate-400 cursor-not-allowed opacity-60'
                      : mode === 'user'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {!esp32Online && <Lock className="w-3 h-3" />}
                  User Mode
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handleGlobalSync()}
                disabled={globalSyncing}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                  globalSyncFeedback === 'Synced'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 disabled:opacity-60'
                }`}
              >
                {globalSyncFeedback === 'Synced' ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <RefreshCw className={`w-3.5 h-3.5 ${globalSyncing ? 'animate-spin' : ''}`} />
                )}
                <span>{globalSyncFeedback || (globalSyncing ? 'Syncing...' : 'Sync')}</span>
              </button>
            </div>
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

        {(!esp32Online || !isOnline) && (
          <div className="bg-slate-900 text-slate-100 border-b border-slate-800 px-4 sm:px-6 lg:px-8 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                {!isOnline
                  ? 'Portal WiFi Offline — Bot running in Auto Mode with cached weather & alarms.'
                  : 'ESP32 Bot Offline — Waiting for ESP32 WiFi connection. Bot runs offline Auto Mode with cached weather & alarms until WiFi reconnects.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => triggerWifiStatusScreen(false, true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
            >
              <Wifi className="w-3 h-3" />
              Show 5s WiFi OFF OLED
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
              esp32Online={esp32Online}
              frame={frame}
              pomodoroSecondsLeft={pomodoroSecondsLeft}
              pomodoroTotalSec={pomodoroTotalSec}
              pomodoroRunning={pomodoroRunning}
              pomodoroLabel={pomodoroLabel}
              pomodoroEndAtMs={pomodoroEndAtMs}
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
              onStartPomodoro={handleStartPomodoro}
              onTogglePomodoro={handleTogglePomodoro}
              onResetPomodoro={handleResetPomodoro}
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
              esp32Online={esp32Online}
              hardware={hardware}
              activeScreen={activeScreen}
              activeAlarm={activeAlarm}
              customReactions={customReactions}
              savedGifs={savedGifs}
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
                savedGifs={savedGifs}
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
                onCaptureScreenshot={(pixels, title, screenKind) => {
                  const shot: OledScreenshot = {
                    id: `shot-${Date.now()}`,
                    title: title.slice(0, 48) || 'OLED Screenshot',
                    screenKind: screenKind.slice(0, 24) || 'face',
                    oledScheme: hardware.oledScheme,
                    pixelsHex: pixelsToHex2048(pixels),
                    capturedAtMs: Date.now(),
                  };
                  setGalleryScreenshots((prev) => [shot, ...prev].slice(0, 40));
                  playShortClick(hardware.buzzerMuted);
                  if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
                    saveGalleryShotToFirestore(fbUser.uid, shot).catch((err) => {
                      setFbFatalError(err instanceof Error ? err : new Error(String(err)));
                    });
                  }
                  logInteraction('oled-face', `Captured OLED Screenshot: ${shot.title}`, 'portal');
                }}
              />

              <ControlPanel
                mode={mode}
                esp32Online={esp32Online}
                activeScreen={activeScreen}
                oledScheme={hardware.oledScheme}
                playlist={playlist}
                customReactions={customReactions}
                onChangeMode={handleGlobalModeSwitch}
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

          {/* 4a. Dedicated Animated GIF Studio (GIF/ZIP Upload + Real-Time 128x64 Preview + Firestore Storage) */}
          {navSection === 'gifs' && (
            <GifStudioPanel
              oledScheme={hardware.oledScheme}
              savedGifs={savedGifs}
              activeGifId={
                activeScreen.kind === 'custom-gif' ? activeScreen.activeGifId ?? null : null
              }
              cloudSyncEnabled={hardware.cloudSyncEnabled}
              isSignedIn={Boolean(fbUser && fbUser.emailVerified)}
              onSignIn={handleGoogleSignIn}
              onSaveGif={handleSaveGif}
              onSaveMultipleGifs={handleSaveMultipleGifs}
              onDeleteGif={handleDeleteGif}
              onPlayGif={handlePlayGif}
              onStopGif={handleStopGif}
              onUpdateGifSpeed={handleUpdateGifSpeed}
            />
          )}

          {/* 4b. Dedicated OLED Screenshot Gallery (Firestore Backed) */}
          {navSection === 'gallery' && (
            <GalleryPanel
              screenshots={galleryScreenshots}
              isSignedIn={Boolean(fbUser && fbUser.emailVerified)}
              onSignIn={handleGoogleSignIn}
              onPushToOled={(shot) => {
                const decoded = hex2048ToPixels(shot.pixelsHex);
                handlePushLivePixels(decoded);
                setNavSection('control');
              }}
              onDeleteScreenshot={(id) => {
                setGalleryScreenshots((prev) => prev.filter((s) => s.id !== id));
                if (fbUser && fbUser.emailVerified && fbWorkspaceReady) {
                  deleteGalleryShotFromFirestore(fbUser.uid, id).catch((err) => {
                    setFbFatalError(err instanceof Error ? err : new Error(String(err)));
                  });
                }
              }}
              onGoToOled={() => setNavSection('control')}
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
              now={now}
              esp32Ip={hardware.esp32Ip}
              cloudSyncEnabled={hardware.cloudSyncEnabled}
              buzzerMuted={hardware.buzzerMuted}
              alarmSyncMessage={alarmSyncMessage}
              onAddAlarm={handleAddAlarm}
              onToggleAlarm={handleToggleAlarm}
              onUpdateAlarmTime={handleUpdateAlarmTime}
              onDeleteAlarm={handleDeleteAlarm}
              onTestAlarm={handleTestAlarm}
              onTestBuzzerBeep={() => {
                unlockBuzzerAudio();
                if (hardware.buzzerMuted) {
                  setHardware((prev) => ({ ...prev, buzzerMuted: false }));
                }
                handleTestBuzzer('tone');
              }}
              onDismissAlarm={handleDismissAlarm}
              onSnoozeAlarm={handleSnoozeAlarm}
              onSyncAllAlarmsToEsp32={handleSyncAllAlarmsToEsp32}
            />
          )}

          {/* 7. Dedicated WiFi & Hardware (with Vercel Cloud Anywhere Sync, OTA & JSON Backup) */}
          {navSection === 'hardware' && (
            <HardwarePanel
              hardware={hardware}
              backupCounts={{
                alarmsCount: alarms.length,
                reactionsCount: customReactions.filter((r) => r.id !== 'live-touchpad-preview').length,
                playlistCount: playlist.length,
                galleryCount: galleryScreenshots.length,
                gifsCount: savedGifs.length,
              }}
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
              onExportBackup={handleExportBackup}
              onImportBackup={handleImportBackup}
            />
          )}
        </main>

        {/* Quiet Professional Footer — Muhib Creation */}
        <footer className="mt-auto border-t border-slate-200 bg-white px-4 sm:px-6 lg:px-8 py-4">
          <div className="max-w-[1280px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-2 font-medium text-slate-700">
              <img
                src={BRAND_LOGO_URL}
                alt="Muhib Creation Logo"
                className="w-5 h-5 rounded object-contain shrink-0"
                referrerPolicy="no-referrer"
              />
              <span>Muhib Creation · FaceBot ESP32 AI Portal</span>
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
                onClick={() => setNavSection('gifs')}
                className="hover:text-slate-900 transition-colors"
              >
                GIF Studio
              </button>
              <button
                type="button"
                onClick={() => setNavSection('gallery')}
                className="hover:text-slate-900 transition-colors"
              >
                Gallery
              </button>
              <button
                type="button"
                onClick={() => setShowIntroSplash(true)}
                className="hover:text-slate-900 transition-colors"
              >
                Replay Intro
              </button>
            </div>
          </div>
        </footer>
      </div>

      {/* Global 10-Second Live OLED WiFi Connected / WiFi OFF Emoji Overlay (Visible on EVERY page) */}
      {wifiOverlay && (
        <WifiStatusOledToast
          connected={wifiOverlay.connected}
          secondsLeft={wifiOverlay.secondsLeft}
          frame={frame}
          oledScheme={hardware.oledScheme}
          onDismiss={dismissWifiOverlay}
        />
      )}
    </div>
  );
}
