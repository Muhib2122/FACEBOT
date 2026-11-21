import { LocationConfig, WeatherData } from '../types';

export const PRESET_CITIES: LocationConfig[] = [
  { city: 'Dhaka', country: 'Bangladesh', latitude: 23.8103, longitude: 90.4125, altitude: 14, timezone: 'Asia/Dhaka' },
  { city: 'Chattogram', country: 'Bangladesh', latitude: 22.3569, longitude: 91.7832, altitude: 15, timezone: 'Asia/Dhaka' },
  { city: 'Sylhet', country: 'Bangladesh', latitude: 24.8949, longitude: 91.8687, altitude: 35, timezone: 'Asia/Dhaka' },
  { city: 'Rajshahi', country: 'Bangladesh', latitude: 24.3745, longitude: 88.6042, altitude: 18, timezone: 'Asia/Dhaka' },
  { city: 'Khulna', country: 'Bangladesh', latitude: 22.8456, longitude: 89.5403, altitude: 9, timezone: 'Asia/Dhaka' },
  { city: 'Rangpur', country: 'Bangladesh', latitude: 25.7439, longitude: 89.2752, altitude: 34, timezone: 'Asia/Dhaka' },
  { city: 'London', country: 'United Kingdom', latitude: 51.5072, longitude: -0.1276, altitude: 11, timezone: 'Europe/London' },
  { city: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503, altitude: 40, timezone: 'Asia/Tokyo' },
  { city: 'New York', country: 'USA', latitude: 40.7128, longitude: -74.006, altitude: 10, timezone: 'America/New_York' },
];

export function decodeWeatherCode(code: number): string {
  if (code === 0) return 'Clear Sky';
  if (code === 1) return 'Mainly Clear';
  if (code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rainy';
  if (code >= 71 && code <= 77) return 'Snowfall';
  if (code >= 80 && code <= 82) return 'Rain Showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Mild Weather';
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchLiveWeather(location: LocationConfig): Promise<WeatherData> {
  const lat = Number.isFinite(location.latitude) ? location.latitude : 23.8103;
  const lon = Number.isFinite(location.longitude) ? location.longitude : 90.4125;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
    `&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m` +
    `&timezone=auto`;

  const response = await fetchWithTimeout(url, 10000);
  if (!response.ok) {
    throw new Error('Could not fetch live weather data');
  }

  const data = await response.json();
  const current = data?.current;
  if (!current || typeof current !== 'object') {
    throw new Error('Weather feed returned an incomplete response');
  }

  return {
    temperature: Number.isFinite(Number(current.temperature_2m)) ? Number(current.temperature_2m) : 28,
    apparentTemperature: Number.isFinite(Number(current.apparent_temperature))
      ? Number(current.apparent_temperature)
      : Number(current.temperature_2m) || 28,
    humidity: Number.isFinite(Number(current.relative_humidity_2m))
      ? Number(current.relative_humidity_2m)
      : 65,
    windSpeed: Number.isFinite(Number(current.wind_speed_10m)) ? Number(current.wind_speed_10m) : 8,
    weatherCode: Number.isFinite(Number(current.weather_code)) ? Number(current.weather_code) : 0,
    conditionLabel: decodeWeatherCode(Number(current.weather_code) || 0),
    isDay: Number(current.is_day) === 1,
    elevation: Number(data.elevation ?? location.altitude ?? 0),
    utcOffsetSeconds: Number(data.utc_offset_seconds ?? 21600),
    timezone: String(data.timezone ?? location.timezone ?? 'UTC'),
    updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

export async function searchCityGeocoding(query: string): Promise<LocationConfig[]> {
  if (!query.trim() || query.trim().length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=en&format=json`;
  const response = await fetchWithTimeout(url, 10000);
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data?.results)) return [];

  return data.results.map(
    (item: {
      name: string;
      country?: string;
      latitude: number;
      longitude: number;
      elevation?: number;
      timezone?: string;
    }) => ({
      city: item.name,
      country: item.country || '',
      latitude: item.latitude,
      longitude: item.longitude,
      altitude: Math.round(item.elevation ?? 0),
      timezone: item.timezone || 'auto',
    })
  );
}
