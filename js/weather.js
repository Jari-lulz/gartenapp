// Wetter von Open-Meteo (kostenlos, ohne Anmeldung) und daraus abgeleitete Garten-Hinweise.
import { settings } from './settings.js';

const CACHE_MS = 2 * 60 * 60 * 1000; // 2 Stunden
const STORM_KMH = 62; // ab Windstärke 8 (stürmischer Wind)

export async function forecast(loc) {
  const cacheKey = `wx2.${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
  const cached = settings.getCache(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${loc.lat}&longitude=${loc.lon}`
    + '&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,weather_code,wind_gusts_10m_max'
    + '&timezone=auto&forecast_days=8';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wetter nicht verfügbar');
  const data = await res.json();
  settings.setCache(cacheKey, { at: Date.now(), data });
  return data;
}

// Adresse oder Ort suchen (OpenStreetMap / Nominatim, kostenlos). Ergebnis bleibt nur auf dem Gerät.
const NOMINATIM = 'https://nominatim.openstreetmap.org';

function fromOsm(r) {
  const a = r.address || {};
  const town = a.city || a.town || a.village || a.municipality || a.hamlet || a.county || r.name || '';
  const street = [a.road, a.house_number].filter(Boolean).join(' ');
  const region = a.state || '';
  return {
    name: town,
    label: [street, [a.postcode, town].filter(Boolean).join(' '), region].filter(Boolean).join(', '),
    lat: Math.round(parseFloat(r.lat) * 1e4) / 1e4,
    lon: Math.round(parseFloat(r.lon) * 1e4) / 1e4,
  };
}

export async function searchPlace(query) {
  try {
    const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=5&accept-language=de&countrycodes=de,at,ch&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const list = (await res.json()).map(fromOsm).filter((p) => p.name);
    if (list.length) return list;
  } catch { /* weiter mit der Ortssuche */ }
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=de&format=json`;
  const data = await (await fetch(url)).json();
  return (data.results || []).map((r) => ({
    name: r.name,
    label: [r.name, r.admin1].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

export async function placeFromGps(lat, lon) {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=14&accept-language=de&lat=${lat}&lon=${lon}`);
    const p = fromOsm(await res.json());
    if (p.name) return { ...p, label: p.label || p.name };
  } catch { /* ohne Namen weiter */ }
  return { name: 'Mein Garten', label: 'Aktueller Standort', lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

// ---------- Wettersymbole (eigene Zeichnungen, überall gleich) ----------
const SUN = (cx, cy, r) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 3), y1 = cy + Math.sin(a) * (r + 3);
    const x2 = cx + Math.cos(a) * (r + 6.5), y2 = cy + Math.sin(a) * (r + 6.5);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join('');
  return `<g class="wx-rays" style="transform-origin:${cx}px ${cy}px" stroke="#FFC93C" stroke-width="2.6" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFD54A" stroke="#F5A623" stroke-width="1.5"/>`;
};
const CLOUD = (dx, dy, s, fill) => `<path transform="translate(${dx} ${dy}) scale(${s})" d="M14 34h24a9 9 0 0 0 0-18 12 12 0 0 0-23-3 8.5 8.5 0 0 0-1 21z" fill="${fill}" stroke="rgba(40,60,80,.25)" stroke-width="1.2"/>`;
const DROPS = (n, color = '#4FA3F7') => {
  const xs = n === 2 ? [20, 30] : n === 3 ? [17, 26, 35] : [15, 22, 29, 36];
  return xs.map((x, i) => `<path class="wx-drop" style="animation-delay:${(i * 0.27).toFixed(2)}s" d="M${x} ${39 + (i % 2) * 3}l-2.5 6" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join('');
};
const FLAKES = () => [16, 26, 36].map((x, i) => `<g class="wx-flake" style="animation-delay:${i * 0.4}s"><g transform="translate(${x} ${43 + (i % 2) * 3})" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><line x1="-3" y1="0" x2="3" y2="0"/><line x1="-1.5" y1="-2.6" x2="1.5" y2="2.6"/><line x1="-1.5" y1="2.6" x2="1.5" y2="-2.6"/></g></g>`).join('');
const HAIL = () => [16, 24, 32, 38].map((x, i) => `<circle class="wx-drop" style="animation-delay:${i * 0.2}s" cx="${x}" cy="${42 + (i % 2) * 4}" r="2.6" fill="#EAF6FF" stroke="#7FB8E6" stroke-width="1.2"/>`).join('');
const BOLT = '<path class="wx-bolt" d="M27 33l-6 9h5l-3 8 9-11h-5l3-6z" fill="#FFD23F" stroke="#E0A800" stroke-width="1"/>';
const WIND = '<g class="wx-wind" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"><path d="M6 20h26a5 5 0 1 0-5-5"/><path d="M6 29h34a5 5 0 1 1-5 5"/><path d="M10 38h16"/></g>';
const FOG = '<g stroke="#E8EEF2" stroke-width="3" stroke-linecap="round"><line x1="10" y1="38" x2="40" y2="38"/><line x1="14" y1="44" x2="36" y2="44"/></g>';

const W = '#FFFFFF';
const G = '#DCE3EA';
const D = '#9AA7B4';

const ICONS = {
  sonne: { label: 'Sonne', svg: SUN(25, 25, 9) },
  heiter: { label: 'Heiter', svg: SUN(20, 18, 7.5) + CLOUD(10, 12, 0.8, W) },
  wolkig: { label: 'Wolkig', svg: SUN(17, 15, 7) + CLOUD(4, 8, 0.95, W) },
  bedeckt: { label: 'Bedeckt', svg: CLOUD(8, -2, 0.85, D) + CLOUD(0, 6, 1, G) },
  nebel: { label: 'Nebel', svg: CLOUD(2, -2, 0.95, G) + FOG },
  niesel: { label: 'Niesel', svg: CLOUD(0, 0, 1, G) + DROPS(2, '#7DBBF5') },
  regen: { label: 'Regen', svg: CLOUD(0, 0, 1, D) + DROPS(3) },
  starkregen: { label: 'Starkregen', svg: CLOUD(0, 0, 1, '#7F8C99') + DROPS(4, '#2F86E8') },
  schauer: { label: 'Schauer', svg: SUN(34, 14, 6) + CLOUD(-2, 2, 0.95, G) + DROPS(2) },
  schnee: { label: 'Schnee', svg: CLOUD(0, 0, 1, G) + FLAKES() },
  hagel: { label: 'Hagel', svg: CLOUD(0, 0, 1, D) + HAIL() },
  gewitter: { label: 'Gewitter', svg: CLOUD(0, 0, 1, '#7F8C99') + BOLT },
  sturm: { label: 'Sturm', svg: WIND },
};

export function kind(code, gusts = 0) {
  if (code >= 96) return 'hagel';
  if (code === 95) return 'gewitter';
  if (gusts >= STORM_KMH) return 'sturm';
  if (code === 0) return 'sonne';
  if (code === 1) return 'heiter';
  if (code === 2) return 'wolkig';
  if (code === 3) return 'bedeckt';
  if (code === 45 || code === 48) return 'nebel';
  if (code >= 51 && code <= 57) return 'niesel';
  if (code === 65 || code === 67 || code === 82) return 'starkregen';
  if (code >= 61 && code <= 67) return 'regen';
  if (code === 77) return 'hagel'; // Graupel
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'schnee';
  if (code >= 80 && code <= 81) return 'schauer';
  return 'bedeckt';
}

export function iconSvg(k) {
  const i = ICONS[k] || ICONS.bedeckt;
  return `<svg class="wx-svg" viewBox="0 0 50 52" role="img" aria-label="${i.label}">${i.svg}</svg>`;
}
export const iconLabel = (k) => (ICONS[k] || ICONS.bedeckt).label;

export function weekday(isoDate, short = false) {
  return new Date(isoDate + 'T12:00').toLocaleDateString('de-DE', { weekday: short ? 'short' : 'long' });
}

// Index 0 = heute. Der Tiefstwert eines Tages fällt meist in die Nacht davor (frühmorgens).
export function buildHints(d, kuebelNames, now = new Date()) {
  const hints = [];
  const days = d.daily.time;
  const mins = d.daily.temperature_2m_min;
  const rain = d.daily.precipitation_sum;
  const gusts = d.daily.wind_gusts_10m_max || [];
  const month = now.getMonth() + 1;
  const names = kuebelNames.length ? ` Betroffen: ${kuebelNames.join(', ')}.` : '';

  // Frost in den nächsten drei Nächten (Jan/Feb stehen die Kübel ohnehin drinnen)
  if (month !== 1 && month !== 2) {
    const i = [1, 2, 3].find((n) => mins[n] !== undefined && mins[n] <= 2);
    if (i) {
      hints.push({
        key: 'frost-' + days[i],
        level: 'warn',
        title: i === 1 ? '❄️ Heute Nacht wird es frostig!' : `❄️ Frost in der Nacht auf ${weekday(days[i])}`,
        text: `Bis zu ${Math.round(mins[i])} °C. Kübelpflanzen reinholen oder gut abdecken.${names}`,
      });
    }
  }

  // Frühjahr: eine Woche lang frostfreie Nächte
  if (month >= 4 && month <= 6) {
    const week = mins.slice(1, 8);
    if (week.length >= 7 && week.every((t) => t >= 5)) {
      const early = month === 4 || (month === 5 && now.getDate() < 15);
      hints.push({
        key: 'raus-' + now.getFullYear(),
        level: 'good',
        title: '🌱 Kübelpflanzen können wieder raus',
        text: `Die nächsten 7 Nächte bleiben frostfrei (mindestens ${Math.round(Math.min(...week))} °C).`
          + (early ? ' Achtung: Bis zu den Eisheiligen (Mitte Mai) kann es noch einmal Frost geben – empfindliche Pflanzen lieber nachts abdecken.' : '')
          + names,
      });
    }
  }

  // Sturm heute oder morgen
  const s = [0, 1].find((n) => gusts[n] >= STORM_KMH);
  if (s !== undefined) {
    hints.push({
      key: 'sturm-' + days[s],
      level: 'warn',
      title: s === 0 ? '💨 Heute stürmisch!' : '💨 Morgen wird es stürmisch',
      text: `Böen bis ${Math.round(gusts[s])} km/h. Kübel, Gartenmöbel und Rankhilfen sichern.`,
    });
  }

  // Regen morgen
  if (rain[1] >= 3) {
    hints.push({
      key: 'regen-' + days[1],
      level: 'info',
      title: '🌧️ Morgen regnet es',
      text: `Etwa ${Math.round(rain[1])} mm Regen – Gießen kannst du dir sparen.`,
    });
  }

  return hints;
}
