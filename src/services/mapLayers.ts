// Client for /api/live/map-layers. The backend returns every live Singapore
// feed normalized to the same GeoJSON-layer shape (see api/live/map-layers.js).
// A feed that fails arrives as state:'down'/'not_configured' with an empty
// collection — the map shows nothing for it, never a fake/demo point.

import type { FeatureCollection } from 'geojson';

export type LayerState = 'fresh' | 'down' | 'not_configured';
export type LayerCategory = 'air' | 'weather' | 'traffic' | 'health' | 'hazard';

export interface LiveLayer {
  id: string;
  label: string;
  category: LayerCategory;
  source: string;
  attribution: string;
  state: LayerState;
  fetchedAt: number;
  count: number;
  geojson: FeatureCollection;
  error?: string;
}

export interface LiveLayers {
  fetchedAt: number;
  cached: boolean;
  layers: LiveLayer[];
}

export async function fetchMapLayers(): Promise<LiveLayers | null> {
  try {
    const res = await fetch('/api/live/map-layers', { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as LiveLayers;
  } catch {
    return null;
  }
}
