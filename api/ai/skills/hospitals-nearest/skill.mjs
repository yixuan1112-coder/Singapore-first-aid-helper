// hospitals-nearest — reads AIKO_INPUT-style inputs (lng, lat, limit) and ranks
// the nearest A&E hospitals from the bundled SG hospital geojson. Cache-only.
// Returns the canonical { status, summary, metadata } shape. `metadata.marks`
// are map directives Bekal can surface (best-fit hospital pins).

import { hospitals, nearestFeatures } from '../../_data.mjs';

export async function run(inputs = {}, context = {}) {
  const lng = Number(inputs.lng ?? context.location?.lng);
  const lat = Number(inputs.lat ?? context.location?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { status: 'error', error: 'lng and lat are required and must be numeric', retryable: false, hint: 'pass the SOS or user location coordinates' };
  }
  const limit = Math.min(Math.max(parseInt(inputs.limit ?? 3, 10) || 3, 1), 5);
  const fc = await hospitals();
  const near = nearestFeatures(fc, { lng, lat }, limit);
  if (near.length === 0) {
    return { status: 'error', error: 'no hospitals in dataset', retryable: false, hint: 'bundled hospital geojson is empty' };
  }
  const list = near.map((h) => ({ name: h.name, km: +h.km.toFixed(2), lng: h.lng, lat: h.lat }));
  return {
    status: 'ok',
    summary: list.map((h) => `${h.name} · ${h.km} km`).join('; '),
    metadata: {
      hospitals: list,
      marks: list.map((h, i) => ({ kind: 'hospital', label: h.name, lng: h.lng, lat: h.lat, km: h.km, best: i === 0 })),
    },
  };
}
