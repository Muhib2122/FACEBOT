import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  ExternalLink,
  Globe,
  Headphones,
  Loader2,
  Mic,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  Send,
  Sliders,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ActiveScreenState,
  AgentActionResponse,
  AgentChatMessage,
  BotMode,
  BotSettings,
  CustomReaction,
  GreenLedMode,
  HardwareConfig,
  LocationConfig,
  WeatherData,
} from '../types';
import {
  paintBufferToCanvas,
  renderScreenToBuffer,
  SSD1306Buffer,
} from '../utils/oledRenderer';

interface AiAgentPanelProps {
  settings: BotSettings;
  location: LocationConfig;
  weather: WeatherData | null;
  now: Date;
  frame: number;
  mode: BotMode;
  isSleeping: boolean;
  greenLedOn: boolean;
  hardware: HardwareConfig;
  activeScreen: ActiveScreenState;
  activeAlarm: { id: string; time: string; label: string } | null;
  customReactions: CustomReaction[];
  alarmCount: number;
  todayInteractions: number;
  onExecuteAgentAction: (action: AgentActionResponse, source: 'portal' | 'voice') => string[];
  onChangeGreenLedMode: (mode: GreenLedMode) => void;
  onTestBuzzer: () => void;
}

type StudioVoiceName = 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';

const STUDIO_VOICES: { id: StudioVoiceName; label: string; tone: string }[] = [
  { id: 'Kore', label: 'Kore', tone: 'Crystal Clear' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Warm & Smooth' },
  { id: 'Puck', label: 'Puck', tone: 'Friendly' },
  { id: 'Charon', label: 'Charon', tone: 'Calm Deep' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Bold Crisp' },
];

const VOICE_SPEEDS: { value: number; label: string }[] = [
  { value: 0.88, label: '0.88x' },
  { value: 1.0, label: '1.0x' },
  { value: 1.15, label: '1.15x' },
];

const QUICK_PROMPTS = [
  { label: 'Kemon acho?', prompt: 'Hi FaceBot, kemon acho? Happy face dekhao!', search: false },
  { label: 'Ajker Weather', prompt: 'Ajker weather kemon? OLED te weather dekhao.', search: false },
  { label: 'LED Blink', prompt: 'Green LED blink koro r beep dao.', search: false },
  { label: 'Show Clock', prompt: 'Ekhon koyta baje? OLED te clock dekhao.', search: false },
  { label: 'Set 07:00 Alarm', prompt: 'Sokal 7 tay Wake Up alarm set koro.', search: false },
  { label: 'BD News (Web)', prompt: 'Ajker Bangladesh er top news ki?', search: true },
  { label: 'Good Night', prompt: 'Good night FaceBot, ghumiye poro r LED off koro.', search: false },
];

function float32ToBase64Pcm16(input: Float32Array): string {
  const int16 = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

function cleanErrorMessage(raw: string): string {
  const trimmed = String(raw || '').trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return 'Free Gemini API rate limit reach hoye geche — 20–30 second por Retry click koro!';
  }
  if (trimmed.startsWith('{') && trimmed.includes('"error"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.error?.code === 429) {
        return 'Free Gemini API rate limit reach hoye geche — 20–30 second por Retry click koro!';
      }
      if (parsed?.error?.message) return String(parsed.error.message).slice(0, 140);
    } catch {
      // fall through
    }
  }
  return trimmed.slice(0, 160) || 'AI server e ektu busy lagche, abr try koro.';
}

export const AiAgentPanel: React.FC<AiAgentPanelProps> = ({
  settings,
  location,
  weather,
  now,
  frame,
  mode,
  isSleeping,
  greenLedOn,
  hardware,
  activeScreen,
  activeAlarm,
  customReactions,
  alarmCount,
  todayInteractions,
  onExecuteAgentAction,
  onChangeGreenLedMode,
  onTestBuzzer,
}) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'model',
      text: `Assalamu Alaikum ${settings.userName || 'Muhib'}! HD Neural Voice, Live Voice, ba Web Search use kore kotha bolo — ami ready.`,
      spokenBn: `আসসালামু আলাইকুম ${settings.userName || 'মুহিব'}! এইচডি ভয়েস বা ওয়েব সার্চ দিয়ে কথা বলো, আমি রেডি।`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      executedBadges: ['HD Neural Voice', 'Live Voice', 'Web Search', 'OLED Sync'],
    },
  ]);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(false);

  // Pro Voice Studio Controls
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [voiceName, setVoiceName] = useState<StudioVoiceName>('Kore');
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [speaking, setSpeaking] = useState(false);
  const [synthesizingVoice, setSynthesizingVoice] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [voiceEngineLabel, setVoiceEngineLabel] = useState<'HD Neural' | 'Device'>('HD Neural');
  const [micLevel, setMicLevel] = useState(0);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Live Voice States
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [liveInputDraft, setLiveInputDraft] = useState('');
  const [liveOutputDraft, setLiveOutputDraft] = useState('');

  // Audio Transcribe Recording States
  const [isRecordingClip, setIsRecordingClip] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<SSD1306Buffer>(new SSD1306Buffer());

  // Audio & WebSocket Refs
  const activeHtmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeTtsAbortRef = useRef<AbortController | null>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveInputCtxRef = useRef<AudioContext | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveOutputCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const liveInputBufRef = useRef<string>('');
  const liveOutputBufRef = useRef<string>('');

  const speakerEnabledRef = useRef(speakerEnabled);
  const voiceNameRef = useRef(voiceName);
  const voiceSpeedRef = useRef(voiceSpeed);
  const loadingRef = useRef(loading);
  const executeActionRef = useRef(onExecuteAgentAction);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const activeFetchAbortRef = useRef<AbortController | null>(null);

  speakerEnabledRef.current = speakerEnabled;
  voiceNameRef.current = voiceName;
  voiceSpeedRef.current = voiceSpeed;
  loadingRef.current = loading;
  executeActionRef.current = onExecuteAgentAction;

  // Render smooth 24-FPS compact 0.96" OLED monitor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderScreenToBuffer(
      bufferRef.current,
      activeScreen,
      frame,
      now,
      settings,
      weather,
      location,
      customReactions,
      activeAlarm
    );
    paintBufferToCanvas(ctx, bufferRef.current, hardware.oledScheme, 3, true);
  }, [
    activeScreen,
    frame,
    now,
    settings,
    weather,
    location,
    hardware.oledScheme,
    customReactions,
    activeAlarm,
  ]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, liveInputDraft, liveOutputDraft]);

  // Stop any playing HD Neural Audio or Browser Speech
  const stopCurrentSpeech = useCallback(() => {
    if (activeTtsAbortRef.current) {
      activeTtsAbortRef.current.abort();
      activeTtsAbortRef.current = null;
    }
    if (activeHtmlAudioRef.current) {
      try {
        activeHtmlAudioRef.current.pause();
        activeHtmlAudioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      activeHtmlAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSynthesizingVoice(false);
    setSpeaking(false);
    setPlayingMessageId(null);
  }, []);

  const clearLiveAudioQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current = [];
    if (liveOutputCtxRef.current) {
      nextPlayTimeRef.current = liveOutputCtxRef.current.currentTime;
    }
    setSpeaking(false);
  }, []);

  const stopLiveVoice = useCallback(() => {
    if (liveProcessorRef.current) {
      try {
        liveProcessorRef.current.disconnect();
      } catch {
        // ignore
      }
      liveProcessorRef.current = null;
    }
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((t) => t.stop());
      liveStreamRef.current = null;
    }
    if (liveInputCtxRef.current) {
      liveInputCtxRef.current.close().catch(() => {});
      liveInputCtxRef.current = null;
    }
    clearLiveAudioQueue();
    if (liveOutputCtxRef.current) {
      liveOutputCtxRef.current.close().catch(() => {});
      liveOutputCtxRef.current = null;
    }
    if (liveWsRef.current) {
      try {
        liveWsRef.current.close();
      } catch {
        // ignore
      }
      liveWsRef.current = null;
    }
    liveInputBufRef.current = '';
    liveOutputBufRef.current = '';
    setLiveInputDraft('');
    setLiveOutputDraft('');
    setMicLevel(0);
    setLiveStatus('idle');
  }, [clearLiveAudioQueue]);

  useEffect(() => {
    return () => {
      stopLiveVoice();
      stopCurrentSpeech();
      if (recordStreamRef.current) {
        recordStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stopLiveVoice, stopCurrentSpeech]);

  // Play WAV Base64 cleanly via HTMLAudioElement with configurable playback speed
  const playWavBase64 = useCallback(
    async (base64Wav: string, messageId: string | null) => {
      stopCurrentSpeech();
      const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
      audio.playbackRate = voiceSpeedRef.current;
      audio.volume = 1.0;
      activeHtmlAudioRef.current = audio;

      audio.onplay = () => {
        setVoiceEngineLabel('HD Neural');
        setSpeaking(true);
        setPlayingMessageId(messageId);
      };
      audio.onended = () => {
        if (activeHtmlAudioRef.current === audio) {
          activeHtmlAudioRef.current = null;
        }
        setSpeaking(false);
        setPlayingMessageId(null);
      };
      audio.onerror = () => {
        if (activeHtmlAudioRef.current === audio) {
          activeHtmlAudioRef.current = null;
        }
        setSpeaking(false);
        setPlayingMessageId(null);
      };

      await audio.play();
    },
    [stopCurrentSpeech]
  );

  // Fallback Browser Speech (prefers native Bengali bn-BD / bn-IN voice first!)
  const speakBrowserFallback = useCallback(
    (text: string, spokenBn: string | undefined, messageId: string | null) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        const voices = window.speechSynthesis.getVoices();
        const bnVoice =
          voices.find((v) => v.lang.toLowerCase().includes('bn-bd')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('bn'));
        const enVoice =
          voices.find((v) => v.lang.toLowerCase().includes('en-in')) ||
          voices.find((v) => v.lang.toLowerCase().includes('en-gb')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('en'));

        const chosenVoice = bnVoice && spokenBn ? bnVoice : enVoice;
        const utter = new SpeechSynthesisUtterance(bnVoice && spokenBn ? spokenBn : text);
        if (chosenVoice) utter.voice = chosenVoice;
        utter.lang = chosenVoice?.lang || (spokenBn ? 'bn-BD' : 'en-IN');
        utter.rate = Math.max(0.85, Math.min(1.15, voiceSpeedRef.current * 0.96));
        utter.pitch = 1.0;

        utter.onstart = () => {
          setVoiceEngineLabel('Device');
          setSpeaking(true);
          setPlayingMessageId(messageId);
        };
        utter.onend = () => {
          setSpeaking(false);
          setPlayingMessageId(null);
        };
        utter.onerror = () => {
          setSpeaking(false);
          setPlayingMessageId(null);
        };
        window.speechSynthesis.speak(utter);
      } catch {
        setSpeaking(false);
        setPlayingMessageId(null);
      }
    },
    []
  );

  // =========================================================================
  // CRYSTAL-CLEAR HD NEURAL VOICE ENGINE (Gemini 3.8 Flash Lite TTS)
  // =========================================================================
  const speakReply = useCallback(
    async (
      text: string,
      opts?: {
        spokenBn?: string;
        messageId?: string | null;
        cachedAudioBase64?: string;
        forcePlay?: boolean;
      }
    ) => {
      const msgId = opts?.messageId ?? null;
      if (!opts?.forcePlay && !speakerEnabledRef.current) return;

      // Toggle stop if user clicked Replay on the currently playing bubble
      if (msgId && playingMessageId === msgId && speaking) {
        stopCurrentSpeech();
        return;
      }

      stopCurrentSpeech();

      // Instant replay from cached WAV if already synthesized
      if (opts?.cachedAudioBase64) {
        try {
          await playWavBase64(opts.cachedAudioBase64, msgId);
          return;
        } catch {
          // fall through to regenerate/fallback
        }
      }

      const controller = new AbortController();
      activeTtsAbortRef.current = controller;
      const ttsTimeout = window.setTimeout(() => controller.abort(), 9500);
      setSynthesizingVoice(true);

      try {
        const res = await fetch('/api/agent/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text,
            spokenBn: opts?.spokenBn || '',
            voiceName: voiceNameRef.current,
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.audioBase64) {
          throw new Error(data?.error || 'Neural TTS unavailable');
        }

        // Cache generated audio on the message for instant zero-latency replays
        if (msgId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, audioBase64: data.audioBase64 } : m))
          );
        }

        setSynthesizingVoice(false);
        await playWavBase64(data.audioBase64, msgId);
      } catch (err) {
        setSynthesizingVoice(false);
        if (err instanceof Error && err.name === 'AbortError') return;
        speakBrowserFallback(text, opts?.spokenBn, msgId);
      } finally {
        window.clearTimeout(ttsTimeout);
        if (activeTtsAbortRef.current === controller) {
          activeTtsAbortRef.current = null;
        }
      }
    },
    [playingMessageId, speaking, stopCurrentSpeech, playWavBase64, speakBrowserFallback]
  );

  // =========================================================================
  // 1. MULTI-TURN BANGLISH CHAT & WEB SEARCH (Gemini 4 Hydrogen)
  // =========================================================================
  const sendMessage = useCallback(
    async (
      textToSend: string,
      source: 'portal' | 'voice' = 'portal',
      forceSearch?: boolean
    ) => {
      const trimmed = textToSend.trim();
      if (!trimmed || loadingRef.current) return;

      const useSearch = forceSearch !== undefined ? forceSearch : searchMode;
      setStatusNotice(null);
      stopCurrentSpeech();

      const userMsg: AgentChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const historyPayload = messages
        .filter((m) => !m.error && !m.id.startsWith('welcome-') && !m.id.startsWith('reset-'))
        .slice(-8)
        .map((m) => ({ role: m.role, text: m.text }));

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setLoading(true);
      loadingRef.current = true;

      const controller = new AbortController();
      activeFetchAbortRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 28000);

      const parseResponseSafe = async (res: Response) => {
        const rawText = await res.text();
        try {
          return JSON.parse(rawText);
        } catch {
          throw new Error(
            res.status === 504
              ? 'Server timeout (504). Abr try koro!'
              : `Server returned status ${res.status}`
          );
        }
      };

      try {
        if (useSearch) {
          const res = await fetch('/api/agent/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              query: trimmed,
              userName: settings.userName || 'Muhib',
            }),
          });
          const data = await parseResponseSafe(res);
          if (!res.ok) {
            throw new Error(data?.error || `Search error (${res.status})`);
          }

          const replyText = String(data.reply || `Sorry ${settings.userName || 'Muhib'}, info pai ni.`);
          const spokenBn = typeof data.spokenBn === 'string' ? data.spokenBn : '';
          const sources = Array.isArray(data.sources) ? data.sources : [];
          const usedFallback = Boolean(data.searchFallback);

          const badges = executeActionRef.current(
            {
              reply: replyText,
              spokenBn,
              screenKind: 'custom-text',
              faceId: 12,
              oledLine1: usedFallback ? 'AI ANSWER' : 'WEB SEARCH OK',
              oledLine2: sources.length > 0 ? `${sources.length} SRC` : 'READY',
              greenLed: 'unchanged',
              buzzerSound: 'beep',
              alarmTime: '',
              alarmLabel: '',
              targetMode: 'unchanged',
              actionSummary: `Web Search: ${trimmed.slice(0, 24)}`,
            },
            source
          );

          const msgId = `m-${Date.now()}`;
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              role: 'model',
              text: replyText,
              spokenBn,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              executedBadges: [usedFallback ? 'AI Knowledge' : 'Google Search', ...badges],
              sources,
            },
          ]);
          void speakReply(replyText, { spokenBn, messageId: msgId });
        } else {
          const res = await fetch('/api/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              message: trimmed,
              history: historyPayload,
              context: {
                userName: settings.userName || 'Muhib',
                city: location.city,
                temperatureC: weather ? Number(weather.temperature.toFixed(1)) : null,
                conditionLabel: weather?.conditionLabel ?? null,
                localTime: now.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: !settings.use24HourClock,
                }),
                mode,
                isSleeping,
                greenLedMode: hardware.greenLedMode,
                activeScreenKind: activeScreen.kind,
                activeFaceId: activeScreen.faceId,
                alarmCount,
                todayInteractions,
                esp32Connected: Boolean(hardware.cloudSyncEnabled || hardware.esp32Ip.trim()),
              },
            }),
          });

          const data = await parseResponseSafe(res);
          if (!res.ok) {
            throw new Error(data?.error || `Server responded with ${res.status}`);
          }

          const action = data as AgentActionResponse;
          const badges = executeActionRef.current(action, source);
          const msgId = `m-${Date.now()}`;

          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              role: 'model',
              text: action.reply,
              spokenBn: action.spokenBn || '',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              actionSummary: action.actionSummary,
              executedBadges: badges,
            },
          ]);
          void speakReply(action.reply, { spokenBn: action.spokenBn, messageId: msgId });
        }
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const errMsg = isAbort
          ? 'Response time besi laglo, abr send koro.'
          : cleanErrorMessage(err instanceof Error ? err.message : 'Failed to reach FaceBot AI.');
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'model',
            text: `Sorry ${settings.userName || 'Muhib'}, ${errMsg}`,
            retryPrompt: trimmed,
            retrySearch: useSearch,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            error: true,
          },
        ]);
      } finally {
        window.clearTimeout(timeoutId);
        activeFetchAbortRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [
      searchMode,
      messages,
      settings.userName,
      settings.use24HourClock,
      location.city,
      weather,
      now,
      mode,
      isSleeping,
      hardware.greenLedMode,
      hardware.cloudSyncEnabled,
      hardware.esp32Ip,
      activeScreen.kind,
      activeScreen.faceId,
      alarmCount,
      todayInteractions,
      speakReply,
      stopCurrentSpeech,
    ]
  );

  // =========================================================================
  // 2. REAL-TIME LIVE VOICE CONVERSATION (gemini-3.8-live over /ws/live)
  // =========================================================================
  const startLiveVoice = useCallback(async () => {
    if (liveStatus !== 'idle') {
      stopLiveVoice();
      return;
    }

    stopCurrentSpeech();
    setStatusNotice(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatusNotice('Browser microphone unavailable. Allow mic permission in HTTPS.');
      return;
    }

    setLiveStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      liveStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      const inputCtx = new AudioCtx({ sampleRate: 16000 });
      liveInputCtxRef.current = inputCtx;

      const outputCtx = new AudioCtx({ sampleRate: 24000 });
      liveOutputCtxRef.current = outputCtx;
      nextPlayTimeRef.current = outputCtx.currentTime;

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/live?user=${encodeURIComponent(
        settings.userName || 'Muhib'
      )}&city=${encodeURIComponent(location.city || 'Dhaka')}&voice=${encodeURIComponent(
        voiceNameRef.current
      )}`;

      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        liveProcessorRef.current = processor;

        processor.onaudioprocess = (event) => {
          const channelData = event.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < channelData.length; i += 8) {
            sumSq += channelData[i] * channelData[i];
          }
          const rms = Math.sqrt(sumSq / (channelData.length / 8));
          setMicLevel(Math.min(100, Math.round(rms * 320)));

          if (ws.readyState === WebSocket.OPEN) {
            const b64 = float32ToBase64Pcm16(channelData);
            ws.send(JSON.stringify({ audio: b64 }));
          }
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));

          if (msg.ready) {
            setLiveStatus('connected');
            setStatusNotice(`Live Voice active (${voiceNameRef.current}) — naturally kotha bolo!`);
            return;
          }

          if (msg.error) {
            setStatusNotice(`Live Voice notice: ${cleanErrorMessage(msg.error)}`);
            stopLiveVoice();
            return;
          }

          if (msg.interrupted) {
            clearLiveAudioQueue();
            return;
          }

          if (typeof msg.audio === 'string' && speakerEnabledRef.current && liveOutputCtxRef.current) {
            const outCtx = liveOutputCtxRef.current;
            const float32 = base64Pcm16ToFloat32(msg.audio);
            if (float32.length > 0) {
              const audioBuffer = outCtx.createBuffer(1, float32.length, 24000);
              audioBuffer.getChannelData(0).set(float32);

              const src = outCtx.createBufferSource();
              src.buffer = audioBuffer;
              src.connect(outCtx.destination);

              const nowTime = outCtx.currentTime;
              const startAt = Math.max(nowTime + 0.015, nextPlayTimeRef.current);
              src.start(startAt);
              nextPlayTimeRef.current = startAt + audioBuffer.duration;
              setSpeaking(true);

              activeSourcesRef.current.push(src);
              src.onended = () => {
                activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
                if (activeSourcesRef.current.length === 0) {
                  setSpeaking(false);
                }
              };
            }
          }

          if (typeof msg.inputTranscript === 'string') {
            liveInputBufRef.current += msg.inputTranscript;
            setLiveInputDraft(liveInputBufRef.current.trim());
          }

          if (typeof msg.outputTranscript === 'string') {
            liveOutputBufRef.current += msg.outputTranscript;
            setLiveOutputDraft(liveOutputBufRef.current.trim());
          }

          if (msg.toolAction && typeof msg.toolAction === 'object') {
            const a = msg.toolAction as Record<string, unknown>;
            const mappedAction: AgentActionResponse = {
              reply: liveOutputBufRef.current.trim() || 'Done!',
              screenKind: (a.screenKind as AgentActionResponse['screenKind']) || 'face',
              faceId: typeof a.faceId === 'number' ? a.faceId : 1,
              oledLine1: typeof a.oledLine1 === 'string' ? a.oledLine1 : '',
              oledLine2: typeof a.oledLine2 === 'string' ? a.oledLine2 : '',
              greenLed: (a.greenLed as AgentActionResponse['greenLed']) || 'unchanged',
              buzzerSound: (a.buzzerSound as AgentActionResponse['buzzerSound']) || 'none',
              alarmTime: typeof a.alarmTime === 'string' ? a.alarmTime : '',
              alarmLabel: typeof a.alarmLabel === 'string' ? a.alarmLabel : '',
              targetMode: 'unchanged',
              actionSummary: 'Live Voice Hardware Control',
            };
            const badges = executeActionRef.current(mappedAction, 'voice');
            if (badges.length > 0) {
              setStatusNotice(`Live Voice executed: ${badges.join(' · ')}`);
            }
          }

          if (msg.turnComplete) {
            const uText = liveInputBufRef.current.trim();
            const mText = liveOutputBufRef.current.trim();
            const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const appended: AgentChatMessage[] = [];
            if (uText) {
              appended.push({ id: `lu-${Date.now()}`, role: 'user', text: uText, timestamp: ts });
            }
            if (mText) {
              appended.push({
                id: `lm-${Date.now() + 1}`,
                role: 'model',
                text: mText,
                timestamp: ts,
                executedBadges: ['Live Voice'],
              });
            }
            if (appended.length > 0) {
              setMessages((prev) => [...prev, ...appended]);
            }
            liveInputBufRef.current = '';
            liveOutputBufRef.current = '';
            setLiveInputDraft('');
            setLiveOutputDraft('');
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        setStatusNotice(
          'Vercel serverless host-e WebSocket off thake — niche "Voice Mic" button diye kotha bolo, HD Neural Voice-e crystal-clear reply pabe!'
        );
        stopLiveVoice();
      };

      ws.onclose = () => {
        stopLiveVoice();
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone access blocked.';
      setStatusNotice(`Could not start Live Voice: ${msg}`);
      stopLiveVoice();
    }
  }, [liveStatus, stopLiveVoice, stopCurrentSpeech, clearLiveAudioQueue, settings.userName, location.city]);

  // =========================================================================
  // 3. VOICE RECORD & TRANSCRIBE (Works on Vercel HTTPS + Mobile + Desktop!)
  // =========================================================================
  const handleToggleRecordTranscribe = useCallback(async () => {
    setStatusNotice(null);
    stopCurrentSpeech();

    if (isRecordingClip) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecordingClip(false);
      return;
    }

    if (liveStatus !== 'idle') {
      stopLiveVoice();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatusNotice('Microphone recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];

      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType: preferredMime });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;

        const blob = new Blob(recordChunksRef.current, { type: preferredMime.split(';')[0] });
        if (blob.size < 200) return;

        setTranscribing(true);
        try {
          const audioBase64 = await blobToBase64(blob);
          const res = await fetch('/api/agent/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64,
              mimeType: preferredMime.split(';')[0],
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error || `Transcribe failed (${res.status})`);
          }
          const transcript = String(data.text || '').trim();
          if (transcript) {
            setInput(transcript);
            await sendMessage(transcript, 'voice');
          } else {
            setStatusNotice('Sorry Muhib, kono voice shona jay ni. Aro clear kore bolo.');
          }
        } catch (err) {
          setStatusNotice(
            cleanErrorMessage(err instanceof Error ? err.message : 'Audio transcription failed.')
          );
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      setIsRecordingClip(true);
      setStatusNotice('Listening... Kotha bola sesh hole Stop click koro!');
    } catch {
      setStatusNotice('Microphone permission blocked. Browser settings theke Mic allow koro.');
    }
  }, [isRecordingClip, liveStatus, stopLiveVoice, stopCurrentSpeech, sendMessage]);

  const handleTestSpeaker = () => {
    setSpeakerEnabled(true);
    speakerEnabledRef.current = true;
    void speakReply(
      `Assalamu Alaikum ${settings.userName || 'Muhib'}! Amar HD voice ekhon ekdom clear shona jacche.`,
      {
        spokenBn: `আসসালামু আলাইকুম ${settings.userName || 'মুহিব'}! আমার এইচডি ভয়েস এখন একদম ক্লিয়ার শোনা যাচ্ছে।`,
        forcePlay: true,
      }
    );
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input, 'portal');
  };

  const handleClearChat = () => {
    stopCurrentSpeech();
    setMessages([
      {
        id: `reset-${Date.now()}`,
        role: 'model',
        text: `Chat clear kore dilam ${settings.userName || 'Muhib'}. Ekhon bolo ki korbo?`,
        spokenBn: `চ্যাট ক্লিয়ার করে দিলাম ${settings.userName || 'মুহিব'}। এখন বলো কী করবো?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Column: Pro Voice Studio + Chat & Web Search Console */}
      <section className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
        {/* Top Agent Control Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              FaceBot Pro AI Voice Agent
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {liveStatus === 'connected'
                ? 'Live Call Active'
                : synthesizingVoice
                  ? `Generating ${voiceName} HD Voice...`
                  : speaking
                    ? `Speaking (${voiceEngineLabel} · ${voiceName})`
                    : isRecordingClip
                      ? 'Recording Mic...'
                      : `HD Neural Voice · ${voiceName}`}
              <span className="mx-1.5" aria-hidden="true">·</span>
              {searchMode ? 'Web Search ON' : 'Banglish Hardware Mode'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={startLiveVoice}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                liveStatus !== 'idle'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {liveStatus !== 'idle' ? (
                <>
                  <PhoneOff className="w-3.5 h-3.5" />
                  End Call
                </>
              ) : (
                <>
                  <PhoneCall className="w-3.5 h-3.5" />
                  Live Voice
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setSearchMode((s) => !s)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                searchMode
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              {searchMode ? 'Web Search: ON' : 'Web Search'}
            </button>

            <button
              type="button"
              onClick={() => {
                if (speaking || synthesizingVoice) {
                  stopCurrentSpeech();
                } else {
                  setSpeakerEnabled((s) => !s);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                speaking
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {speaking ? (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  Stop Audio
                </>
              ) : speakerEnabled ? (
                <>
                  <Volume2 className="w-3.5 h-3.5" />
                  Speaker ON
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5" />
                  Muted
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleClearChat}
              className="p-2 text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-800 rounded-lg transition-colors shrink-0"
              title="Clear conversation"
              aria-label="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Pro Voice Studio Tuning Bar (Persona + Speed + Test Clarity) */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              <span>Voice:</span>
              <select
                value={voiceName}
                onChange={(e) => {
                  const next = e.target.value as StudioVoiceName;
                  setVoiceName(next);
                  voiceNameRef.current = next;
                  // Clear cached WAVs so replays regenerate with newly chosen persona
                  setMessages((prev) => prev.map((m) => ({ ...m, audioBase64: undefined })));
                }}
                aria-label="Select AI studio voice"
                className="bg-white border border-slate-200 rounded-md px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
              >
                {STUDIO_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({v.tone})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
              {VOICE_SPEEDS.map((sp) => (
                <button
                  key={sp.value}
                  type="button"
                  onClick={() => {
                    setVoiceSpeed(sp.value);
                    voiceSpeedRef.current = sp.value;
                    if (activeHtmlAudioRef.current) {
                      activeHtmlAudioRef.current.playbackRate = sp.value;
                    }
                  }}
                  className={`px-2 py-1 text-[11px] font-semibold font-mono rounded-md transition-colors whitespace-nowrap ${
                    voiceSpeed === sp.value
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestSpeaker}
            disabled={synthesizingVoice}
            className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-semibold whitespace-nowrap disabled:opacity-50"
          >
            {synthesizingVoice ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Headphones className="w-3.5 h-3.5" />
            )}
            Test HD Voice
          </button>
        </div>

        {/* Live Status / Voice Visualizer Strip */}
        {(liveStatus !== 'idle' || isRecordingClip || transcribing || speaking || statusNotice) && (
          <div className="px-5 py-2.5 bg-blue-50/60 border-b border-blue-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 flex-1 min-w-[200px]">
              {liveStatus === 'connected' ? (
                <>
                  <AudioLines className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="font-medium text-slate-800 whitespace-nowrap">
                    {speaking ? 'FaceBot Speaking Live...' : 'Listening (16kHz Studio Mic)'}
                  </span>
                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden max-w-[160px]">
                    <div
                      className="h-full bg-blue-600 transition-all duration-75"
                      style={{ width: `${Math.max(8, micLevel)}%` }}
                    />
                  </div>
                </>
              ) : speaking ? (
                <div className="inline-flex items-center gap-2 text-blue-800 font-medium">
                  <AudioLines className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>
                    Speaking clearly via {voiceEngineLabel} Voice ({voiceName} · {voiceSpeed}x)
                  </span>
                </div>
              ) : transcribing ? (
                <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Transcribing your voice...
                </span>
              ) : (
                <span className="text-slate-700">{statusNotice}</span>
              )}
            </div>

            {speaking && (
              <button
                type="button"
                onClick={stopCurrentSpeech}
                className="text-xs font-semibold text-red-600 hover:text-red-700 whitespace-nowrap"
              >
                Stop
              </button>
            )}
          </div>
        )}

        {/* Quick Banglish & Web Search Prompts */}
        <div className="px-5 py-3 bg-white border-b border-slate-100 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={loading || transcribing}
              onClick={() => void sendMessage(item.prompt, 'portal', item.search)}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:border-slate-400 hover:text-slate-900 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Chat & Voice Transcript */}
        <div
          ref={scrollRef}
          className="p-5 space-y-4 h-[380px] overflow-y-auto bg-slate-50/50"
        >
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isThisPlaying = playingMessageId === msg.id && speaking;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-slate-900 text-white'
                      : msg.error
                        ? 'bg-red-50 border border-red-200 text-red-900'
                        : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>

                  {/* Clickable Google Search Grounding Sources */}
                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1">
                      <div className="text-[11px] font-semibold text-slate-500">
                        Web Sources
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {msg.sources.map((src) => (
                          <a
                            key={src.uri}
                            href={src.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 underline underline-offset-2"
                          >
                            <span className="truncate max-w-[200px]">{src.title}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Footer Metadata + Replay Voice / Retry Action */}
                  <div
                    className={`mt-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px] tabular-nums ${
                      isUser ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    <div>
                      <span>{msg.timestamp}</span>
                      {!isUser && msg.executedBadges && msg.executedBadges.length > 0 && (
                        <>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono text-slate-600">
                            {msg.executedBadges.join(' · ')}
                          </span>
                        </>
                      )}
                    </div>

                    {!isUser && !msg.error && (
                      <button
                        type="button"
                        onClick={() =>
                          void speakReply(msg.text, {
                            spokenBn: msg.spokenBn,
                            messageId: msg.id,
                            cachedAudioBase64: msg.audioBase64,
                            forcePlay: true,
                          })
                        }
                        className={`inline-flex items-center gap-1 font-semibold transition-colors whitespace-nowrap ${
                          isThisPlaying
                            ? 'text-blue-600'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        {isThisPlaying ? (
                          <>
                            <Square className="w-2.5 h-2.5 fill-current" />
                            Stop
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3 h-3" />
                            Listen
                          </>
                        )}
                      </button>
                    )}

                    {msg.error && msg.retryPrompt && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void sendMessage(msg.retryPrompt || '', 'portal', msg.retrySearch)
                        }
                        className="inline-flex items-center gap-1 font-semibold text-red-700 hover:text-red-900 underline underline-offset-2 whitespace-nowrap disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {liveInputDraft && (
            <div className="flex flex-col items-end">
              <div className="max-w-[85%] rounded-xl px-4 py-2.5 text-sm bg-slate-800 text-slate-100">
                {liveInputDraft}
              </div>
            </div>
          )}

          {liveOutputDraft && (
            <div className="flex flex-col items-start">
              <div className="max-w-[85%] rounded-xl px-4 py-2.5 text-sm bg-white border border-blue-200 text-slate-800">
                {liveOutputDraft}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-start">
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 inline-flex items-center gap-3">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                <span>{searchMode ? 'Web e khujche...' : 'FaceBot bhabche...'}</span>
                <button
                  type="button"
                  onClick={() => activeFetchAbortRef.current?.abort()}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-700 underline underline-offset-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Composer Row: Voice Mic + Input + Send */}
        <form
          onSubmit={handleFormSubmit}
          className="p-4 bg-white border-t border-slate-200 flex items-center gap-2.5"
        >
          <button
            type="button"
            onClick={handleToggleRecordTranscribe}
            disabled={loading || transcribing}
            title={
              isRecordingClip
                ? 'Stop recording & send voice command'
                : 'Speak in Banglish / Bengali (HD Mic)'
            }
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-colors shrink-0 ${
              isRecordingClip
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {isRecordingClip ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop
              </>
            ) : transcribing ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span className="hidden sm:inline">Voice Mic</span>
              </>
            )}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading || transcribing}
            placeholder={
              searchMode
                ? 'Web Search ON — news, facts, cricket, weather jiggesh koro...'
                : 'Banglish e likho ba Voice Mic use koro...'
            }
            className="flex-1 min-w-0 px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50"
          />

          <button
            type="submit"
            disabled={loading || transcribing || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            {searchMode ? 'Search' : 'Send'}
          </button>
        </form>
      </section>

      {/* Right Column: Compact Live 24-FPS OLED Reaction Monitor */}
      <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Live OLED Monitor</h3>
            <p className="text-xs text-slate-500">24-FPS smooth sync to ESP32</p>
          </div>
          <span className="text-xs font-mono text-slate-500">0.96&quot; I2C</span>
        </div>

        {/* Compact Dark OLED Frame */}
        <div className="bg-slate-900 rounded-xl p-3.5 border border-slate-700">
          <div className="flex items-center justify-between mb-2 text-[11px] font-mono text-slate-300">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  greenLedOn
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : 'bg-slate-700'
                }`}
              />
              <span>GPIO 26: {greenLedOn ? 'ON' : 'OFF'}</span>
            </div>
            <span className="text-slate-400">{hardware.greenLedMode.toUpperCase()}</span>
          </div>

          <div className="bg-[#05080F] p-1.5 rounded-lg border border-slate-800">
            <canvas
              ref={canvasRef}
              width={384}
              height={192}
              className="oled-canvas w-full h-auto block rounded-xs"
              aria-label="Live AI Agent OLED reaction display"
            />
          </div>
        </div>

        {/* Quick Hardware Controls directly under Live Monitor */}
        <div className="space-y-3 pt-1">
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1.5">
              Green LED (GPIO 26)
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(['auto', 'on', 'blink', 'off'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeGreenLedMode(m)}
                  className={`py-2 text-xs font-semibold rounded-md border uppercase transition-colors ${
                    hardware.greenLedMode === m
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onTestBuzzer}
              className="py-2 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Beep Buzzer
            </button>
            <button
              type="button"
              onClick={handleTestSpeaker}
              className="py-2 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Test HD Voice
            </button>
          </div>

          <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
            <div>
              Cloud Bridge:{' '}
              <span className="font-mono text-slate-800">
                {hardware.cloudSyncEnabled ? 'Vercel Anywhere Sync ON' : hardware.esp32Ip.trim() || 'Local Only'}
              </span>
            </div>
            <div>
              Voice Engine:{' '}
              <span className="font-medium text-slate-700">
                HD Neural Bengali/Banglish ({voiceName})
              </span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
