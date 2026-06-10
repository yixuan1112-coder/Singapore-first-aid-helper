import type { LngLat } from '../AppContext';

export interface RevgeocodeResult {
  state: 'live' | 'not_configured' | 'unavailable' | 'out_of_bounds';
  placeName: string | null;
  lat: number;
  lng: number;
}

export async function reverseGeocode(loc: LngLat): Promise<RevgeocodeResult> {
  try {
    const res = await fetch(`/api/live/revgeocode?lat=${loc.lat}&lng=${loc.lng}`);
    if (!res.ok) {
      return { state: 'unavailable', placeName: null, lat: loc.lat, lng: loc.lng };
    }
    return (await res.json()) as RevgeocodeResult;
  } catch {
    return { state: 'unavailable', placeName: null, lat: loc.lat, lng: loc.lng };
  }
}
