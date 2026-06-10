// Cache-only data access for the AI skill layer (Pelita / Bekal / Pondok).
//
// THE RATE-LIMIT RULE (do not break): skills NEVER call an upstream API. Static
// layers (hospitals, AEDs) are bundled geojson read from disk once and memoised.
// Live conditions are read from the already-cached /api/live/map-layers endpoint
// (added with conditions-read) — an internal call to a 60s-cached function, not
// a new upstream hit. The only outbound network any agent makes is to the LLM.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', '..', 'public', 'data');

const _fc = new Map();
async function loadFc(name) {
  if (_fc.has(name)) return _fc.get(name);
  const fc = JSON.parse(await readFile(join(DATA_DIR, name), 'utf-8'));
  _fc.set(name, fc);
  return fc;
}

export const hospitals = () => loadFc('sg-hospitals.geojson');
export const aeds = () => loadFc('sg-aeds.geojson');
export const planningAreas = () => loadFc('sg-planning-areas.geojson');

// Ray-casting point-in-polygon against one linear ring of [lng,lat] pairs.
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Resolve {lng,lat} to a real Singapore planning area from the BUNDLED geojson
// (cache-only, no API). Returns { name, region } or null when outside all areas.
// This is the truth source that stops the AI inventing area names from coords.
export async function locateArea(origin) {
  if (!origin || !Number.isFinite(origin.lng) || !Number.isFinite(origin.lat)) return null;
  const fc = await planningAreas();
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      if (poly?.[0] && pointInRing(origin.lng, origin.lat, poly[0])) {
        return { name: f.properties?.name ?? null, region: f.properties?.region ?? null };
      }
    }
  }
  return null;
}

export function haversineKm(a, b) {
  if (!a || !b || ![a.lng, a.lat, b.lng, b.lat].every(Number.isFinite)) return Infinity;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Rank Point features by distance from an origin {lng,lat}.
export function nearestFeatures(fc, origin, limit) {
  return (fc.features ?? [])
    .filter((f) => f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates))
    .map((f) => {
      const [lng, lat] = f.geometry.coordinates;
      return { name: f.properties?.name ?? 'Unknown', lng, lat, props: f.properties ?? {}, km: haversineKm(origin, { lng, lat }) };
    })
    .sort((a, b) => a.km - b.km)
    .slice(0, Math.max(1, limit));
}
