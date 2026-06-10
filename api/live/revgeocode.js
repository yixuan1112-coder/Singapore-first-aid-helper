// OneMap reverse geocode: lat,lng -> Singapore place name
// Uses the same ONEMAP_API_KEY as map-layers.js.
// Returns the most specific name available: BUILDINGNAME > ROAD + BLOCK > planning area.

const CACHE_MS = 60 * 60_000; // 1h: a coordinate box doesn't change names
const cache = new Map(); // key: rounded "lat,lng" -> { name, ts }

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 's-maxage=600, stale-while-revalidate=3600');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const url = new URL(req.url ?? '', 'http://localhost');
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'missing_or_invalid_lat_lng' }));
    return;
  }

  // Reject coords clearly outside Singapore bbox to avoid wasted calls
  if (lat < 1.15 || lat > 1.50 || lng < 103.55 || lng > 104.10) {
    res.statusCode = 200;
    res.end(JSON.stringify({ state: 'out_of_bounds', placeName: null, lat, lng }));
    return;
  }

  if (!process.env.ONEMAP_API_KEY) {
    res.statusCode = 200;
    res.end(JSON.stringify({ state: 'not_configured', placeName: null, lat, lng, note: 'ONEMAP_API_KEY not set.' }));
    return;
  }

  // Round to ~30m grid for cache reuse
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    res.statusCode = 200;
    res.end(JSON.stringify({ state: 'live', placeName: cached.name, lat, lng, cached: true }));
    return;
  }

  try {
    const upstream = await fetch(
      `https://www.onemap.gov.sg/api/public/revgeocode?location=${lat},${lng}&buffer=80&addressType=All&otherFeatures=N`,
      { headers: { Authorization: process.env.ONEMAP_API_KEY, accept: 'application/json' } }
    );
    if (!upstream.ok) {
      res.statusCode = 200;
      res.end(JSON.stringify({ state: 'unavailable', placeName: null, lat, lng, http: upstream.status }));
      return;
    }
    const data = await upstream.json();
    const rows = Array.isArray(data?.GeocodeInfo) ? data.GeocodeInfo : [];
    const placeName = pickPlaceName(rows);
    if (placeName) cache.set(cacheKey, { name: placeName, ts: Date.now() });
    res.statusCode = 200;
    res.end(JSON.stringify({ state: 'live', placeName, lat, lng, raw: rows[0] ?? null }));
  } catch (error) {
    res.statusCode = 200;
    res.end(JSON.stringify({ state: 'unavailable', placeName: null, lat, lng, error: error?.message ?? 'request failed' }));
  }
}

function pickPlaceName(rows) {
  if (rows.length === 0) return null;
  const first = rows[0];
  const building = clean(first.BUILDINGNAME);
  const road = clean(first.ROAD);
  const block = clean(first.BLOCK);
  const postal = clean(first.POSTALCODE);

  if (building && building !== 'NIL') {
    return road && road !== 'NIL' ? `${building}, ${road}` : building;
  }
  if (road && road !== 'NIL') {
    return block && block !== 'NIL' ? `Blk ${block} ${road}` : road;
  }
  if (postal && postal !== 'NIL') return `Singapore ${postal}`;
  return null;
}

function clean(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}
