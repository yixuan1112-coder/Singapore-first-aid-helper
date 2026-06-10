// area-locate — resolve a GPS coordinate to the REAL Singapore planning area by
// point-in-polygon against the BUNDLED planning-areas geojson. Cache-only, no API.
// This is the truth source that stops agents inventing area names from coordinates.

import { locateArea } from '../../_data.mjs';

export async function run(inputs = {}, context = {}) {
  const lng = Number(inputs.lng ?? context.location?.lng);
  const lat = Number(inputs.lat ?? context.location?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return {
      status: 'error',
      error: 'no location available',
      retryable: false,
      hint: 'No GPS or profile location. Ask the user to set their profile location for area-specific answers.',
    };
  }
  const area = await locateArea({ lng, lat });
  if (!area || !area.name) {
    return {
      status: 'ok',
      summary: 'Location is outside Singapore’s mapped planning areas.',
      metadata: { area: null, region: null, lng, lat },
    };
  }
  return {
    status: 'ok',
    summary: `${area.name}${area.region ? `, ${area.region}` : ''}`,
    metadata: { area: area.name, region: area.region, lng, lat },
  };
}
