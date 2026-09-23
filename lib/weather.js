// Forecast from Open-Meteo (no key needed) and severe-weather alerts from the US National Weather Service.
const SEVERITY = { Extreme: 0, Severe: 1, Moderate: 2 };

async function forecast(loc, units) {
  const params = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: 6, temperature_unit: units,
    current: 'temperature_2m,apparent_temperature,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
  });
  const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Weather service error (${res.status})`);
  const j = await res.json();
  if (!j.current) throw new Error('The weather service returned no data.');
  return j;
}

async function alerts(loc) {
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`, {
    headers: { Accept: 'application/geo+json', 'User-Agent': 'start-page (local personal dashboard)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.features || []).map(f => f.properties)
    .filter(p => p.severity in SEVERITY)
    .sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity])
    .slice(0, 3)
    .map(p => ({ event: p.event, severity: p.severity, until: p.ends || p.expires, headline: p.headline || '', description: (p.description || '').slice(0, 600) }));
}

async function get(cfg) {
  if (!cfg.location) return { configured: false };
  const [f, a] = await Promise.allSettled([
    forecast(cfg.location, cfg.units),
    cfg.weatherAlerts && cfg.location.country === 'US' ? alerts(cfg.location) : Promise.resolve([]),
  ]);
  if (f.status === 'rejected') throw f.reason;
  return { configured: true, location: cfg.location, units: cfg.units, forecast: f.value, alerts: a.status === 'fulfilled' ? a.value : [] };
}

module.exports = { get };
