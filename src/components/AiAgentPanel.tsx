import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Headphones,
  Loader2,
  Mic,
  MicOff,
  Radio,
  Send,
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

interface SpeechRecognitionEventLike {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const QUICK_PROMPTS = [
  { label: 'Kemon acho?', prompt: 'Hi FaceBot, kemon acho? Happy face dekhao!' },
  { label: 'Ajker Weather', prompt: 'Ajker weather kemon? OLED te weather dekhao.' },
  { label: 'LED Blink', prompt: 'Green LED blink koro r beep dao.' },
  { label: 'Show Clock', prompt: 'Ekhon koyta baje? OLED te clock dekhao.' },
  { label: 'Set 07:00 Alarm', prompt: 'Sokal 7 tay Wake Up alarm set koro.' },
  { label: 'Good Night', prompt: 'Good night FaceBot, ghumiye poro r LED off koro.' },
];

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
      text: `Assalamu Alaikum ${settings.userName || 'Muhib'}! Device er mic r speaker enable kore kotha bolo, ami ready.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      executedBadges: ['Banglish Voice Ready', 'OLED + Buzzer + Green LED'],
    },
  ]);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Device Mic & Speaker Access States
  const [micPermission, setMicPermission] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [handsFreeMode, setHandsFreeMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'en-IN' | 'bn-BD' | 'en-US'>('bn-BD');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<SSD1306Buffer>(new SSD1306Buffer());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const handsFreeRef = useRef(false);
  const loadingRef = useRef(false);

  handsFreeRef.current = handsFreeMode;
  loadingRef.current = loading;

  const hasSpeechRecognition =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );

  // Render live compact 0.96" OLED monitor inside AI Agent page
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
  }, [messages, loading]);

  // Cleanup mic stream & recognition on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Request real device Microphone & unlock Device Speaker (works on Phone, Laptop, Tablet)
  const enableDeviceMicAndSpeaker = useCallback(async (): Promise<boolean> => {
    setMicError(null);
    setSpeakerEnabled(true);

    // Unlock speaker audio context on user gesture
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioCtx();
        }
        if (audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
      }
    } catch {
      // ignore
    }

    // Request real device microphone access + live level meter
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicPermission('denied');
      setMicError('This browser does not expose microphone mediaDevices API.');
      return false;
    }

    try {
      if (!mediaStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        if (audioCtxRef.current) {
          const source = audioCtxRef.current.createMediaStreamSource(stream);
          const analyser = audioCtxRef.current.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            setMicLevel(Math.min(100, Math.round((avg / 90) * 100)));
            rafRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();
        }
      }
      setMicPermission('granted');
      return true;
    } catch {
      setMicPermission('denied');
      setMicError('Mic permission blocked. Allow microphone in browser address bar settings.');
      return false;
    }
  }, []);

  const startListeningRef = useRef<() => void>(() => {});

  // Speak Banglish reply through the logged-in device's speaker
  const speakReply = useCallback(
    (text: string) => {
      if (!speakerEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        if (handsFreeRef.current) {
          window.setTimeout(() => startListeningRef.current(), 400);
        }
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        // Use natural English/South Asian voice so Banglish reads crisply
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((v) => v.lang.toLowerCase().includes('en-in')) ||
          voices.find((v) => v.lang.toLowerCase().includes('en-gb')) ||
          voices.find((v) => v.lang.toLowerCase().startsWith('en'));
        if (preferred) utter.voice = preferred;
        utter.lang = preferred?.lang || 'en-IN';
        utter.rate = 1.03;
        utter.onstart = () => setSpeaking(true);
        utter.onend = () => {
          setSpeaking(false);
          if (handsFreeRef.current && !loadingRef.current) {
            window.setTimeout(() => startListeningRef.current(), 350);
          }
        };
        utter.onerror = () => {
          setSpeaking(false);
        };
        window.speechSynthesis.speak(utter);
      } catch {
        setSpeaking(false);
      }
    },
    [speakerEnabled]
  );

  const sendMessage = useCallback(
    async (textToSend: string, source: 'portal' | 'voice' = 'portal') => {
      const trimmed = textToSend.trim();
      if (!trimmed || loadingRef.current) return;

      const userMsg: AgentChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const historyPayload = messages
        .filter((m) => !m.error)
        .slice(-8)
        .map((m) => ({ role: m.role, text: m.text }));

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setLoading(true);

      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
              esp32Connected: Boolean(hardware.esp32Ip.trim()),
            },
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `Server responded with ${res.status}`);
        }

        const action = data as AgentActionResponse;
        const badges = onExecuteAgentAction(action, source);

        const botMsg: AgentChatMessage = {
          id: `m-${Date.now()}`,
          role: 'model',
          text: action.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          actionSummary: action.actionSummary,
          executedBadges: badges,
        };
        setMessages((prev) => [...prev, botMsg]);
        speakReply(action.reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to reach FaceBot AI Agent.';
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'model',
            text: `Sorry Muhib, server e connect korte parini. (${errMsg})`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            error: true,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [
      messages,
      settings.userName,
      settings.use24HourClock,
      location.city,
      weather,
      now,
      mode,
      isSleeping,
      hardware.greenLedMode,
      hardware.esp32Ip,
      activeScreen.kind,
      activeScreen.faceId,
      alarmCount,
      todayInteractions,
      onExecuteAgentAction,
      speakReply,
    ]
  );

  const startListening = useCallback(async () => {
    if (!hasSpeechRecognition) {
      setMicError('Voice recognition requires Chrome, Edge, or Safari.');
      return;
    }
    if (micPermission !== 'granted') {
      const ok = await enableDeviceMicAndSpeaker();
      if (!ok) return;
    }

    const SpeechRecognitionCtor =
      (
        window as unknown as {
          SpeechRecognition?: new () => SpeechRecognitionLike;
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }

    const rec = new SpeechRecognitionCtor();
    rec.lang = voiceLang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript.trim()) {
        setInput(transcript.trim());
        sendMessage(transcript.trim(), 'voice');
      }
    };
    rec.onerror = (ev) => {
      setListening(false);
      if (ev?.error === 'not-allowed') {
        setMicPermission('denied');
        setHandsFreeMode(false);
        setMicError('Microphone access was denied by the browser.');
      }
    };
    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, [hasSpeechRecognition, micPermission, enableDeviceMicAndSpeaker, voiceLang, sendMessage]);

  startListeningRef.current = () => {
    void startListening();
  };

  const stopListening = () => {
    setHandsFreeMode(false);
    setListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
  };

  const handleToggleHandsFree = async () => {
    if (handsFreeMode) {
      stopListening();
      return;
    }
    const ok = await enableDeviceMicAndSpeaker();
    if (!ok) return;
    setHandsFreeMode(true);
    handsFreeRef.current = true;
    startListening();
  };

  const handleTestSpeaker = () => {
    setSpeakerEnabled(true);
    speakReply(`Assalamu Alaikum ${settings.userName || 'Muhib'}! Speaker thik thak kaj korteche.`);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input, 'portal');
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: `reset-${Date.now()}`,
        role: 'model',
        text: `Chat clear kore dilam ${settings.userName || 'Muhib'}. Ekhon bolo ki korbo?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Column: Full Banglish Voice & Chat Console */}
      <section className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
        {/* Device Mic & Speaker Access Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Full Voice &amp; Banglish AI Agent
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mic: {micPermission === 'granted' ? 'Connected' : micPermission === 'denied' ? 'Blocked' : 'Off'}
              <span className="mx-1.5" aria-hidden="true">·</span>
              Speaker: {speakerEnabled ? (speaking ? 'Speaking' : 'Ready') : 'Muted'}
              <span className="mx-1.5" aria-hidden="true">·</span>
              Short Banglish replies
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={voiceLang}
              onChange={(e) => setVoiceLang(e.target.value as 'en-IN' | 'bn-BD' | 'en-US')}
              aria-label="Mic recognition language"
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="bn-BD">Mic: Bangla / Banglish</option>
              <option value="en-IN">Mic: English (South Asia)</option>
              <option value="en-US">Mic: English (US)</option>
            </select>

            <button
              type="button"
              onClick={handleToggleHandsFree}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                handsFreeMode
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              {handsFreeMode ? 'Stop Full Agent' : 'Start Mic & Speaker'}
            </button>

            <button
              type="button"
              onClick={() => setSpeakerEnabled((s) => !s)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {speakerEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              {speakerEnabled ? 'Speaker ON' : 'Speaker OFF'}
            </button>

            <button
              type="button"
              onClick={handleClearChat}
              className="p-1.5 text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-800 rounded-lg transition-colors"
              title="Clear chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Live Device Mic Audio Level Strip (when mic is granted) */}
        {(micPermission === 'granted' || micError) && (
          <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            {micError ? (
              <span className="text-red-600">{micError}</span>
            ) : (
              <>
                <div className="flex items-center gap-2.5 flex-1 min-w-[200px]">
                  <span className="font-medium text-slate-700 whitespace-nowrap">
                    {listening ? 'Listening...' : speaking ? 'Speaking reply...' : 'Device Mic Live'}
                  </span>
                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden max-w-[220px]">
                    <div
                      className="h-full bg-blue-600 transition-all duration-75"
                      style={{ width: `${Math.max(4, micLevel)}%` }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestSpeaker}
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  Test Speaker
                </button>
              </>
            )}
          </div>
        )}

        {/* Quick Banglish Prompts */}
        <div className="px-5 py-3 bg-white border-b border-slate-100 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={loading}
              onClick={() => sendMessage(item.prompt, 'portal')}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:border-slate-400 hover:text-slate-900 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Chat Transcript */}
        <div
          ref={scrollRef}
          className="p-5 space-y-4 h-[370px] overflow-y-auto bg-slate-50/40"
        >
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-slate-900 text-white'
                      : msg.error
                        ? 'bg-red-50 border border-red-200 text-red-800'
                        : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>

                  {/* Clean Zero-Pill Metadata Line */}
                  <div
                    className={`mt-2 text-[11px] tabular-nums ${
                      isUser ? 'text-slate-400 text-right' : 'text-slate-500'
                    }`}
                  >
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
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex items-start">
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                <span>FaceBot bhabche...</span>
              </div>
            </div>
          )}
        </div>

        {/* Composer Row */}
        <form
          onSubmit={handleFormSubmit}
          className="p-4 bg-white border-t border-slate-200 flex items-center gap-2.5"
        >
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={loading}
            title={listening ? 'Stop listening' : 'Speak via device microphone'}
            className={`p-2.5 rounded-lg border transition-colors shrink-0 ${
              listening
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder='Banglish e likho ba mic e bolo... e.g. "Happy face dekhao"'
            className="flex-1 px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50"
          />

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </section>

      {/* Right Column: Compact Live OLED Reaction Monitor */}
      <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Live OLED Monitor</h3>
            <p className="text-xs text-slate-500">Reacts immediately to AI Agent commands</p>
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
                  className={`py-1.5 text-xs font-semibold rounded-md border uppercase transition-colors ${
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
              Test Speaker
            </button>
          </div>

          <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
            <div>
              ESP32 Link:{' '}
              <span className="font-mono text-slate-800">
                {hardware.esp32Ip.trim() || 'Local Simulator'}
              </span>
            </div>
            <div>
              Tip: Enable <span className="font-medium text-slate-700">Start Mic &amp; Speaker</span> on your phone or laptop for full hands-free Banglish conversation.
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
