import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AlarmItem,
  BotMode,
  BotSettings,
  CustomReaction,
  HardwareConfig,
  InteractionEvent,
  LocationConfig,
  PlaylistItem,
} from '../types';

const ID_SAFE_REGEX = /[^a-zA-Z0-9_-]/g;

export function sanitizeFirestoreId(raw: string, fallbackPrefix = 'id'): string {
  const cleaned = raw.replace(ID_SAFE_REGEX, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : `${fallbackPrefix}_${Date.now()}`;
}

export function pixelsToHex2048(pixels: number[]): string {
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
  return hex.padEnd(2048, '0').slice(0, 2048);
}

export function hex2048ToPixels(hex: string): number[] {
  const pixels = new Array<number>(128 * 64).fill(0);
  if (!hex || hex.length < 2048) return pixels;
  for (let i = 0; i < 1024; i++) {
    const byteVal = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    const y = Math.floor(i / 16);
    const xb = i % 16;
    for (let bit = 0; bit < 8; bit++) {
      pixels[y * 128 + xb * 8 + bit] = (byteVal >> (7 - bit)) & 1;
    }
  }
  return pixels;
}

function clampNum(val: number, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : fallback;
  return (s.length > 0 ? s : fallback).slice(0, maxLen);
}

export interface WorkspaceInput {
  mode: BotMode;
  settings: BotSettings;
  location: LocationConfig;
  hardware: HardwareConfig;
  activeFaceId: number;
}

function buildSanitizedWorkspaceFields(uid: string, input: WorkspaceInput) {
  const safeDeviceId = sanitizeFirestoreId(input.hardware.deviceId || 'muhib-bot-1', 'bot').slice(
    0,
    32
  );
  return {
    ownerId: uid,
    mode: input.mode === 'user' ? 'user' : 'auto',
    userName: cleanStr(input.settings.userName, 32, 'Muhib'),
    coldThresholdC: clampNum(input.settings.coldThresholdC, -40, 40, 18),
    hotThresholdC: clampNum(input.settings.hotThresholdC, 10, 60, 34),
    autoSleepTimeoutSec: clampNum(input.settings.autoSleepTimeoutSec, 10, 3600, 90),
    use24HourClock: Boolean(input.settings.use24HourClock),
    wakeGreetingPrefix: cleanStr(input.settings.wakeGreetingPrefix, 20, 'Hi'),
    city: cleanStr(input.location.city, 48, 'Dhaka'),
    country: cleanStr(input.location.country, 48, 'Bangladesh'),
    latitude: clampNum(input.location.latitude, -90, 90, 23.8103),
    longitude: clampNum(input.location.longitude, -180, 180, 90.4125),
    altitude: clampNum(input.location.altitude, -500, 9000, 4),
    timezone: cleanStr(input.location.timezone, 48, 'Asia/Dhaka'),
    wifiSsid: cleanStr(input.hardware.wifiSsid, 48, 'muhib'),
    greenLedMode: (['auto', 'on', 'blink', 'off'] as const).includes(input.hardware.greenLedMode)
      ? input.hardware.greenLedMode
      : 'auto',
    oledScheme: (['ice-blue', 'white', 'dual-yellow-blue'] as const).includes(
      input.hardware.oledScheme
    )
      ? input.hardware.oledScheme
      : 'ice-blue',
    animationSpeed: (['slow', 'normal', 'fast'] as const).includes(input.hardware.animationSpeed)
      ? input.hardware.animationSpeed
      : 'normal',
    esp32Ip: cleanStr(input.hardware.esp32Ip, 80, ''),
    cloudSyncEnabled: Boolean(input.hardware.cloudSyncEnabled),
    cloudBackendType:
      input.hardware.cloudBackendType === 'firebase-rtdb' ? 'firebase-rtdb' : 'vercel-api',
    cloudPortalUrl: cleanStr(input.hardware.cloudPortalUrl, 160, ''),
    firebaseDbUrl: cleanStr(input.hardware.firebaseDbUrl, 200, ''),
    deviceId: safeDeviceId,
    firmwareVersion: cleanStr(input.hardware.firmwareVersion, 16, '3.0.0'),
    otaAutoCheck: Boolean(input.hardware.otaAutoCheck),
    buzzerMuted: Boolean(input.hardware.buzzerMuted),
    activeFaceId: Math.round(clampNum(input.activeFaceId, 0, 24, 0)),
  };
}

/**
 * Ensures /users/{uid} parent workspace exists (required by Master Gate before subcollection writes)
 * and persists updated settings/hardware/location fields.
 */
export async function saveWorkspaceToFirestore(
  uid: string,
  input: WorkspaceInput
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const fields = buildSanitizedWorkspaceFields(uid, input);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const { ownerId: _omitOwner, ...updatable } = fields;
      await updateDoc(ref, {
        ...updatable,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveAlarmToFirestore(uid: string, alarm: AlarmItem): Promise<void> {
  const alarmId = sanitizeFirestoreId(alarm.id, 'al');
  const path = `users/${uid}/alarms/${alarmId}`;
  const ref = doc(db, 'users', uid, 'alarms', alarmId);

  const safeTime = /^[0-2][0-9]:[0-5][0-9]$/.test(alarm.time) ? alarm.time : '07:00';
  const safeDays = Array.isArray(alarm.days)
    ? alarm.days
        .map((d) => Math.round(clampNum(d, 0, 6, 0)))
        .slice(0, 7)
    : [0, 1, 2, 3, 4, 5, 6];
  const safeMelody = (['classic', 'gentle', 'urgent'] as const).includes(alarm.melody)
    ? alarm.melody
    : 'classic';

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        time: safeTime,
        label: cleanStr(alarm.label, 32, 'Alarm'),
        enabled: Boolean(alarm.enabled),
        days: safeDays,
        faceId: Math.round(clampNum(alarm.faceId, 0, 24, 1)),
        melody: safeMelody,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        time: safeTime,
        label: cleanStr(alarm.label, 32, 'Alarm'),
        enabled: Boolean(alarm.enabled),
        days: safeDays,
        faceId: Math.round(clampNum(alarm.faceId, 0, 24, 1)),
        melody: safeMelody,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function toggleAlarmInFirestore(
  uid: string,
  alarmIdRaw: string,
  enabled: boolean
): Promise<void> {
  const alarmId = sanitizeFirestoreId(alarmIdRaw, 'al');
  const path = `users/${uid}/alarms/${alarmId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'alarms', alarmId), {
      enabled: Boolean(enabled),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAlarmFromFirestore(uid: string, alarmIdRaw: string): Promise<void> {
  const alarmId = sanitizeFirestoreId(alarmIdRaw, 'al');
  const path = `users/${uid}/alarms/${alarmId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'alarms', alarmId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveReactionToFirestore(
  uid: string,
  reaction: CustomReaction
): Promise<void> {
  const rxId = sanitizeFirestoreId(reaction.id, 'rx');
  const path = `users/${uid}/reactions/${rxId}`;
  const ref = doc(db, 'users', uid, 'reactions', rxId);
  const hex = pixelsToHex2048(reaction.pixels);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        name: cleanStr(reaction.name, 40, 'Custom Art'),
        pixelsHex: hex,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        name: cleanStr(reaction.name, 40, 'Custom Art'),
        pixelsHex: hex,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteReactionFromFirestore(
  uid: string,
  reactionIdRaw: string
): Promise<void> {
  const rxId = sanitizeFirestoreId(reactionIdRaw, 'rx');
  const path = `users/${uid}/reactions/${rxId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'reactions', rxId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveInteractionToFirestore(
  uid: string,
  event: InteractionEvent,
  dateKey: string
): Promise<void> {
  const evId = sanitizeFirestoreId(event.id, 'ev');
  const path = `users/${uid}/interactions/${evId}`;
  const safeDateKey = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateKey)
    ? dateKey
    : new Date().toISOString().slice(0, 10);

  try {
    await setDoc(doc(db, 'users', uid, 'interactions', evId), {
      ownerId: uid,
      dateKey: safeDateKey,
      hour: Math.round(clampNum(event.hour, 0, 23, 0)),
      timestampMs: clampNum(event.timestamp, 1, Number.MAX_SAFE_INTEGER, Date.now()),
      category: (['ai-voice', 'oled-face', 'alarm', 'hardware'] as const).includes(event.category)
        ? event.category
        : 'oled-face',
      label: cleanStr(event.label, 80, 'Interaction'),
      source: (['portal', 'esp32', 'voice'] as const).includes(event.source)
        ? event.source
        : 'portal',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function clearTodayInteractionsInFirestore(
  uid: string,
  dateKey: string
): Promise<void> {
  const path = `users/${uid}/interactions`;
  try {
    const q = query(
      collection(db, 'users', uid, 'interactions'),
      where('ownerId', '==', uid),
      where('dateKey', '==', dateKey)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function savePlaylistToFirestore(
  uid: string,
  items: PlaylistItem[]
): Promise<void> {
  const path = `users/${uid}/playlist`;
  try {
    const colRef = collection(db, 'users', uid, 'playlist');
    const existingSnap = await getDocs(query(colRef, where('ownerId', '==', uid)));
    const keepIds = new Set<string>();

    for (let idx = 0; idx < Math.min(items.length, 50); idx++) {
      const item = items[idx];
      const itemId = sanitizeFirestoreId(item.id, 'pl');
      keepIds.add(itemId);
      const ref = doc(db, 'users', uid, 'playlist', itemId);
      const alreadyExists = existingSnap.docs.some((d) => d.id === itemId);

      const safeKind = (
        ['face', 'watch', 'weather', 'greeting', 'custom-bitmap', 'custom-text'] as const
      ).includes(item.kind)
        ? item.kind
        : 'face';

      const common = {
        orderIndex: idx,
        kind: safeKind,
        label: cleanStr(item.label, 48, 'Screen'),
        durationSec: Math.round(clampNum(item.durationSec, 1, 300, 5)),
        enabled: Boolean(item.enabled),
        faceId: Math.round(clampNum(item.faceId ?? 0, 0, 24, 0)),
        customReactionId: cleanStr(item.customReactionId ?? '', 64, ''),
        textMessage: cleanStr(item.textMessage ?? '', 40, ''),
      };

      if (!alreadyExists) {
        await setDoc(ref, {
          ownerId: uid,
          ...common,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...common,
          updatedAt: serverTimestamp(),
        });
      }
    }

    for (const d of existingSnap.docs) {
      if (!keepIds.has(d.id)) {
        await deleteDoc(d.ref);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
