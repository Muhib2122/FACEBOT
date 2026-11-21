import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  CloudSun,
  MessageSquare,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  ActiveScreenState,
  BotMode,
  CustomReaction,
  FACE_DEFINITIONS,
  FaceDefinition,
  OledColorScheme,
  PlaylistItem,
} from '../types';
import { drawFace, paintBufferToCanvas, SSD1306Buffer } from '../utils/oledRenderer';

interface MiniFacePreviewProps {
  faceId: number;
  scheme: OledColorScheme;
  active: boolean;
}

const MiniFacePreview: React.FC<MiniFacePreviewProps> = ({ faceId, scheme, active }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = new SSD1306Buffer();
    drawFace(buf, faceId, active ? 1 : 0);
    paintBufferToCanvas(ctx, buf, scheme, 1, false);
  }, [faceId, scheme, active]);

  return (
    <canvas
      ref={canvasRef}
      width={128}
      height={64}
      className="oled-canvas w-full h-auto rounded-md bg-[#05080F] block"
    />
  );
};

interface ControlPanelProps {
  mode: BotMode;
  activeScreen: ActiveScreenState;
  oledScheme: OledColorScheme;
  playlist: PlaylistItem[];
  customReactions: CustomReaction[];
  onChangeMode: (mode: BotMode) => void;
  onSelectFace: (faceId: number) => void;
  onSelectSpecialScreen: (kind: 'watch' | 'weather' | 'greeting') => void;
  onSendQuickText: (line1: string, line2: string) => void;
  onUpdatePlaylist: (items: PlaylistItem[]) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  mode,
  activeScreen,
  oledScheme,
  playlist,
  customReactions,
  onChangeMode,
  onSelectFace,
  onSelectSpecialScreen,
  onSendQuickText,
  onUpdatePlaylist,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | FaceDefinition['category']>('all');
  const [msgLine1, setMsgLine1] = useState('');
  const [msgLine2, setMsgLine2] = useState('');
  const [newItemKind, setNewItemKind] = useState<PlaylistItem['kind']>('face');
  const [newItemFaceId, setNewItemFaceId] = useState<number>(1);
  const [newItemDuration, setNewItemDuration] = useState<number>(6);

  const filteredFaces = useMemo(() => {
    return FACE_DEFINITIONS.filter((face) => {
      const matchesCat = category === 'all' || face.category === category;
      const q = search.trim().toLowerCase();
      const matchesQuery =
        !q ||
        face.name.toLowerCase().includes(q) ||
        face.bengali.toLowerCase().includes(q) ||
        String(face.id + 1) === q;
      return matchesCat && matchesQuery;
    });
  }, [search, category]);

  const handleAddPlaylistItem = () => {
    let label = 'Watch UI';
    let customReactionId: string | undefined;
    let faceId: number | undefined;

    if (newItemKind === 'face') {
      const def = FACE_DEFINITIONS.find((f) => f.id === newItemFaceId);
      label = def ? `Face: ${def.name}` : 'Face Reaction';
      faceId = newItemFaceId;
    } else if (newItemKind === 'weather') {
      label = 'Live Weather';
    } else if (newItemKind === 'greeting') {
      label = 'Time-of-Day Greeting';
    } else if (newItemKind === 'custom-bitmap') {
      const firstCustom = customReactions[0];
      if (!firstCustom) return;
      label = `Touchpad: ${firstCustom.name}`;
      customReactionId = firstCustom.id;
    }

    const next: PlaylistItem = {
      id: `pl-${Date.now()}`,
      kind: newItemKind,
      label,
      durationSec: Math.max(2, Math.min(120, newItemDuration)),
      faceId,
      customReactionId,
      enabled: true,
    };
    onUpdatePlaylist([...playlist, next]);
  };

  const handleDurationChange = (id: string, sec: number) => {
    onUpdatePlaylist(
      playlist.map((item) =>
        item.id === id ? { ...item, durationSec: Math.max(2, Math.min(120, sec)) } : item
      )
    );
  };

  const handleToggleItem = (id: string) => {
    onUpdatePlaylist(
      playlist.map((item) => (item.id === id ? { ...item, enabled: !item.enabled } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    onUpdatePlaylist(playlist.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Mode & Quick Screen Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Operating Mode Selector */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Operating Mode</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Switch between autonomous Auto Mode and custom-timed User Mode
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                onClick={() => onChangeMode('auto')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'auto'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Auto Mode
              </button>
              <button
                onClick={() => onChangeMode('user')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'user'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                User Mode
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-600 mt-3 leading-relaxed">
            {mode === 'auto'
              ? 'Auto Mode cycles Watch UI, live WiFi weather (with automatic cold-weather shivering reactions), time-based personal greetings, and all 25 animated faces.'
              : 'User Mode follows your custom screen playlist below, holding each selected screen or face for the exact duration you specify.'}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
            <button
              onClick={() => onSelectSpecialScreen('watch')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                activeScreen.kind === 'watch'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              Watch UI
            </button>
            <button
              onClick={() => onSelectSpecialScreen('weather')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                activeScreen.kind === 'weather'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <CloudSun className="w-3.5 h-3.5" />
              Live Weather
            </button>
            <button
              onClick={() => onSelectSpecialScreen('greeting')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                activeScreen.kind === 'greeting'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Greeting Card
            </button>
          </div>
        </div>

        {/* Quick Send Message to OLED */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-900">Quick OLED Message</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Display a custom note immediately on the 0.96" OLED
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!msgLine1.trim()) return;
              onSendQuickText(msgLine1.trim(), msgLine2.trim());
            }}
            className="mt-3 space-y-2.5"
          >
            <input
              type="text"
              maxLength={20}
              value={msgLine1}
              onChange={(e) => setMsgLine1(e.target.value)}
              placeholder="Top line (e.g. Hey Muhib!)"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={10}
                value={msgLine2}
                onChange={(e) => setMsgLine2(e.target.value)}
                placeholder="Big text (optional)"
                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                Show
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* User Mode Screen Duration & Playlist Scheduler */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              User Mode Screen Schedule &amp; Durations
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Customize which screens appear and how many seconds each stays active on the OLED
            </p>
          </div>
          {mode !== 'user' && (
            <button
              onClick={() => onChangeMode('user')}
              className="px-3 py-1.5 text-xs font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap"
            >
              Activate User Mode
            </button>
          )}
        </div>

        {/* Playlist Table */}
        <div className="divide-y divide-slate-100 mt-2">
          {playlist.map((item, idx) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="flex items-center gap-3 min-w-[200px]">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={() => handleToggleItem(item.id)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    {idx + 1}. {item.label}
                  </div>
                  <div className="text-[11px] text-slate-500 capitalize">
                    {item.kind.replace('-', ' ')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-500">Duration:</label>
                  <input
                    type="range"
                    min={2}
                    max={60}
                    value={item.durationSec}
                    onChange={(e) => handleDurationChange(item.id, Number(e.target.value))}
                    className="w-24 sm:w-32 hw-slider"
                  />
                  <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums w-8 text-right">
                    {item.durationSec}s
                  </span>
                </div>
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  aria-label="Remove screen"
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add Screen Row */}
        <div className="flex flex-wrap items-center gap-2.5 mt-4 pt-4 border-t border-slate-100">
          <select
            value={newItemKind}
            onChange={(e) => setNewItemKind(e.target.value as PlaylistItem['kind'])}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
          >
            <option value="face">Face Reaction</option>
            <option value="watch">Watch UI</option>
            <option value="weather">Live Weather</option>
            <option value="greeting">Time Greeting</option>
            {customReactions.length > 0 && (
              <option value="custom-bitmap">Latest Touchpad Art</option>
            )}
          </select>

          {newItemKind === 'face' && (
            <select
              value={newItemFaceId}
              onChange={(e) => setNewItemFaceId(Number(e.target.value))}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
            >
              {FACE_DEFINITIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  #{f.id + 1} {f.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={2}
              max={120}
              value={newItemDuration}
              onChange={(e) => setNewItemDuration(Number(e.target.value))}
              className="w-16 px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg tabular-nums"
            />
            <span className="text-xs text-slate-500">sec</span>
          </div>

          <button
            onClick={handleAddPlaylistItem}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add to Schedule
          </button>
        </div>
      </div>

      {/* All 25 Dynamic Face Expressions Studio */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              25 Dynamic Face Expressions
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any expression to animate the 0.96&quot; OLED and auto-sync to your ESP32 over Vercel Cloud
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search 25 faces..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['all', 'happy', 'expressive', 'playful', 'moody', 'sleepy'] as const).map(
                (cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                      category === cat
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cat}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 pt-4">
          {filteredFaces.map((face) => {
            const isActive =
              activeScreen.kind === 'face' && activeScreen.faceId === face.id;
            return (
              <button
                key={face.id}
                onClick={() => onSelectFace(face.id)}
                className={`text-left p-2.5 rounded-lg border transition-all group ${
                  isActive
                    ? 'border-blue-600 bg-blue-50/50 ring-1 ring-blue-600/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                }`}
              >
                <MiniFacePreview faceId={face.id} scheme={oledScheme} active={isActive} />
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      {face.name}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                      #{face.id + 1}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {face.bengali}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {filteredFaces.length === 0 && (
          <div className="py-10 text-center text-xs text-slate-500">
            <MessageSquare className="w-5 h-5 mx-auto mb-2 text-slate-400" />
            No expressions matched your search.
          </div>
        )}
      </div>
    </div>
  );
};
