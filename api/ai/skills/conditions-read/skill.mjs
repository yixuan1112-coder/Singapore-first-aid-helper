// conditions-read — summarise the live neighbourhood picture from the ALREADY
// cached map-layers (client passes its snapshot in context.conditions; else we
// read the 60s-cached server endpoint). NEVER hits an upstream API directly.

let _cache = null;
let _at = 0;
const TTL = 30_000;

export async function run(inputs = {}, context = {}) {
  // By default read the snapshot the CLIENT already refreshed on its 60s timer —
  // no fetch. Only hit the (still-cached) endpoint when the user explicitly
  // wants newer data than the last refresh (fresh=true).
  const fresh = inputs?.fresh === true || inputs?.fresh === 'true';
  let snap = (!fresh && context?.conditions?.layers) ? context.conditions : null;
  if (!snap) {
    const now = Date.now();
    if (_cache && now - _at < TTL) {
      snap = _cache;
    } else {
      const url = process.env.KK_LAYERS_URL ?? 'http://localhost:3000/api/live/map-layers';
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return { status: 'error', error: `conditions HTTP ${r.status}`, retryable: true, hint: 'live layers endpoint unavailable' };
        snap = await r.json();
        _cache = snap; _at = now;
      } catch (e) {
        return { status: 'error', error: 'conditions unavailable', retryable: true, hint: String(e?.message ?? e) };
      }
    }
  }

  const byId = Object.fromEntries((snap.layers ?? []).map((l) => [l.id, l]));
  const layer = (...ids) => ids.map((id) => byId[id]).find(Boolean);
  const isFreshLayer = (l) => !!l && (l.state === 'fresh' || l.state == null);
  const nums = (l) => {
    if (!isFreshLayer(l)) return null;
    const fromGeo = (l.geojson?.features ?? [])
      .map((f) => Number(f.properties?.value))
      .filter(Number.isFinite);
    const fromItems = (l.items ?? [])
      .map((i) => Number(i.value))
      .filter(Number.isFinite);
    return [...fromGeo, ...fromItems];
  };
  const stat = (a) => (a && a.length ? { min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1), avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) } : null);
  const statFor = (...ids) => {
    const l = layer(...ids);
    if (!isFreshLayer(l)) return null;
    if (l.stats && Number.isFinite(Number(l.stats.max))) {
      return { min: Number(l.stats.min), max: Number(l.stats.max), avg: Number(l.stats.avg) };
    }
    return stat(nums(l));
  };
  const count = (...ids) => {
    const l = layer(...ids);
    return isFreshLayer(l) && Number.isFinite(Number(l.count)) ? Number(l.count) : null;
  };
  const active = (...ids) => {
    const l = layer(...ids);
    if (!isFreshLayer(l)) return null;
    if (Number.isFinite(Number(l.activeCount))) return Number(l.activeCount);
    const values = nums(l);
    return values ? values.filter((v) => v > 0).length : null;
  };

  const temp = statFor('air_temp');
  const psi = statFor('psi');
  const rainStats = statFor('rainfall', 'rain');
  const rainActive = active('rainfall', 'rain');
  const rainMax = rainStats ? rainStats.max : null;
  const wind = statFor('wind');
  const dengue = count('dengue');
  const incidents = count('incidents');
  const taxi = count('taxi');

  const parts = [];
  if (temp) parts.push(`air temp ${temp.min}–${temp.max}°C`);
  if (psi) parts.push(`PSI up to ${psi.max}`);
  if (rainActive != null) parts.push(rainActive > 0 ? `rain at ${rainActive} station(s), max ${rainMax}mm` : 'no active rain');
  if (wind) parts.push(`wind up to ${wind.max}km/h`);
  if (dengue != null) parts.push(`${dengue} dengue cluster(s)`);
  if (incidents != null) parts.push(`${incidents} traffic incident(s)`);
  if (taxi != null) parts.push(`${taxi} taxis available`);

  return {
    status: 'ok',
    summary: parts.length ? parts.join(', ') + '.' : 'No live readings available.',
    metadata: { conditions: { temp, psi, rainActive, rainMax, wind, dengue, incidents, taxi }, fetchedAt: snap.fetchedAt ?? Date.now() },
  };
}
