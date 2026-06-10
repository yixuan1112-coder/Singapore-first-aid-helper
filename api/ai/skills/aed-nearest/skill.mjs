// aed-nearest — ranks the nearest public AEDs (with opening hours) from the
// bundled SG AED geojson. Cache-only. Returns map directives in metadata.marks.

import { aeds, nearestFeatures } from '../../_data.mjs';

export async function run(inputs = {}, context = {}) {
  const lng = Number(inputs.lng ?? context.location?.lng);
  const lat = Number(inputs.lat ?? context.location?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { status: 'error', error: 'lng and lat are required and must be numeric', retryable: false, hint: 'pass the SOS or user location coordinates' };
  }
  const limit = Math.min(Math.max(parseInt(inputs.limit ?? 3, 10) || 3, 1), 5);
  const fc = await aeds();
  const near = nearestFeatures(fc, { lng, lat }, limit);
  if (near.length === 0) {
    return { status: 'error', error: 'no AEDs in dataset', retryable: false, hint: 'bundled AED geojson is empty' };
  }
  const list = near.map((a) => ({ name: a.name, km: +a.km.toFixed(2), lng: a.lng, lat: a.lat, hours: a.props.hours ?? null }));
  return {
    status: 'ok',
    summary: list.map((a) => `${a.name} · ${a.km} km${a.hours ? ` · ${a.hours}` : ''}`).join('; '),
    metadata: {
      aeds: list,
      marks: list.map((a, i) => ({ kind: 'aed', label: a.name, lng: a.lng, lat: a.lat, km: a.km, best: i === 0 })),
    },
  };
}
