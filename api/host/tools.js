// Server-side Host AI tools. Each returns a typed value the LLM can read
// inside context.tools.* — or a {state:"unavailable"|"not_configured", note}
// shape when the upstream provider isn't reachable.
//
// All upstream calls are best-effort and time-bounded so /api/host/ask
// never blocks the user.

const FETCH_TIMEOUT_MS = 4500;

async function timedFetch(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...(init ?? {}), signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function haversineKm(a, b) {
  if (!a || !b || ![a.lng, a.lat, b.lng, b.lat].every(Number.isFinite)) return Infinity;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function parseLatLng(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const [a, b] = match[0].split(',').map((v) => Number(v.trim()));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a > 90) return { lng: a, lat: b };
  return { lng: b, lat: a };
}

// ───────── PSI ─────────
export async function getLivePsi() {
  try {
    const res = await timedFetch('https://api.data.gov.sg/v1/environment/psi');
    if (!res.ok) return { state: 'unavailable', note: `HTTP ${res.status}` };
    const json = await res.json();
    const readings = json.items?.[0]?.readings?.psi_twenty_four_hourly ?? {};
    return {
      state: 'live',
      fetchedAt: Date.now(),
      psi24h: {
        national: readings.national ?? null,
        north: readings.north ?? null,
        south: readings.south ?? null,
        east: readings.east ?? null,
        west: readings.west ?? null,
        central: readings.central ?? null,
      },
    };
  } catch (error) {
    return { state: 'unavailable', note: error?.message ?? 'fetch failed' };
  }
}

// ───────── Rainfall (optionally bounded by user location) ─────────
export async function getLiveRainfall(near) {
  try {
    const res = await timedFetch('https://api.data.gov.sg/v1/environment/rainfall');
    if (!res.ok) return { state: 'unavailable', note: `HTTP ${res.status}` };
    const json = await res.json();
    const stations = json.metadata?.stations ?? [];
    const readings = json.items?.[0]?.readings ?? [];
    const byStation = new Map(readings.map((r) => [r.station_id, r.value]));
    const all = stations.map((s) => ({
      stationId: s.id,
      name: s.name,
      lng: s.location.longitude,
      lat: s.location.latitude,
      mm: byStation.get(s.id) ?? 0,
    }));
    if (!near) return { state: 'live', fetchedAt: Date.now(), stations: all.slice(0, 10) };
    const nearest = all
      .map((station) => ({ station, distanceKm: haversineKm(near, station) }))
      .filter((entry) => Number.isFinite(entry.distanceKm))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 3)
      .map((entry) => ({ ...entry.station, distanceKm: Number(entry.distanceKm.toFixed(2)) }));
    return { state: 'live', fetchedAt: Date.now(), nearest };
  } catch (error) {
    return { state: 'unavailable', note: error?.message ?? 'fetch failed' };
  }
}

// ───────── OneMap themes (AED + hospitals) ─────────
async function fetchOneMapTheme(queryName) {
  const key = process.env.ONEMAP_API_KEY;
  if (!key) return { state: 'not_configured', note: 'ONEMAP_API_KEY missing on server.' };
  try {
    const url = `https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName=${encodeURIComponent(queryName)}`;
    const res = await timedFetch(url, {
      headers: { Authorization: key, accept: 'application/json' },
    });
    if (!res.ok) return { state: 'unavailable', note: `HTTP ${res.status}` };
    const json = await res.json();
    const rows = (Array.isArray(json.SrchResults) ? json.SrchResults : []).filter(
      (row) => row && !('FeatCount' in row),
    );
    return { state: 'live', rows };
  } catch (error) {
    return { state: 'unavailable', note: error?.message ?? 'fetch failed' };
  }
}

function rowToPoi(row, kind) {
  const point = parseLatLng(row.LatLng);
  if (!point) return null;
  const name =
    row.NAME ||
    row.DESCRIPTION ||
    row.HCI_NAME ||
    row.MAPTIP ||
    (kind === 'hospital' ? 'Hospital' : 'AED');
  return { name: String(name).slice(0, 48), lng: point.lng, lat: point.lat, kind };
}

export async function getNearestAed(loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return { state: 'unavailable', note: 'No origin location supplied.' };
  }
  const theme = await fetchOneMapTheme('aed_locations');
  if (theme.state !== 'live') return theme;
  const pois = theme.rows.map((row) => rowToPoi(row, 'aed')).filter(Boolean);
  const ranked = pois
    .map((poi) => ({ poi, distanceKm: haversineKm(loc, poi) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 3)
    .map((entry) => ({ ...entry.poi, distanceKm: Number(entry.distanceKm.toFixed(2)) }));
  return { state: 'live', fetchedAt: Date.now(), nearest: ranked };
}

export async function getNearestHospital(loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return { state: 'unavailable', note: 'No origin location supplied.' };
  }
  const theme = await fetchOneMapTheme('moh_hospitals');
  if (theme.state !== 'live') return theme;
  const pois = theme.rows.map((row) => rowToPoi(row, 'hospital')).filter(Boolean);
  const ranked = pois
    .map((poi) => ({ poi, distanceKm: haversineKm(loc, poi) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 3)
    .map((entry) => ({ ...entry.poi, distanceKm: Number(entry.distanceKm.toFixed(2)) }));
  return { state: 'live', fetchedAt: Date.now(), nearest: ranked };
}

// ───────── Tool runner: resolve a workspace's tool list in parallel ─────────
export async function runTools(toolNames, args) {
  const wanted = new Set(toolNames ?? []);
  const tasks = [];
  if (wanted.has('psi')) tasks.push(['psi', getLivePsi()]);
  if (wanted.has('rainfall')) tasks.push(['rainfall', getLiveRainfall(args.origin)]);
  if (wanted.has('nearestAed')) tasks.push(['nearestAed', getNearestAed(args.origin)]);
  if (wanted.has('nearestHospital'))
    tasks.push(['nearestHospital', getNearestHospital(args.origin)]);
  const out = {};
  const results = await Promise.allSettled(tasks.map((t) => t[1]));
  results.forEach((r, i) => {
    out[tasks[i][0]] = r.status === 'fulfilled' ? r.value : { state: 'unavailable', note: 'task rejected' };
  });
  return out;
}
