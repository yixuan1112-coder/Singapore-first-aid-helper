// Live data adapters: real public APIs only.
// Calls are quota-guarded because Host/AI tooling must never burn provider quotas by looping.

import { ProviderRateLimitError, guardProviderCall } from './providerQuota';

export interface PsiReading {
  region: 'national' | 'north' | 'south' | 'east' | 'west' | 'central';
  lng: number;
  lat: number;
  psi24h: number | null;
}

export interface RainfallReading {
  stationId: string;
  name: string;
  lng: number;
  lat: number;
  mm: number;
}

export interface ForecastArea {
  area: string;
  lng: number;
  lat: number;
  forecast: string;
}

const REGION_COORDS: Record<string, { lng: number; lat: number }> = {
  national: { lng: 103.85, lat: 1.36 },
  north: { lng: 103.82, lat: 1.41 },
  south: { lng: 103.83, lat: 1.295 },
  east: { lng: 103.94, lat: 1.35 },
  west: { lng: 103.7, lat: 1.35 },
  central: { lng: 103.82, lat: 1.35 },
};

export async function fetchPsi(): Promise<PsiReading[]> {
  try {
    guardProviderCall('datagov', 'NEA PSI overlay');
    const r = await fetch('https://api.data.gov.sg/v1/environment/psi');
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const item = j.items?.[0];
    if (!item) return [];
    const readings = item.readings?.psi_twenty_four_hourly ?? {};
    const out: PsiReading[] = [];
    for (const region of Object.keys(readings)) {
      const c = REGION_COORDS[region];
      if (!c) continue;
      out.push({
        region: region as PsiReading['region'],
        lng: c.lng,
        lat: c.lat,
        psi24h: readings[region],
      });
    }
    return out;
  } catch (e) {
    logLiveFailure('fetchPsi', e);
    return [];
  }
}

export async function fetchRainfall(): Promise<RainfallReading[]> {
  try {
    guardProviderCall('datagov', 'NEA rainfall overlay');
    const r = await fetch('https://api.data.gov.sg/v1/environment/rainfall');
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const stations: Array<{ id: string; name: string; location: { longitude: number; latitude: number } }> =
      j.metadata?.stations ?? [];
    const readings = j.items?.[0]?.readings ?? [];
    const byStation = new Map<string, number>();
    for (const rd of readings) byStation.set(rd.station_id, rd.value);
    return stations.slice(0, 80).map((s) => ({
      stationId: s.id,
      name: s.name,
      lng: s.location.longitude,
      lat: s.location.latitude,
      mm: byStation.get(s.id) ?? 0,
    }));
  } catch (e) {
    logLiveFailure('fetchRainfall', e);
    return [];
  }
}

export async function fetch2hForecast(): Promise<ForecastArea[]> {
  try {
    guardProviderCall('datagov', 'NEA 2-hour forecast overlay');
    const r = await fetch('https://api.data.gov.sg/v1/environment/2-hour-weather-forecast');
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const areas: Array<{ name: string; label_location: { longitude: number; latitude: number } }> =
      j.area_metadata ?? [];
    const fc: Array<{ area: string; forecast: string }> = j.items?.[0]?.forecasts ?? [];
    const byArea = new Map<string, string>();
    for (const f of fc) byArea.set(f.area, f.forecast);
    return areas.map((a) => ({
      area: a.name,
      lng: a.label_location.longitude,
      lat: a.label_location.latitude,
      forecast: byArea.get(a.name) ?? 'No data',
    }));
  } catch (e) {
    logLiveFailure('fetch2hForecast', e);
    return [];
  }
}

export interface LiveSnapshot {
  psi: PsiReading[];
  rainfall: RainfallReading[];
  forecast: ForecastArea[];
  fetchedAt: number;
}

export async function fetchLiveSnapshot(): Promise<LiveSnapshot> {
  const [psi, rainfall, forecast] = await Promise.all([
    fetchPsi(),
    fetchRainfall(),
    fetch2hForecast(),
  ]);
  return { psi, rainfall, forecast, fetchedAt: Date.now() };
}

function logLiveFailure(scope: string, error: unknown) {
  if (error instanceof ProviderRateLimitError) {
    console.warn(scope, error.userMessage);
    return;
  }
  console.warn(scope + ' failed', error);
}
