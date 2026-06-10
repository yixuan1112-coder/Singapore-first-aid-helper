// Singapore planning areas (URA Master Plan 2019, 55 areas) used as the
// masking unit for the response map. The map never moves the camera; instead
// it spotlights one or more focused planning areas and dims everything else
// (region-mask model). This module owns the geometry: loading the static
// boundary file, point-in-area lookup, and building the spotlight mask.
//
// The boundary file is a slimmed copy of data.gov.sg dataset
// d_4765db0e87b9c86336792efe8a1f7a66 (coords rounded, name/region/centroid
// kept) served as a static asset from /data/sg-planning-areas.geojson.

import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  Position,
} from 'geojson';

export interface PlanningAreaProps {
  name: string;
  region: string;
  center: [number, number];
}

type AreaFeature = Feature<Polygon | MultiPolygon, PlanningAreaProps>;
export type PlanningAreaCollection = FeatureCollection<Polygon | MultiPolygon, PlanningAreaProps>;

// Generous bounding ring around Singapore — the outer ring of the spotlight
// mask. Everything inside this ring is dimmed except the focused-area holes.
const SG_BBOX_RING: Position[] = [
  [103.55, 1.13],
  [104.15, 1.13],
  [104.15, 1.5],
  [103.55, 1.5],
  [103.55, 1.13],
];

let _cache: PlanningAreaCollection | null = null;
let _inflight: Promise<PlanningAreaCollection> | null = null;

export async function loadPlanningAreas(): Promise<PlanningAreaCollection> {
  if (_cache) return _cache;
  if (!_inflight) {
    _inflight = fetch('/data/sg-planning-areas.geojson')
      .then((r) => {
        if (!r.ok) throw new Error(`planning areas HTTP ${r.status}`);
        return r.json();
      })
      .then((fc: PlanningAreaCollection) => {
        _cache = fc;
        return fc;
      })
      .catch((err) => {
        _inflight = null; // allow a later retry
        throw err;
      });
  }
  return _inflight;
}

// ── point-in-polygon (ray casting), holes-aware ──────────────────────────────

function pointInRing(pt: Position, ring: Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// One polygon = [outerRing, ...holeRings]. Inside outer and outside all holes.
function pointInPolygonCoords(pt: Position, rings: Position[][]): boolean {
  if (!rings.length || !pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(pt, rings[i])) return false;
  }
  return true;
}

function pointInFeature(pt: Position, feature: AreaFeature): boolean {
  const g = feature.geometry;
  if (g.type === 'Polygon') return pointInPolygonCoords(pt, g.coordinates);
  return g.coordinates.some((poly) => pointInPolygonCoords(pt, poly));
}

/** Name of the planning area containing this point, or null if outside SG. */
export function areaNameAt(
  fc: PlanningAreaCollection,
  lng: number,
  lat: number,
): string | null {
  const pt: Position = [lng, lat];
  for (const f of fc.features) {
    if (pointInFeature(pt, f)) return f.properties.name;
  }
  return null;
}

/**
 * Is this point inside the focused set? Tests only the focused polygons, so it
 * stays cheap to call per-marker on every repaint.
 */
export function isInFocus(
  fc: PlanningAreaCollection,
  focus: ReadonlySet<string>,
  lng: number,
  lat: number,
): boolean {
  if (focus.size === 0) return true; // no focus = everything is "in scope"
  const pt: Position = [lng, lat];
  for (const f of fc.features) {
    if (focus.has(f.properties.name) && pointInFeature(pt, f)) return true;
  }
  return false;
}

/** Outer rings of the focused areas — used to draw the bright spotlight edge. */
export function focusOutlines(
  fc: PlanningAreaCollection,
  focus: ReadonlySet<string>,
): PlanningAreaCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.filter((f) => focus.has(f.properties.name)),
  };
}

/**
 * Spotlight mask: one polygon whose outer ring is the SG bbox and whose holes
 * are the focused planning areas. Filled dark and semi-opaque, it dims the
 * whole island except the focused cut-outs. Empty focus → empty collection
 * (no mask, full island visible).
 */
export function buildFocusMask(
  fc: PlanningAreaCollection,
  focus: ReadonlySet<string>,
): FeatureCollection {
  if (focus.size === 0) return { type: 'FeatureCollection', features: [] };
  const holes: Position[][] = [];
  for (const f of fc.features) {
    if (!focus.has(f.properties.name)) continue;
    const g = f.geometry;
    if (g.type === 'Polygon') {
      holes.push(g.coordinates[0]);
    } else {
      for (const poly of g.coordinates) holes.push(poly[0]);
    }
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [SG_BBOX_RING, ...holes] },
      },
    ],
  };
}

export function planningAreaCenter(
  fc: PlanningAreaCollection,
  name: string,
): [number, number] | null {
  const f = fc.features.find((x) => x.properties.name === name);
  return f ? f.properties.center : null;
}
