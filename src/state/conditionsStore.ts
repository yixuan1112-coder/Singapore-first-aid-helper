// The latest live-conditions snapshot, kept warm by MapCanvas's 60s poll. The
// agents read it OFF this cache (passed in their request context) instead of
// triggering their own fetch — the data is already refreshed on a timer, so a
// per-question fetch is wasted work. A fresh fetch only happens if the user
// explicitly asks for new data (conditions-read `fresh` input).

import type { LiveLayers } from '../services/mapLayers';

let _snap: LiveLayers | null = null;

function numericStats(values: number[]) {
  if (!values.length) return null;
  return {
    min: +Math.min(...values).toFixed(1),
    max: +Math.max(...values).toFixed(1),
    avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1),
  };
}

function featureLabel(feature: any): string | null {
  const p = feature?.properties ?? {};
  if (p.message) return String(p.message).slice(0, 160);
  if (p.forecast && p.area) return `${p.area}: ${p.forecast}`.slice(0, 160);
  if (p.station && p.value != null) return `${p.station}: ${p.value}${p.unit ?? ''}`.slice(0, 160);
  if (p.region && p.value != null) return `${p.region}: ${p.value}${p.unit ?? ''}`.slice(0, 160);
  if (p.type) return String(p.type).slice(0, 160);
  return null;
}

export const conditionsStore = {
  set(s: LiveLayers | null): void { _snap = s; },
  get(): LiveLayers | null { return _snap; },
  // Compact copy for AI context. Do not send full GeoJSON here: taxi/camera
  // layers can be thousands of points and will blow up the chat request body.
  getAgentSnapshot(): Record<string, unknown> | null {
    if (!_snap) return null;
    return {
      fetchedAt: _snap.fetchedAt,
      cached: _snap.cached,
      layers: _snap.layers.map((layer) => {
        const features = (layer.geojson?.features ?? []) as any[];
        const values = features
          .map((f) => Number(f?.properties?.value))
          .filter(Number.isFinite);
        const samples = features.map(featureLabel).filter(Boolean).slice(0, 5);
        return {
          id: layer.id,
          label: layer.label,
          category: layer.category,
          state: layer.state,
          count: layer.count,
          stats: numericStats(values),
          activeCount: values.filter((v) => v > 0).length,
          samples,
          error: layer.error,
        };
      }),
    };
  },
};
