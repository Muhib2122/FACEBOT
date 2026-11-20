export type BotMode = 'auto' | 'user';

export type NavSection =
  | 'control'
  | 'touchpad'
  | 'weather'
  | 'alarms'
  | 'hardware'
  | 'firmware';

export type OledColorScheme = 'ice-blue' | 'white' | 'dual-yellow-blue';

export type ScreenKind =
  | 'face'
  | 'watch'
  | 'weather'
  | 'greeting'
  | 'custom-bitmap'
  | 'custom-text'
  | 'proximity-wake'
  | 'alarm';

export type ServoMotionStyle =
  | 'center'
  | 'happy-sway'
  | 'surprised-tilt'
  | 'angry-shake'
  | 'sleepy-droop'
  | 'look-around'
  | 'shiver';

export interface FaceDefinition {
  id: number;
  name: string;
  bengali: string;
  category: 'happy' | 'expressive' | 'sleepy' | 'moody' | 'playful';
  servoStyle: ServoMotionStyle;
}

export interface PlaylistItem {
  id: string;
  kind: 'face' | 'watch' | 'weather' | 'greeting' | 'custom-bitmap' | 'custom-text';
  label: string;
  durationSec: number;
  faceId?: number;
  customReactionId?: string;
  textMessage?: string;
  enabled: boolean;
}

export interface CustomReaction {
  id: string;
  name: string;
  createdAt: number;
  /** 128 * 64 = 8192 boolean pixels packed as 0 or 1 in Uint8Array serialized to number[] */
  pixels: number[];
  servoStyle: ServoMotionStyle;
  caption?: string;
}

export interface AlarmItem {
  id: string;
  time: string; // HH:MM (24h)
  label: string;
  enabled: boolean;
  days: number[]; // 0=Sun..6=Sat
  faceId: number;
  melody: 'classic' | 'gentle' | 'urgent';
}

export interface LocationConfig {
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timezone: string;
}

export interface WeatherData {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  conditionLabel: string;
  isDay: boolean;
  elevation: number;
  utcOffsetSeconds: number;
  timezone: string;
  updatedAt: string;
  isSimulatedCold?: boolean;
}

export type AnimationSpeed = 'slow' | 'normal' | 'fast';

export interface HardwareConfig {
  servoManualOverride: boolean;
  servoAngle: number; // 0..180, center 90
  servoAutoSync: boolean;
  servoPowerOffWhenIdle: boolean;
  ultrasonicEnabled: boolean;
  trackingEnabled: boolean;
  wakeDistanceCm: number; // default 25
  trackingRangeCm: number; // default 60
  simulatedDistanceCm: number; // 2..150
  simulatedUserAngle: number; // 30..150 (90 = center)
  buzzerMuted: boolean;
  redLedManual: boolean | null;
  greenLedManual: boolean | null;
  oledScheme: OledColorScheme;
  animationSpeed: AnimationSpeed;
  esp32Ip: string;
  esp32Connected: boolean;
  wifiSsid: string;
  wifiPassword: string;
}

export interface BotSettings {
  userName: string;
  coldThresholdC: number;
  hotThresholdC: number;
  autoSleepTimeoutSec: number;
  use24HourClock: boolean;
  wakeGreetingPrefix: string;
}

export interface ActiveScreenState {
  kind: ScreenKind;
  faceId: number;
  customReactionId?: string;
  textLine1?: string;
  textLine2?: string;
  alarmId?: string;
  locked?: boolean;
}

export const FACE_DEFINITIONS: FaceDefinition[] = [
  { id: 0, name: 'Normal Blink', bengali: 'স্বাভাবিক ও চোখের পলক', category: 'happy', servoStyle: 'center' },
  { id: 1, name: 'Super Happy', bengali: 'খুব খুশি', category: 'happy', servoStyle: 'happy-sway' },
  { id: 2, name: 'Cute Wink', bengali: 'চোখ মারা', category: 'playful', servoStyle: 'happy-sway' },
  { id: 3, name: 'Freezing Cold', bengali: 'শীতে কাঁপা', category: 'expressive', servoStyle: 'shiver' },
  { id: 4, name: 'In Love', bengali: 'ভালোবাসার চোখ', category: 'happy', servoStyle: 'happy-sway' },
  { id: 5, name: 'Angry', bengali: 'রাগান্বিত', category: 'moody', servoStyle: 'angry-shake' },
  { id: 6, name: 'Surprised', bengali: 'অবাক', category: 'expressive', servoStyle: 'surprised-tilt' },
  { id: 7, name: 'Sleepy', bengali: 'ঘুমন্ত', category: 'sleepy', servoStyle: 'sleepy-droop' },
  { id: 8, name: 'Cool Shades', bengali: 'সানগ্লাস', category: 'playful', servoStyle: 'center' },
  { id: 9, name: 'Sad Puppy', bengali: 'মন খারাপ', category: 'moody', servoStyle: 'sleepy-droop' },
  { id: 10, name: 'Crying', bengali: 'কান্না', category: 'moody', servoStyle: 'shiver' },
  { id: 11, name: 'Dizzy', bengali: 'মাথা ঘোরা', category: 'expressive', servoStyle: 'look-around' },
  { id: 12, name: 'Starry Eyed', bengali: 'উত্তেজিত', category: 'happy', servoStyle: 'happy-sway' },
  { id: 13, name: 'Skeptical', bengali: 'সন্দেহজনক', category: 'expressive', servoStyle: 'surprised-tilt' },
  { id: 14, name: 'Cheeky Tongue', bengali: 'জিহ্বা বের করা', category: 'playful', servoStyle: 'happy-sway' },
  { id: 15, name: 'Kawaii Cat', bengali: 'কিউট বিড়াল', category: 'playful', servoStyle: 'happy-sway' },
  { id: 16, name: 'Knocked Out', bengali: 'X_X চোখ', category: 'sleepy', servoStyle: 'sleepy-droop' },
  { id: 17, name: 'Thinking', bengali: 'চিন্তাশীল', category: 'expressive', servoStyle: 'surprised-tilt' },
  { id: 18, name: 'Shy Blushing', bengali: 'লজ্জা পাওয়া', category: 'happy', servoStyle: 'center' },
  { id: 19, name: 'Angry Shout', bengali: 'চিৎকার করা', category: 'moody', servoStyle: 'angry-shake' },
  { id: 20, name: 'Cyclops Alien', bengali: 'এক চোখ', category: 'playful', servoStyle: 'look-around' },
  { id: 21, name: 'Money Eyes', bengali: 'ডলার চোখ', category: 'playful', servoStyle: 'happy-sway' },
  { id: 22, name: 'Robot Scan', bengali: 'স্ক্যানিং মোড', category: 'expressive', servoStyle: 'look-around' },
  { id: 23, name: 'Smug Proud', bengali: 'গর্বিত হাসি', category: 'happy', servoStyle: 'center' },
  { id: 24, name: 'Looking Around', bengali: 'ডানে-বামে তাকানো', category: 'expressive', servoStyle: 'look-around' },
];
