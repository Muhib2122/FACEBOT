import React, { useState } from 'react';
import {
  Compass,
  MapPin,
  RefreshCw,
  Search,
  Snowflake,
  Thermometer,
  User,
} from 'lucide-react';
import { BotSettings, LocationConfig, WeatherData } from '../types';
import { PRESET_CITIES, searchCityGeocoding } from '../utils/weatherApi';

interface WeatherProfilePanelProps {
  settings: BotSettings;
  location: LocationConfig;
  weather: WeatherData | null;
  weatherLoading: boolean;
  weatherError: string | null;
  onUpdateSettings: (patch: Partial<BotSettings>) => void;
  onUpdateLocation: (loc: LocationConfig) => void;
  onRefreshWeather: () => void;
  onSimulateColdWeather: () => void;
  onShowWeatherOnOled: () => void;
  onShowGreetingOnOled: () => void;
}

export const WeatherProfilePanel: React.FC<WeatherProfilePanelProps> = ({
  settings,
  location,
  weather,
  weatherLoading,
  weatherError,
  onUpdateSettings,
  onUpdateLocation,
  onRefreshWeather,
  onSimulateColdWeather,
  onShowWeatherOnOled,
  onShowGreetingOnOled,
}) => {
  const [cityQuery, setCityQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationConfig[]>([]);
  const [searching, setSearching] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  const handleCitySearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityQuery.trim()) return;
    setSearching(true);
    try {
      const results = await searchCityGeocoding(cityQuery);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  };

  const handleUseBrowserGps = () => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation is not supported in this browser.');
      return;
    }
    setGpsStatus('Detecting coordinates & altitude...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const alt = pos.coords.altitude ? Math.round(pos.coords.altitude) : location.altitude;
        onUpdateLocation({
          city: 'My Location',
          country: 'GPS',
          latitude: Number(pos.coords.latitude.toFixed(4)),
          longitude: Number(pos.coords.longitude.toFixed(4)),
          altitude: alt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto',
        });
        setGpsStatus('Location updated from device GPS.');
      },
      () => {
        setGpsStatus('Location permission denied. Select a city or enter coordinates below.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="space-y-6">
      {/* Row 1: User Profile & Greeting Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Owner Profile &amp; Greetings
              </h3>
            </div>
            <button
              onClick={onShowGreetingOnOled}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Preview on OLED
            </button>
          </div>

          <div className="space-y-4 pt-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Your Name (displayed in greetings &amp; wake-up)
              </label>
              <input
                type="text"
                maxLength={14}
                value={settings.userName}
                onChange={(e) => onUpdateSettings({ userName: e.target.value })}
                placeholder="Muhib"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Auto Mode says &ldquo;Good Morning {settings.userName || 'Muhib'}&rdquo;, Afternoon, Evening, and Night based on live time.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Proximity Wake Prefix
                </label>
                <input
                  type="text"
                  maxLength={8}
                  value={settings.wakeGreetingPrefix}
                  onChange={(e) => onUpdateSettings({ wakeGreetingPrefix: e.target.value })}
                  placeholder="Hi"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Watch Clock Format
                </label>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    onClick={() => onUpdateSettings({ use24HourClock: false })}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      !settings.use24HourClock ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    12-Hour
                  </button>
                  <button
                    onClick={() => onUpdateSettings({ use24HourClock: true })}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      settings.use24HourClock ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    24-Hour
                  </button>
                </div>
              </div>
            </div>

            {/* Weather Reaction Thresholds */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">
                  Cold Reaction Trigger (&ldquo;Today is too cold!&rdquo;)
                </span>
                <span className="text-xs font-mono font-semibold text-blue-600 tabular-nums">
                  ≤ {settings.coldThresholdC}°C
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={26}
                value={settings.coldThresholdC}
                onChange={(e) => onUpdateSettings({ coldThresholdC: Number(e.target.value) })}
                className="w-full hw-slider"
              />

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-medium text-slate-700">
                  Hot Weather Alert Threshold
                </span>
                <span className="text-xs font-mono font-semibold text-amber-600 tabular-nums">
                  ≥ {settings.hotThresholdC}°C
                </span>
              </div>
              <input
                type="range"
                min={28}
                max={45}
                value={settings.hotThresholdC}
                onChange={(e) => onUpdateSettings({ hotThresholdC: Number(e.target.value) })}
                className="w-full hw-slider"
              />
            </div>
          </div>
        </div>

        {/* Live Weather Readout Card */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-slate-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Live WiFi Weather Feed
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onShowWeatherOnOled}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Show on OLED
                </button>
                <button
                  onClick={onRefreshWeather}
                  disabled={weatherLoading}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md"
                >
                  <RefreshCw className={`w-3 h-3 ${weatherLoading ? 'animate-spin' : ''}`} />
                  Sync
                </button>
              </div>
            </div>

            {weatherError && (
              <p className="text-xs text-red-600 mt-3">{weatherError}</p>
            )}

            {weather ? (
              <div className="pt-4">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <div className="text-3xl font-bold font-mono text-slate-900 tabular-nums">
                      {weather.temperature.toFixed(1)}°C
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      {weather.conditionLabel} · {location.city}
                      {location.country ? `, ${location.country}` : ''}
                      {weather.isSimulatedCold ? ' · Simulated Cold Test' : ''}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500 font-mono tabular-nums">
                    <div>Updated {weather.updatedAt}</div>
                    <div>Alt {Math.round(location.altitude || weather.elevation)} m</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 divide-x divide-slate-200 border border-slate-200 rounded-lg mt-4 bg-slate-50/70">
                  <div className="p-3">
                    <div className="text-[11px] text-slate-500">Feels Like</div>
                    <div className="text-sm font-semibold font-mono text-slate-900 tabular-nums mt-0.5">
                      {weather.apparentTemperature.toFixed(1)}°C
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-[11px] text-slate-500">Humidity</div>
                    <div className="text-sm font-semibold font-mono text-slate-900 tabular-nums mt-0.5">
                      {Math.round(weather.humidity)}%
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-[11px] text-slate-500">Wind</div>
                    <div className="text-sm font-semibold font-mono text-slate-900 tabular-nums mt-0.5">
                      {weather.windSpeed.toFixed(1)} km/h
                    </div>
                  </div>
                </div>

                {/* Weather Auto-Reaction Preview */}
                <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">Bot Auto Reaction: </span>
                  {weather.temperature <= settings.coldThresholdC
                    ? 'Freezing Cold face (#4) + "Today is too cold!" banner + Shivering servo motion.'
                    : weather.temperature >= settings.hotThresholdC
                      ? 'Hot weather alert banner + Dizzy expression.'
                      : 'Nominal comfort range — Normal Blink, Happy, and Watch screens.'}
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-xs text-slate-500">
                Loading live weather data from Open-Meteo...
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              Test cold weather behavior on OLED immediately
            </span>
            <button
              onClick={onSimulateColdWeather}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap"
            >
              <Snowflake className="w-3.5 h-3.5" />
              Test Cold Reaction (10°C)
            </button>
          </div>
        </div>
      </div>

      {/* Location Selector: City Search + Coordinates/Altitude + GPS */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                ESP32 Location &amp; Altitude Setup
              </h3>
              <p className="text-xs text-slate-500">
                Pick a city, search anywhere worldwide, or use device GPS coordinates &amp; altitude
              </p>
            </div>
          </div>

          <button
            onClick={handleUseBrowserGps}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Compass className="w-3.5 h-3.5" />
            Use Device GPS
          </button>
        </div>

        {gpsStatus && (
          <p className="text-xs text-blue-700 mt-3">{gpsStatus}</p>
        )}

        {/* City Search Bar */}
        <form onSubmit={handleCitySearch} className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              placeholder="Search any city (e.g. Dhaka, Cumilla, Sylhet, London)..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            {searching ? 'Searching...' : 'Search City'}
          </button>
        </form>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="mt-3 border border-slate-200 rounded-lg divide-y divide-slate-100">
            {searchResults.map((res, idx) => (
              <button
                key={`${res.city}-${idx}`}
                onClick={() => {
                  onUpdateLocation(res);
                  setSearchResults([]);
                  setCityQuery('');
                }}
                className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs"
              >
                <span className="font-semibold text-slate-900">
                  {res.city}, {res.country}
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {res.latitude.toFixed(2)}, {res.longitude.toFixed(2)} · {res.altitude}m
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Quick Preset Cities */}
        <div className="mt-4">
          <div className="text-[11px] font-medium text-slate-500 mb-2">
            Quick City Presets
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESET_CITIES.map((city) => {
              const selected = city.city === location.city;
              return (
                <button
                  key={city.city}
                  onClick={() => onUpdateLocation(city)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    selected
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {city.city}
                </button>
              );
            })}
          </div>
        </div>

        {/* Manual Coordinates & Altitude */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              City Label
            </label>
            <input
              type="text"
              value={location.city}
              onChange={(e) => onUpdateLocation({ ...location, city: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Latitude
            </label>
            <input
              type="number"
              step="0.0001"
              value={location.latitude}
              onChange={(e) =>
                onUpdateLocation({ ...location, latitude: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Longitude
            </label>
            <input
              type="number"
              step="0.0001"
              value={location.longitude}
              onChange={(e) =>
                onUpdateLocation({ ...location, longitude: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Altitude (meters)
            </label>
            <input
              type="number"
              value={location.altitude}
              onChange={(e) =>
                onUpdateLocation({ ...location, altitude: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg tabular-nums"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
