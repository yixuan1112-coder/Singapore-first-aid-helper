// Live Singapore data → normalized GeoJSON layers for the map.
//
// This is a from-scratch JS port of the v2 backend data layer
// (kampungkaki-v2/backend/sources.py). Every public feed becomes the same
// shape so the map renders it without knowing the source:
//
//   { id, label, category, source, attribution,
//     state: 'fresh' | 'down' | 'not_configured',
//     fetchedAt, count, geojson: <FeatureCollection>, error? }
//
// Hard rule (kept from the original product): a feed that fails returns
// state:'down' with an EMPTY collection and an error string. We never
// fabricate a reading and there are NO demo fallbacks anywhere.
//
// Correct endpoints (the lesson from v2): NEA station feeds
// (rainfall/air-temp/humidity/wind) use the v2 real-time API — the legacy v1
// station endpoints now return a single station. PSI/PM2.5 (region) and the
// 2h forecast stay on v1. LTA paginates at 500 rows. OneMap tokens expire in
// ~3 days so we mint a fresh one from ONEMAP_EMAIL/ONEMAP_PASSWORD.

import { DENGUE_SEED } from './_dengue-seed.js';

const NEA_V1 = 'https://api.data.gov.sg/v1/environment';
const NEA_V2 = 'https://api-open.data.gov.sg/v2/real-time/api';
const LTA = 'https://datamall2.mytransport.sg/ltaodataservice';
const DATAGOV = 'https://api-open.data.gov.sg/v1/public/api/datasets';
const DENGUE_DATASET = 'd_dbfabf16158d1b0e1c420627c0819168';

const CACHE_MS = 60_000;
let cache = null;

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_MS) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ...cache, cached: true }));
    return;
  }

  const results = await Promise.all([
    fetchRegion('psi', 'Air quality (PSI)', 'air', 'NEA PSI', `${NEA_V1}/psi`, 'psi_twenty_four_hourly'),
    fetchRegion('pm25', 'PM2.5', 'air', 'NEA PM2.5', `${NEA_V1}/pm25`, 'pm25_one_hourly'),
    fetchStation('rainfall', 'Rainfall', 'weather', 'NEA rainfall', 'rainfall', 'mm'),
    fetchStation('air_temp', 'Air temperature', 'weather', 'NEA air temp', 'air-temperature', '°C'),
    fetchStation('humidity', 'Humidity', 'weather', 'NEA humidity', 'relative-humidity', '%'),
    fetchWind(),
    fetchForecast2h(),
    fetchIncidents(),
    fetchCameras(),
    fetchTaxi(),
    fetchDengue(),
  ]);

  const payload = { fetchedAt: now, cached: false, layers: results };
  cache = payload;
  res.statusCode = 200;
  res.end(JSON.stringify(payload));
}

// ── shape helpers ─────────────────────────────────────────────────────────────

const fc = (features) => ({ type: 'FeatureCollection', features });
const point = (lng, lat, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties,
});

function ok(id, label, category, source, attribution, features) {
  return { id, label, category, source, attribution, state: 'fresh', fetchedAt: Date.now(), count: features.length, geojson: fc(features) };
}
function down(id, label, category, source, error, state = 'down') {
  return { id, label, category, source, attribution: source, state, fetchedAt: Date.now(), count: 0, geojson: fc([]), error };
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Wrap a fetcher so any throw becomes an honest `down` layer, never a crash.
async function guard(id, label, category, source, fn) {
  try {
    return await fn();
  } catch (err) {
    return down(id, label, category, source, `${err?.message || 'fetch failed'}`);
  }
}

// ── NEA region (PSI, PM2.5) — v1 region endpoint, 5 region centroids ──────────

function psiBand(v) {
  if (v <= 50) return 'Good';
  if (v <= 100) return 'Moderate';
  if (v <= 200) return 'Unhealthy';
  if (v <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

function fetchRegion(id, label, category, source, url, readingKey) {
  return guard(id, label, category, source, async () => {
    const payload = await getJson(url);
    const centroids = {};
    for (const r of payload.region_metadata || []) {
      centroids[r.name] = [r.label_location.longitude, r.label_location.latitude];
    }
    const readings = payload.items?.[0]?.readings?.[readingKey] || {};
    const feats = [];
    for (const [region, [lng, lat]] of Object.entries(centroids)) {
      if (region === 'national') continue;
      const value = readings[region];
      if (value == null) continue;
      feats.push(point(lng, lat, {
        layer: id, region, value,
        band: id === 'psi' ? psiBand(value) : null,
        unit: id === 'psi' ? 'PSI' : 'µg/m³',
        source,
      }));
    }
    return ok(id, label, category, source, 'data.gov.sg / NEA', feats);
  });
}

// ── NEA station (rainfall, temp, humidity) — v2 real-time, full coverage ──────

function v2Coords(payload) {
  const out = {};
  for (const s of payload.data?.stations || []) {
    out[s.id] = [s.location.longitude, s.location.latitude, s.name || s.id];
  }
  return out;
}
function v2Readings(payload) {
  const first = payload.data?.readings?.[0]?.data || [];
  const out = {};
  for (const r of first) out[r.stationId] = r.value;
  return out;
}

function fetchStation(id, label, category, source, path, unit) {
  return guard(id, label, category, source, async () => {
    const payload = await getJson(`${NEA_V2}/${path}`);
    const coords = v2Coords(payload);
    const readings = v2Readings(payload);
    const feats = [];
    for (const [sid, value] of Object.entries(readings)) {
      const c = coords[sid];
      if (!c) continue;
      feats.push(point(c[0], c[1], { layer: id, station: c[2], value, unit, source }));
    }
    return ok(id, label, category, source, 'data.gov.sg / NEA', feats);
  });
}

function fetchWind() {
  return guard('wind', 'Wind', 'weather', 'NEA wind', async () => {
    const [spd, drc] = await Promise.all([
      getJson(`${NEA_V2}/wind-speed`),
      getJson(`${NEA_V2}/wind-direction`),
    ]);
    const coords = v2Coords(spd);
    const speed = v2Readings(spd);
    const direction = v2Readings(drc);
    const feats = [];
    for (const [sid, c] of Object.entries(coords)) {
      if (speed[sid] == null) continue;
      feats.push(point(c[0], c[1], {
        layer: 'wind', station: c[2], value: speed[sid],
        direction: direction[sid] ?? null, unit: 'knots', source: 'NEA wind',
      }));
    }
    return ok('wind', 'Wind', 'weather', 'NEA wind', 'data.gov.sg / NEA', feats);
  });
}

function fetchForecast2h() {
  return guard('forecast2h', '2-hour forecast', 'weather', 'NEA 2h forecast', async () => {
    const payload = await getJson(`${NEA_V1}/2-hour-weather-forecast`);
    const areas = {};
    for (const a of payload.area_metadata || []) {
      areas[a.name] = [a.label_location.longitude, a.label_location.latitude];
    }
    const forecasts = payload.items?.[0]?.forecasts || [];
    const feats = [];
    for (const f of forecasts) {
      const a = areas[f.area];
      if (!a) continue;
      feats.push(point(a[0], a[1], { layer: 'forecast2h', area: f.area, forecast: f.forecast, source: 'NEA 2h forecast' }));
    }
    return ok('forecast2h', '2-hour forecast', 'weather', 'NEA 2h forecast', 'data.gov.sg / NEA', feats);
  });
}

// ── LTA DataMall (incidents, cameras, taxi) — keyed, paginated ────────────────

function ltaHeaders() {
  return { AccountKey: process.env.DATAMALL_ACCOUNT_KEY, accept: 'application/json' };
}

function fetchIncidents() {
  if (!process.env.DATAMALL_ACCOUNT_KEY) return Promise.resolve(down('incidents', 'Traffic incidents', 'traffic', 'LTA DataMall', 'DATAMALL_ACCOUNT_KEY not set', 'not_configured'));
  return guard('incidents', 'Traffic incidents', 'traffic', 'LTA DataMall', async () => {
    const payload = await getJson(`${LTA}/TrafficIncidents`, ltaHeaders());
    const feats = (payload.value || []).map((i) =>
      point(i.Longitude, i.Latitude, { layer: 'incidents', type: i.Type, message: i.Message, source: 'LTA DataMall' }));
    return ok('incidents', 'Traffic incidents', 'traffic', 'LTA DataMall', 'LTA DataMall', feats);
  });
}

function fetchCameras() {
  if (!process.env.DATAMALL_ACCOUNT_KEY) return Promise.resolve(down('cameras', 'Traffic cameras', 'traffic', 'LTA DataMall', 'DATAMALL_ACCOUNT_KEY not set', 'not_configured'));
  return guard('cameras', 'Traffic cameras', 'traffic', 'LTA DataMall', async () => {
    const payload = await getJson(`${LTA}/Traffic-Imagesv2`, ltaHeaders());
    const feats = (payload.value || []).map((c) =>
      point(c.Longitude, c.Latitude, { layer: 'cameras', cameraId: c.CameraID, image: c.ImageLink, source: 'LTA DataMall' }));
    return ok('cameras', 'Traffic cameras', 'traffic', 'LTA DataMall', 'LTA DataMall', feats);
  });
}

function fetchTaxi() {
  if (!process.env.DATAMALL_ACCOUNT_KEY) return Promise.resolve(down('taxi', 'Available taxis', 'traffic', 'LTA DataMall', 'DATAMALL_ACCOUNT_KEY not set', 'not_configured'));
  return guard('taxi', 'Available taxis', 'traffic', 'LTA DataMall', async () => {
    const feats = [];
    for (let skip = 0; skip < 4000; skip += 500) {
      const url = `${LTA}/Taxi-Availability${skip ? `?$skip=${skip}` : ''}`;
      const rows = (await getJson(url, ltaHeaders())).value || [];
      for (const t of rows) feats.push(point(t.Longitude, t.Latitude, { layer: 'taxi', source: 'LTA DataMall' }));
      if (rows.length < 500) break;
    }
    return ok('taxi', 'Available taxis', 'traffic', 'LTA DataMall', 'LTA DataMall', feats);
  });
}

// Hospitals & AEDs are static reference data, not live feeds — they are served
// as bundled static assets (public/data/sg-hospitals.geojson, sg-aeds.geojson)
// and loaded straight by the map, so they never depend on a OneMap token.

// ── Dengue clusters (data.gov.sg, auth-free) — polygons ───────────────────────
// Dengue clusters update ~daily, but data.gov.sg's *download* endpoint throttles
// far harder than its API endpoints — polling it every 60s (our refresh cadence)
// reliably 429s. So we decouple dengue from the refresh loop entirely:
//   • only ATTEMPT upstream once per DENGUE_RETRY (30 min), never per request;
//   • serve the last good live clusters in between;
//   • if we've never had a live success (cold start / throttled), serve the
//     BUNDLED seed snapshot so the layer is never "down".
// The seed is a real capture committed in _dengue-seed.js (imported, so it ships
// inside the serverless function — unlike public/ assets we can't fs-read here).

const DENGUE_RETRY = 30 * 60 * 1000;
let lastGoodDengue = null; // { features, fetchedAt }
let lastDengueAttempt = 0;

function dengueOk(feats, attribution) {
  return ok('dengue', 'Dengue clusters', 'hazard', 'NEA dengue', attribution, feats);
}

async function fetchDengue() {
  // Inside the retry window: don't touch upstream. Serve live-if-we-have-it,
  // else the bundled seed.
  if (Date.now() - lastDengueAttempt < DENGUE_RETRY) {
    return lastGoodDengue
      ? dengueOk(lastGoodDengue.features, 'data.gov.sg / NEA')
      : dengueOk(DENGUE_SEED, 'data.gov.sg / NEA (seed)');
  }
  lastDengueAttempt = Date.now();
  try {
    const poll = await getJson(`${DATAGOV}/${DENGUE_DATASET}/poll-download`);
    const url = poll?.data?.url;
    if (!url) throw new Error('no download url');
    const geo = await getJson(url);
    const feats = (geo.features || []).map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        layer: 'dengue',
        source: 'NEA dengue',
        locality: f.properties?.LOCALITY || '',
        name: f.properties?.NAME || '',
        caseSize: Number(f.properties?.CASE_SIZE) || 0,
      },
    }));
    lastGoodDengue = { features: feats, fetchedAt: Date.now() };
    return dengueOk(feats, 'data.gov.sg / NEA');
  } catch {
    // Throttled/down — serve last good live clusters, else the bundled seed.
    // Dengue is never reported "down": stale-but-real beats a blank hazard layer.
    return lastGoodDengue
      ? dengueOk(lastGoodDengue.features, 'data.gov.sg / NEA (cached)')
      : dengueOk(DENGUE_SEED, 'data.gov.sg / NEA (seed)');
  }
}
