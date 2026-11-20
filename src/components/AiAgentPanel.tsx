import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Loader2,
  Mic,
  MicOff,
  Send,
  Sparkles,
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
  GreenLedMode,
  LocationConfig,
  WeatherData,
} from '../types';

interface AiAgentPanelProps {
  settings: BotSettings;
  location: LocationConfig;
  weather: WeatherData | null;
  now: Date;
  mode: BotMode;
  isSleeping: boolean;
  greenLedMode: GreenLedMode;
  activeScreen: ActiveScreenState;
  alarmCount: number;
  esp32Ip: string;
  onExecuteAgentAction: (action: AgentActionResponse) => string[];
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
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const QUICK_PROMPTS = [
  { label: 'Kemon acho?', prompt: 'Hi FaceBot, kemon acho? Ekta happy face dekhao r green LED blink koro!' },
  { label: 'Show Weather', prompt: 'Ajker weather kemon? OLED te weather dekhao.' },
  { label: 'Study Mode OLED', prompt: 'OLED te lekho "STUDY TIME" ar niche "FOCUS!" r green LED on koro.' },
  { label: 'Set 07:00 Alarm', prompt: 'Sokal 7:00 tay "Morning Wake" alarm set koro ar buzzer e beep dao.' },
  { label: 'Show Clock', prompt: 'OLED te ekhonkar time ar clock dekhao.' },
  { label: 'Good Night', prompt: 'Good night FaceBot, ekhon ghumiye poro r green LED off koro.' },
];

export const AiAgentPanel: React.FC<AiAgentPanelProps> = ({
  settings,
  location,
  weather,
  now,
  mode,
  isSleeping,
  greenLedMode,
  activeScreen,
  alarmCount,
  esp32Ip,
  onExecuteAgentAction,
}) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'model',
      text: `Assalamu Alaikum ${settings.userName || 'Muhib'}! Ami tomar FaceBot AI Agent. Bangla, Banglish, ba English e kotha bolo — ami OLED face, text, weather, alarm, Piezo buzzer r Green LED (GPIO 26) sob control kore dibo.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      executedBadges: ['OLED Ready', 'Green LED GPIO 26', 'Buzzer GPIO 14'],
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'bn-BD' | 'en-US'>('bn-BD');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const hasSpeechRecognition =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const speakText = (text: string) => {
    if (!voiceReplyEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = voiceLang;
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors on unsupported browsers
    }
  };

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;

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
            greenLedMode,
            activeScreenKind: activeScreen.kind,
            activeFaceId: activeScreen.faceId,
            alarmCount,
            esp32Connected: Boolean(esp32Ip.trim()),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Server responded with ${res.status}`);
      }

      const action = data as AgentActionResponse;
      const badges = onExecuteAgentAction(action);

      const botMsg: AgentChatMessage = {
        id: `m-${Date.now()}`,
        role: 'model',
        text: action.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actionSummary: action.actionSummary,
        executedBadges: badges,
      };
      setMessages((prev) => [...prev, botMsg]);
      speakText(action.reply);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to reach FaceBot AI Agent.';
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'model',
          text: `Could not complete AI Agent request: ${errMsg}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const toggleVoiceInput = () => {
    if (!hasSpeechRecognition) return;
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
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

    const rec = new SpeechRecognitionCtor();
    rec.lang = voiceLang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript.trim()) {
        setInput(transcript.trim());
        sendMessage(transcript.trim());
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: `reset-${Date.now()}`,
        role: 'model',
        text: `Chat cleared! Ki korte hobe bolo ${settings.userName || 'Muhib'} — OLED face, message, alarm, Green LED naki buzzer?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              FaceBot Portal AI Agent
            </h3>
            <p className="text-xs text-slate-500">
              Chat or speak in Bengali, Banglish, or English to control OLED faces, text, alarms, Piezo buzzer &amp; Green LED
              {esp32Ip.trim() ? ` · Live Sync: ${esp32Ip.trim()}` : ' · Simulator + ESP32 Bridge Ready'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasSpeechRecognition && (
            <select
              value={voiceLang}
              onChange={(e) => setVoiceLang(e.target.value as 'bn-BD' | 'en-US')}
              aria-label="Voice language"
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="bn-BD">Voice: Bangla</option>
              <option value="en-US">Voice: English</option>
            </select>
          )}
          <button
            type="button"
            onClick={() => setVoiceReplyEnabled((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              voiceReplyEnabled
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {voiceReplyEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                Voice Reply ON
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                Voice Reply OFF
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleClearChat}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            title="Clear conversation"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Quick Action Suggestions */}
      <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-100 flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={loading}
            onClick={() => sendMessage(item.prompt)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Chat Transcript */}
      <div
        ref={scrollRef}
        className="p-5 space-y-4 h-[380px] overflow-y-auto bg-slate-50/40"
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
                      : 'bg-white border border-slate-200 text-slate-800 shadow-2xs'
                }`}
              >
                {!isUser && (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 mb-1">
                    <Bot className="w-3.5 h-3.5" />
                    <span>FaceBot Agent</span>
                    <span className="text-slate-400 font-normal ml-auto tabular-nums">
                      {msg.timestamp}
                    </span>
                  </div>
                )}

                <p className="whitespace-pre-wrap">{msg.text}</p>

                {msg.executedBadges && msg.executedBadges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-slate-100">
                    {msg.executedBadges.map((badge, idx) => (
                      <span
                        key={`${msg.id}-b-${idx}`}
                        className="px-2 py-0.5 text-[11px] font-mono font-medium bg-slate-100 text-slate-700 rounded-md border border-slate-200/80"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                )}

                {isUser && (
                  <div className="text-[10px] text-slate-400 mt-1 text-right tabular-nums">
                    {msg.timestamp}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-start">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
              <span>FaceBot is thinking &amp; updating OLED...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Composer */}
      <form
        onSubmit={handleFormSubmit}
        className="p-4 bg-white border-t border-slate-200 flex items-center gap-2.5"
      >
        {hasSpeechRecognition && (
          <button
            type="button"
            onClick={toggleVoiceInput}
            disabled={loading}
            title={listening ? 'Stop listening' : 'Speak command'}
            className={`p-2.5 rounded-lg border transition-colors shrink-0 ${
              listening
                ? 'border-red-500 bg-red-50 text-red-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        )}

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder='Ask FaceBot... e.g. "Happy face dekhao r green LED blink koro" or "Set alarm 06:30"'
          className="flex-1 px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50"
        />

        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          Send
        </button>
      </form>
    </div>
  );
};
