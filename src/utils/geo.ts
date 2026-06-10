import type { LngLat } from '../AppContext';

export const SG_CENTER: LngLat = { lng: 103.8198, lat: 1.3521 };

export function getDistanceKm(a: LngLat, b: LngLat) {
  const radiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

export function sortByDistance<T extends { location: LngLat }>(items: T[], origin: LngLat) {
  return items
    .map((item) => ({ item, distanceKm: getDistanceKm(origin, item.location) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function filterWithinKm<T extends { location: LngLat }>(
  items: T[],
  origin: LngLat,
  radiusKm: number
) {
  return sortByDistance(items, origin).filter((entry) => entry.distanceKm <= radiusKm);
}

export function polygonCenter(points: LngLat[]) {
  if (points.length === 0) return SG_CENTER;
  return {
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
  };
}

export function radialPolygon(center: LngLat, radiusKm: number, sides = 8) {
  return Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * 2 * Math.PI;
    const dLat = (radiusKm / 111) * Math.cos(angle);
    const dLng = (radiusKm / (111 * Math.cos(toRad(center.lat)))) * Math.sin(angle);
    return { lat: center.lat + dLat, lng: center.lng + dLng };
  });
}

export function etaMinutes(distanceKm: number, speedKmh = 24) {
  return Math.max(1, Math.ceil((distanceKm / speedKmh) * 60));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}
