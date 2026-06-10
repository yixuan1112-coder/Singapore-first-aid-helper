// The map. Baseline of the rebuild: OneMap basemap + live public-data
// indicators only (NEA / LTA / OneMap / dengue from /api/live/map-layers,
// plus bundled hospitals + AEDs). Identical for every role. No operational
// overlays yet — those get added back one feature at a time.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Hospital, Zap, Camera, TriangleAlert, Wind, Droplets, Thermometer,
  Gauge, CloudSun, Car, Bug, SlidersHorizontal, X, RefreshCw,
} from 'lucide-react';
import { fetchMapLayers, type LiveLayer, type LiveLayers, type LayerCategory } from '../../services/mapLayers';
import { useAppContext } from '../../AppContext';
import { getDistanceKm } from '../../utils/geo';
import { mapPick, type PickPoint } from '../../state/mapPick';
import { bekalDirectives } from '../../state/bekalDirectives';
import { conditionsStore } from '../../state/conditionsStore';

// Declared incidents/notices and SOS cases must SHOW what they are on the map —
// "declare fire" must render a fire glyph, not a nameless dot. Kind = canonical
// event kind; category = SOS category.
const KIND_GLYPH: Record<string, string> = { fire: '🔥', flood: '🌊', medical: '➕', crash: '💥', hazard: '⚠️', weather: '🌧️', other: '📍' };
const KIND_COLOR: Record<string, string> = { fire: '#DC2626', flood: '#2563EB', medical: '#DC2626', crash: '#F59E0B', hazard: '#F59E0B', weather: '#0EA5E9', other: '#64748B' };
const CAT_GLYPH: Record<string, string> = { medical: '➕', fire: '🔥', trapped: '🆘', threat: '🛡️', hazard: '⚠️', other: '🆘' };

const ONEMAP_GREY = 'https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png';
const SG_CENTER: [number, number] = [103.8198, 1.3521];
const DEMO_LOCATION = (() => {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  if (!q.get('demoSession')) return null;
  const lng = Number(q.get('demoLng'));
  const lat = Number(q.get('demoLat'));
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
})();

type DemoMapWindow = Window & {
  __kkMapDemo?: {
    focusLocation: (near: { lng: number; lat: number }, zoom?: number) => void;
    showLayerSample: (
      layerId: string,
      near?: { lng: number; lat: number },
      zoomOverride?: number,
    ) => { x: number; y: number; label: string; distanceKm: number } | null;
    responderMarkerCount: () => number;
    clearEvidence: () => void;
    /** Demo automation: resolve an active map-pick at a fixed point (ops Declare). */
    placeMapPick: (at: { lng: number; lat: number }) => void;
  };
};

// ── indicator styling ──────────────────────────────────────────────────────
// render: icon → symbol glyph; circle → coloured dot (+ value label);
// heatmap → dense point cloud; fill → polygon.
type LiveRender = 'icon' | 'circle' | 'heatmap' | 'fill';
interface LiveSpec {
  category: LayerCategory;
  render: LiveRender;
  color: string;
  icon?: string;
  radius?: number;
  circleOpacity?: number;
  label?: maplibregl.ExpressionSpecification;
  defaultOn: boolean;
  legend: string;
}

// Each reading shown as readable text ("31 °C", "84 PSI") so a dot is never
// nameless; forecast points show the forecast word.
const VAL_LABEL = ['concat', ['to-string', ['get', 'value']], ['case', ['has', 'unit'], ['concat', ' ', ['get', 'unit']], '']] as unknown as maplibregl.ExpressionSpecification;
const FC_LABEL = ['coalesce', ['get', 'forecast'], ''] as unknown as maplibregl.ExpressionSpecification;

const LIVE_SPECS: Record<string, LiveSpec> = {
  hospitals:  { category: 'health',  render: 'icon',    color: '#DC2626', icon: 'kk-hospital', defaultOn: true,  legend: 'Hospital' },
  aeds:       { category: 'health',  render: 'icon',    color: '#16A34A', icon: 'kk-aed',      defaultOn: false, legend: 'AED' },
  dengue:     { category: 'hazard',  render: 'fill',    color: '#F97316', defaultOn: false, legend: 'Dengue cluster' },
  incidents:  { category: 'traffic', render: 'icon',    color: '#F59E0B', icon: 'kk-incident', defaultOn: true,  legend: 'Traffic incident' },
  cameras:    { category: 'traffic', render: 'icon',    color: '#2563EB', icon: 'kk-camera',   defaultOn: false, legend: 'Traffic camera' },
  taxi:       { category: 'traffic', render: 'heatmap', color: '#10B981', defaultOn: false, legend: 'Available taxis' },
  psi:        { category: 'air',     render: 'circle',  color: '#A855F7', radius: 28, circleOpacity: 0.26, label: VAL_LABEL, defaultOn: false, legend: 'PSI (region)' },
  pm25:       { category: 'air',     render: 'circle',  color: '#7C3AED', radius: 24, circleOpacity: 0.26, label: VAL_LABEL, defaultOn: false, legend: 'PM2.5 (region)' },
  rainfall:   { category: 'weather', render: 'circle',  color: '#3B82F6', radius: 7, label: VAL_LABEL, defaultOn: false, legend: 'Rainfall' },
  air_temp:   { category: 'weather', render: 'circle',  color: '#F97316', radius: 7, label: VAL_LABEL, defaultOn: true,  legend: 'Air temp' },
  humidity:   { category: 'weather', render: 'circle',  color: '#06B6D4', radius: 7, label: VAL_LABEL, defaultOn: false, legend: 'Humidity' },
  wind:       { category: 'weather', render: 'circle',  color: '#64748B', radius: 7, label: VAL_LABEL, defaultOn: false, legend: 'Wind' },
  forecast2h: { category: 'weather', render: 'circle',  color: '#0EA5E9', radius: 7, label: FC_LABEL, defaultOn: false, legend: '2h forecast' },
};

const STATIC_LAYERS: Record<string, string> = {
  hospitals: '/data/sg-hospitals.geojson',
  aeds: '/data/sg-aeds.geojson',
};

const CATEGORY_LABEL: Record<LayerCategory, string> = {
  health: 'Care & rescue', hazard: 'Hazards', traffic: 'Traffic', air: 'Air quality', weather: 'Weather',
};
const CATEGORY_ICON: Record<LayerCategory, typeof Hospital> = {
  health: Hospital, hazard: Bug, traffic: Car, air: Gauge, weather: CloudSun,
};
const LEGEND_ICON: Record<string, typeof Hospital> = {
  hospitals: Hospital, aeds: Zap, cameras: Camera, incidents: TriangleAlert, taxi: Car,
  dengue: Bug, psi: Gauge, pm25: Gauge, rainfall: Droplets, air_temp: Thermometer,
  humidity: Droplets, wind: Wind, forecast2h: CloudSun,
};

// Icon glyphs rasterized into the map (proper symbols, not words).
const ICON_SVGS: Record<string, string> = {
  'kk-hospital':
    '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="17" fill="#DC2626" stroke="#fff" stroke-width="3.5"/><path d="M22 12v20M12 22h20" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/></svg>',
  'kk-aed':
    '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="17" fill="#16A34A" stroke="#fff" stroke-width="3.5"/><path d="M24 10l-10 15h7l-3 9 11-16h-7z" fill="#fff"/></svg>',
  'kk-camera':
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#2563EB" stroke="#fff" stroke-width="3"/><rect x="11" y="15" width="18" height="12" rx="2.5" fill="#fff"/><circle cx="20" cy="21" r="3.6" fill="#2563EB"/></svg>',
  'kk-incident':
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M20 6l16 27H4z" fill="#F59E0B" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 16v8" stroke="#1A1A1A" stroke-width="4" stroke-linecap="round"/><circle cx="20" cy="29" r="2.2" fill="#1A1A1A"/></svg>',
};

function rasterize(svg: string, size: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('no 2d ctx')); return; }
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, size, size));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('icon load failed')); };
    img.src = url;
  });
}

function escapeHtml(v: string) {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c] as string));
}

function collectLngLats(coords: unknown, out: [number, number][] = []): [number, number][] {
  if (!Array.isArray(coords)) return out;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    out.push([Number(coords[0]), Number(coords[1])]);
    return out;
  }
  for (const child of coords) collectLngLats(child, out);
  return out;
}

function featureCenter(feature: GeoJSON.Feature): [number, number] | null {
  const geometry = feature.geometry as ({ coordinates?: unknown } | null);
  const coords = collectLngLats(geometry?.coordinates);
  if (coords.length === 0) return null;
  const lngs = coords.map(([lng]) => lng);
  const lats = coords.map(([, lat]) => lat);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

function nearestFeature(fc: GeoJSON.FeatureCollection | undefined, near: { lng: number; lat: number }): GeoJSON.Feature | null {
  let best: { feature: GeoJSON.Feature; km: number } | null = null;
  for (const feature of fc?.features ?? []) {
    const at = featureCenter(feature);
    if (!at) continue;
    const km = getDistanceKm({ lng: at[0], lat: at[1] }, near);
    if (!best || km < best.km) best = { feature, km };
  }
  return best?.feature ?? null;
}

function staticPopup(id: string, props: Record<string, unknown>): string {
  const title = (props.name as string) || (id === 'hospitals' ? 'Hospital' : 'AED');
  const sub = id === 'hospitals' ? 'Hospital · A&E' : `Public AED${props.hours ? ' · ' + props.hours : ''}`;
  return `<div style="font-family:ui-sans-serif;max-width:220px"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(String(title))}</strong><div style="font-size:10px;margin-top:3px;color:#64748b">${escapeHtml(sub)}</div></div>`;
}

// A geodesic-ish circle polygon (good enough at SG scale) for the SOS radius ring.
function circlePolygon(lng: number, lat: number, radiusKm: number, points = 64): GeoJSON.Feature {
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

function livePopup(layer: LiveLayer, props: Record<string, unknown>): string {
  const rows: string[] = [];
  const add = (k: string, v: unknown) => { if (v != null && v !== '') rows.push(`${k}: ${String(v)}`); };
  if (props.value != null) add('Reading', `${props.value}${props.unit ? ' ' + props.unit : ''}`);
  add('Station', props.station);
  add('Region', props.region);
  add('Area', props.area);
  add('Forecast', props.forecast);
  add('Band', props.band);
  add('Type', props.type);
  if (props.message) rows.push(String(props.message));
  const title = (props.name as string) || (props.station as string) || (props.region as string) || layer.label;
  const img = props.image ? `<img src="${escapeHtml(String(props.image))}" style="margin-top:6px;width:100%;border-radius:4px" />` : '';
  return `<div style="font-family:ui-sans-serif;max-width:240px"><strong style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(String(title))}</strong><span style="display:block;font-size:10px;margin-top:3px;color:#64748b">${escapeHtml(layer.label)} · ${escapeHtml(layer.source)}</span>${rows.length ? `<div style="font-size:10px;margin-top:5px;line-height:1.5;color:#1e293b">${rows.map(escapeHtml).join('<br/>')}</div>` : ''}${img}</div>`;
}

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const wiredLive = useRef<Set<string>>(new Set());
  const sosMarkers = useRef<maplibregl.Marker[]>([]);
  const memberMarkers = useRef<maplibregl.Marker[]>([]);
  const noticeMarkers = useRef<maplibregl.Marker[]>([]);
  const bekalMarkers = useRef<maplibregl.Marker[]>([]);
  const selfMarker = useRef<maplibregl.Marker | null>(null);
  const demoPopupRef = useRef<maplibregl.Popup | null>(null);
  const demoSourceRef = useRef<{ layerId: string; data: GeoJSON.FeatureCollection } | null>(null);

  // SOS overlay: civilian sees only their own, responder/ops see all active.
  const { role, selfResponderId, sosSessions, setViewSosId, setSelfLocation, selfLocation, caseMembers, joinedCaseIds, events } = useAppContext();
  // Keep the latest setter in a ref so the once-only map effect never goes stale.
  const setSelfLocationRef = useRef(setSelfLocation);
  setSelfLocationRef.current = setSelfLocation;

  const [mapReady, setMapReady] = useState(false);
  const [live, setLive] = useState<LiveLayers | null>(null);
  const [staticData, setStaticData] = useState<Record<string, GeoJSON.FeatureCollection>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const v: Record<string, boolean> = {};
    for (const [id, spec] of Object.entries(LIVE_SPECS)) v[id] = spec.defaultOn;
    return v;
  });

  // ── live feeds: auto-refresh every 60s, with a manual refresh + a visible
  //    countdown so stale data is never a mystery. Manual refresh resets the
  //    auto timer so the two never double-fire.
  const REFRESH_MS = 60_000;
  const [lastAt, setLastAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const pull = useCallback(async () => {
    setRefreshing(true);
    const l = await fetchMapLayers();
    if (!aliveRef.current) return;
    if (l) { setLive(l); conditionsStore.set(l); }
    setLastAt(Date.now());
    setRefreshing(false);
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => { await pull(); schedule(); }, REFRESH_MS);
  }, [pull]);

  useEffect(() => {
    aliveRef.current = true;
    pull().then(schedule);
    return () => { aliveRef.current = false; clearTimeout(timerRef.current); };
  }, [pull, schedule]);

  const refreshNow = useCallback(() => { void pull().then(schedule); }, [pull, schedule]);

  // 1s ticker drives the "next refresh in Ns" countdown.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNowTs(Date.now()), 1000); return () => clearInterval(i); }, []);
  const nextInSec = lastAt ? Math.max(0, Math.ceil((REFRESH_MS - (nowTs - lastAt)) / 1000)) : 0;

  // bundled hospitals + AEDs (no API/token)
  useEffect(() => {
    let alive = true;
    Object.entries(STATIC_LAYERS).forEach(([id, url]) => {
      fetch(url).then((r) => (r.ok ? r.json() : null)).then((fc) => { if (alive && fc) setStaticData((p) => ({ ...p, [id]: fc })); }).catch(() => {});
    });
    return () => { alive = false; };
  }, []);

  // ── mount map ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: { onemap: { type: 'raster', tiles: [ONEMAP_GREY], tileSize: 256, attribution: '© <a href="https://www.onemap.gov.sg">OneMap</a> · data.gov.sg (NEA), LTA DataMall' } },
        layers: [{ id: 'onemap', type: 'raster', source: 'onemap' }],
      },
      center: SG_CENTER, zoom: 11.2, minZoom: 10, maxZoom: 18,
      maxBounds: [[103.55, 1.13], [104.15, 1.5]],
      attributionControl: false,
    });
    // Map controls live bottom-LEFT so the bottom-right corner stays clear for
    // role action surfaces (citizen "Report an issue", etc.) — no overlap.
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');

    // Self-location is tracked CONTINUOUSLY via our own watchPosition (below) so
    // SOS/roster/ETA always have a live fix and our blue dot follows you — but
    // the CAMERA never moves on its own. The GeolocateControl here is only a
    // "recenter on me" button: one-shot (trackUserLocation:false), so the map
    // only zooms when YOU press it. We render our own dot, so disable its.
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 },
      trackUserLocation: false,
      showUserLocation: false,
      showAccuracyCircle: false,
    });
    map.addControl(geolocate, 'bottom-left');

    // Continuous high-accuracy tracking, decoupled from the camera. Feeds
    // selfLocation from login onward without ever recentering the view.
    let watchId: number | undefined;
    let lastFix: { lng: number; lat: number } | null = null;
    if (DEMO_LOCATION) {
      lastFix = DEMO_LOCATION;
      setSelfLocationRef.current(DEMO_LOCATION);
    } else if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          const next = { lng: p.coords.longitude, lat: p.coords.latitude };
          // Ignore sub-~6m GPS jitter. Without this, a STATIONARY user still gets
          // a fix every ~2s → setSelfLocation → CSOT republish → version bump →
          // every panel/marker rebuilds. That was the "UI resets every few seconds".
          if (lastFix && getDistanceKm(next, lastFix) < 0.006) return;
          lastFix = next;
          setSelfLocationRef.current(next);
        },
        () => { /* permission denied / unavailable — dot just won't show */ },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
      );
    }

    map.on('load', async () => {
      await Promise.all(Object.entries(ICON_SVGS).map(async ([name, svg]) => {
        try { if (!map.hasImage(name)) map.addImage(name, await rasterize(svg, name === 'kk-hospital' || name === 'kk-aed' ? 44 : 40)); } catch { /* icon optional */ }
      }));

      const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

      for (const [id, spec] of Object.entries(LIVE_SPECS)) {
        const src = `live-${id}`;
        map.addSource(src, { type: 'geojson', data: empty });
        const vis = spec.defaultOn ? 'visible' : 'none';
        if (spec.render === 'fill') {
          map.addLayer({ id: `${id}-fill`, type: 'fill', source: src, layout: { visibility: vis }, paint: { 'fill-color': spec.color, 'fill-opacity': 0.25 } });
          map.addLayer({ id: `${id}-line`, type: 'line', source: src, layout: { visibility: vis }, paint: { 'line-color': spec.color, 'line-width': 1.5 } });
        } else if (spec.render === 'heatmap') {
          map.addLayer({ id: `${id}-heat`, type: 'heatmap', source: src, layout: { visibility: vis }, paint: { 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(16,185,129,0)', 1, spec.color], 'heatmap-radius': 14, 'heatmap-opacity': 0.7 } });
        } else if (spec.render === 'icon' && spec.icon) {
          map.addLayer({ id: `${id}-icon`, type: 'symbol', source: src, layout: { visibility: vis, 'icon-image': spec.icon, 'icon-size': 0.6, 'icon-allow-overlap': true } });
        } else {
          map.addLayer({ id: `${id}-pt`, type: 'circle', source: src, layout: { visibility: vis }, paint: { 'circle-radius': spec.radius ?? 6, 'circle-color': spec.color, 'circle-opacity': spec.circleOpacity ?? 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
        }
        if (spec.label) {
          map.addLayer({
            id: `${id}-label`, type: 'symbol', source: src, layout: {
              visibility: vis, 'text-field': spec.label, 'text-size': 11, 'text-font': ['Open Sans Regular'],
              'text-allow-overlap': false, 'text-offset': [0, spec.render === 'circle' && (spec.radius ?? 0) >= 20 ? 0 : 1.1],
            },
            paint: { 'text-color': '#0b1220', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.4 },
          });
        }
      }

      // SOS recommendation radius — the sphere within which nearby on-duty
      // responders are nudged to join. Rendered around each visible SOS.
      map.addSource('sos-radius', { type: 'geojson', data: empty });
      map.addLayer({ id: 'sos-radius-fill', type: 'fill', source: 'sos-radius', paint: { 'fill-color': '#DC2626', 'fill-opacity': 0.05 } });
      map.addLayer({ id: 'sos-radius-line', type: 'line', source: 'sos-radius', paint: { 'line-color': '#DC2626', 'line-opacity': 0.4, 'line-width': 1.5, 'line-dasharray': [2, 2] } });

      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      map.remove(); mapRef.current = null; setMapReady(false); wiredLive.current.clear();
    };
  }, []);

  // ── feed live geojson + wire popups ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !live) return;
    for (const layer of live.layers) {
      const spec = LIVE_SPECS[layer.id];
      if (!spec) continue;
      (map.getSource(`live-${layer.id}`) as GeoJSONSource | undefined)?.setData(layer.geojson);
      const renderId = spec.render === 'fill' ? `${layer.id}-fill` : spec.render === 'heatmap' ? `${layer.id}-heat` : spec.render === 'icon' ? `${layer.id}-icon` : `${layer.id}-pt`;
      if (spec.render !== 'heatmap' && !wiredLive.current.has(renderId) && map.getLayer(renderId)) {
        wiredLive.current.add(renderId);
        const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' });
        map.on('click', renderId, (e) => {
          const f = e.features?.[0]; if (!f) return;
          const at = f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : e.lngLat.toArray() as [number, number];
          popup.setLngLat(at).setHTML(livePopup(layer, (f.properties || {}) as Record<string, unknown>)).addTo(map);
        });
        map.on('mouseenter', renderId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', renderId, () => { map.getCanvas().style.cursor = ''; });
      }
    }
  }, [live, mapReady]);

  // bundled hospitals/AEDs → their sources + popups
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const [id, fc] of Object.entries(staticData) as [string, GeoJSON.FeatureCollection][]) {
      (map.getSource(`live-${id}`) as GeoJSONSource | undefined)?.setData(fc);
      const renderId = `${id}-icon`;
      if (!wiredLive.current.has(renderId) && map.getLayer(renderId)) {
        wiredLive.current.add(renderId);
        const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '240px' });
        map.on('click', renderId, (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== 'Point') return;
          const p = (f.properties || {}) as Record<string, unknown>;
          const title = (p.name as string) || (id === 'hospitals' ? 'Hospital' : 'AED');
          const sub = id === 'hospitals' ? 'Hospital · A&E' : `Public AED${p.hours ? ' · ' + p.hours : ''}`;
          popup.setLngLat(f.geometry.coordinates as [number, number])
            .setHTML(staticPopup(id, { ...p, name: title, hours: p.hours, sub }))
            .addTo(map);
        });
        map.on('mouseenter', renderId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', renderId, () => { map.getCanvas().style.cursor = ''; });
      }
    }
  }, [staticData, mapReady]);

  // Demo-only map evidence hook. Normal users never call this; the director uses
  // it to visibly open one real layer popup at a time, so public-data dots are
  // inspected instead of flashed as abstract labels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !DEMO_LOCATION) return;
    const win = window as DemoMapWindow;
    const restoreDemoSource = () => {
      const active = demoSourceRef.current;
      if (!active) return;
      (map.getSource(`live-${active.layerId}`) as GeoJSONSource | undefined)?.setData(active.data);
      demoSourceRef.current = null;
    };
    const api = {
      focusLocation: (near: { lng: number; lat: number }, zoom = 15.3) => {
        restoreDemoSource();
        setVisible(Object.fromEntries(Object.keys(LIVE_SPECS).map((id) => [id, false])));
        demoPopupRef.current?.remove();
        demoPopupRef.current = null;
        map.jumpTo({ center: [near.lng, near.lat], zoom });
      },
      showLayerSample: (layerId: string, near = DEMO_LOCATION, zoomOverride?: number) => {
        const layer = live?.layers.find((item) => item.id === layerId);
        const fc = layer?.geojson ?? staticData[layerId];
        if (!fc) return null;
        const feature = nearestFeature(fc, near);
        const at = feature ? featureCenter(feature) : null;
        if (!feature || !at) return null;
        restoreDemoSource();
        // Evidence mode isolates the nearest item instead of leaving an entire
        // island-wide layer behind the popup. The full source is restored when
        // the director closes this result.
        (map.getSource(`live-${layerId}`) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: [feature],
        });
        demoSourceRef.current = { layerId, data: fc };
        const distanceKm = getDistanceKm({ lng: at[0], lat: at[1] }, near);
        setVisible(Object.fromEntries(Object.keys(LIVE_SPECS).map((id) => [id, id === layerId])));
        const zoom: Record<string, number> = {
          hospitals: 14.8,
          aeds: 15.2,
          cameras: 15,
          incidents: 14.8,
          taxi: 14.8,
          rainfall: 14.5,
          forecast2h: 14.2,
          psi: 11.8,
        };
        const targetZoom = zoomOverride ?? zoom[layerId] ?? 15;
        if (distanceKm < 0.35) {
          map.jumpTo({ center: [near.lng, near.lat], zoom: targetZoom });
        } else {
          map.fitBounds(
            [
              [Math.min(near.lng, at[0]), Math.min(near.lat, at[1])],
              [Math.max(near.lng, at[0]), Math.max(near.lat, at[1])],
            ],
            { padding: 110, maxZoom: targetZoom, duration: 0 },
          );
        }
        demoPopupRef.current?.remove();
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const html = layer ? livePopup(layer, props) : staticPopup(layerId, props);
        demoPopupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(at)
          .setHTML(html)
          .addTo(map);
        const point = map.project(at);
        const name = (props.name as string) || (props.station as string) || (props.region as string) || layer?.label || LIVE_SPECS[layerId]?.legend || layerId;
        const label = `${String(name)} · ${distanceKm < 0.1 ? '<0.1' : distanceKm.toFixed(1)} km from SOS`;
        return { x: point.x, y: point.y, label, distanceKm };
      },
      responderMarkerCount: () => memberMarkers.current.length,
      clearEvidence: () => {
        demoPopupRef.current?.remove();
        demoPopupRef.current = null;
        restoreDemoSource();
      },
      placeMapPick: (at: PickPoint) => {
        if (!mapPick.isRequesting()) mapPick.request();
        mapPick.resolve(at);
      },
    };
    win.__kkMapDemo = api;
    return () => {
      if (win.__kkMapDemo === api) delete win.__kkMapDemo;
      demoPopupRef.current?.remove();
      demoPopupRef.current = null;
      restoreDemoSource();
    };
  }, [live, staticData, mapReady]);

  // ── visibility toggles ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const id of Object.keys(LIVE_SPECS)) {
      const vis = visible[id] ? 'visible' : 'none';
      for (const suffix of ['-icon', '-pt', '-heat', '-fill', '-line', '-label']) {
        if (map.getLayer(`${id}${suffix}`)) map.setLayoutProperty(`${id}${suffix}`, 'visibility', vis);
      }
    }
  }, [visible, mapReady]);

  // ── SOS markers (clean pulsing red dot; tap → detail sheet) ─────────────
  // Gate on a signature so the markers rebuild ONLY when the SOS set / its
  // positions / statuses actually change — NOT on every unrelated CSOT version
  // bump (which would make every pin flash a few times a second).
  const visibleSos = sosSessions.filter(
    (s) => !['resolved', 'cancelled'].includes(s.status) &&
      (role !== 'citizen' || s.ownerId === selfResponderId),
  );
  const sosSig = visibleSos.map((s) => `${s.id}:${s.location.lng.toFixed(4)},${s.location.lat.toFixed(4)}:${s.status}`).join('|');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of sosMarkers.current) m.remove();
    sosMarkers.current = [];
    for (const s of visibleSos) {
      const el = document.createElement('button');
      el.className = 'kk-sos-marker';
      el.title = `SOS · ${s.category}`;
      const glyph = CAT_GLYPH[s.category] ?? '🆘';
      el.innerHTML =
        '<span style="position:absolute;inset:0;border-radius:9999px;background:#DC2626;opacity:.35;animation:kkpulse 1.6s ease-out infinite"></span>' +
        `<span style="position:relative;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:#DC2626;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);font-size:11px;line-height:1">${glyph}</span>`;
      el.style.cssText = 'position:relative;width:20px;height:20px;cursor:pointer;background:none;border:none;padding:0';
      el.onclick = (ev) => { ev.stopPropagation(); setViewSosId(s.id); };
      sosMarkers.current.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([s.location.lng, s.location.lat]).addTo(map));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sosSig, mapReady]);

  // Cases this client participates in: the citizen's own SOS, or a responder's
  // joined cases. Only these clients receive the private member locations.
  const participantCaseIds = role === 'citizen'
    ? sosSessions.filter((s) => s.ownerId === selfResponderId && !['resolved', 'cancelled'].includes(s.status)).map((s) => s.id)
    : role === 'responder' ? [...joinedCaseIds] : [];

  // Live responder dots approaching (GrabFood-style), nearest 5 per case.
  const memberDots = participantCaseIds.flatMap((cid) => {
    const sos = sosSessions.find((s) => s.id === cid);
    if (!sos) return [] as { id: string; name: string; status: string; lng: number; lat: number; km: number }[];
    return caseMembers(cid)
      .map((m) => ({ id: m.id, name: m.name, status: m.status, lng: m.location.lng, lat: m.location.lat, km: getDistanceKm(m.location, sos.location) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
  });
  const memberSig = memberDots.map((d) => `${d.id}:${d.lng.toFixed(4)},${d.lat.toFixed(4)}:${d.status}`).join('|');

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of memberMarkers.current) m.remove();
    memberMarkers.current = [];
    for (const d of memberDots) {
      const arrived = d.status === 'arrived';
      const color = arrived ? '#16A34A' : '#2563EB';
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none';
      el.innerHTML =
        `<span style="font-size:10px;font-weight:700;color:#0b1220;background:rgba(255,255,255,.92);border-radius:4px;padding:0 4px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2)">${escapeHtml(d.name)}</span>` +
        `<span style="margin-top:2px;display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>`;
      memberMarkers.current.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([d.lng, d.lat]).addTo(map));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberSig, mapReady]);

  // SOS recommendation radius (2km) around every SOS this client can see.
  const radiusSos = (role === 'citizen'
    ? sosSessions.filter((s) => s.ownerId === selfResponderId)
    : sosSessions
  ).filter((s) => !['resolved', 'cancelled'].includes(s.status));
  const radiusSig = radiusSos.map((s) => `${s.id}:${s.location.lng.toFixed(4)},${s.location.lat.toFixed(4)}`).join('|');

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('sos-radius') as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({ type: 'FeatureCollection', features: radiusSos.map((s) => circlePolygon(s.location.lng, s.location.lat, 2)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusSig, mapReady]);

  // Our own live self-dot — appears the moment a fix arrives and follows you,
  // WITHOUT ever moving the camera (that only happens on the recenter button).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selfLocation) return;
    if (!selfMarker.current) {
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:16px;height:16px;pointer-events:none';
      el.innerHTML =
        '<span style="position:absolute;inset:-6px;border-radius:9999px;background:#2563EB;opacity:.18;animation:kkpulse 2s ease-out infinite"></span>' +
        '<span style="position:relative;display:block;width:16px;height:16px;border-radius:9999px;background:#2563EB;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></span>';
      selfMarker.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([selfLocation.lng, selfLocation.lat]).addTo(map);
    } else {
      selfMarker.current.setLngLat([selfLocation.lng, selfLocation.lat]);
    }
  }, [selfLocation, mapReady]);

  // Ops-declared notices (and any other canonical incident from CSOT) pinned as
  // labelled markers so awareness items show "in that area" beyond the API feeds.
  // Live NEA-derived overlays (LIVE-* ids) already have their own layers — skip.
  const declaredEvents = events.filter((e) => e.status !== 'resolved' && !e.id.startsWith('LIVE-'));
  const declaredSig = declaredEvents.map((e) => `${e.id}:${e.location.lng.toFixed(4)},${e.location.lat.toFixed(4)}:${e.severity}:${e.kind}`).join('|');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of noticeMarkers.current) m.remove();
    noticeMarkers.current = [];
    for (const e of declaredEvents) {
      const glyph = KIND_GLYPH[e.kind] ?? '📍';
      const color = KIND_COLOR[e.kind] ?? (e.severity >= 4 ? '#DC2626' : e.severity >= 3 ? '#F59E0B' : '#64748B');
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none';
      el.innerHTML =
        `<span style="font-size:10px;font-weight:700;color:#0b1220;background:rgba(255,255,255,.94);border-radius:4px;padding:1px 5px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2)">${escapeHtml(e.title)}</span>` +
        `<span style="margin-top:2px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);font-size:13px;line-height:1">${glyph}</span>`;
      noticeMarkers.current.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([e.location.lng, e.location.lat]).addTo(map));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declaredSig, mapReady]);

  // Bekal's map directives — best-fit hospitals / AEDs / hazards the SOS agent
  // surfaced. Rendered as labelled pins (★ on the best pick) from the external
  // store so an AI reply never has to round-trip through the provider.
  const bekalSig = useSyncExternalStore(bekalDirectives.subscribe, bekalDirectives.snapshot, bekalDirectives.snapshot);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of bekalMarkers.current) m.remove();
    bekalMarkers.current = [];
    for (const mk of bekalDirectives.get()) {
      const isHosp = mk.kind === 'hospital';
      const color = isHosp ? '#DC2626' : mk.kind === 'aed' ? '#16A34A' : '#F59E0B';
      const glyph = isHosp ? '➕' : mk.kind === 'aed' ? '⚡' : '⚠️';
      const sz = mk.best ? 26 : 22;
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none';
      el.innerHTML =
        `<span style="font-size:10px;font-weight:700;color:#0b1220;background:rgba(255,255,255,.94);border-radius:4px;padding:1px 5px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2)">${escapeHtml(mk.label)}${mk.best ? ' ★' : ''}</span>` +
        `<span style="margin-top:2px;display:flex;align-items:center;justify-content:center;width:${sz}px;height:${sz}px;border-radius:9999px;background:${color};border:${mk.best ? 3 : 2}px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);font-size:12px;line-height:1">${glyph}</span>`;
      bekalMarkers.current.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([mk.lng, mk.lat]).addTo(map));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bekalSig, mapReady]);

  // Click-to-place: when a requester (ops Declare) is asking for a point, the
  // NEXT map click resolves it — so a declaration lands WHERE OPS CLICKS, not at
  // the operator's own GPS. Crosshair cursor while active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!mapPick.isRequesting()) return;
      mapPick.resolve({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };
    const applyCursor = () => { map.getCanvas().style.cursor = mapPick.isRequesting() ? 'crosshair' : ''; };
    map.on('click', onClick);
    const unsub = mapPick.subscribe(applyCursor);
    applyCursor();
    return () => { map.off('click', onClick); unsub(); map.getCanvas().style.cursor = ''; };
  }, [mapReady]);

  const liveByCategory = useMemo(() => {
    const byId: Record<string, LiveLayer | undefined> = {};
    for (const l of live?.layers ?? []) byId[l.id] = l;
    for (const [id, fc] of Object.entries(staticData) as [string, GeoJSON.FeatureCollection][]) {
      byId[id] = { id, label: LIVE_SPECS[id].legend, category: LIVE_SPECS[id].category, source: 'static', attribution: '', state: 'fresh', fetchedAt: 0, count: fc.features.length, geojson: fc };
    }
    const groups: Record<LayerCategory, string[]> = { health: [], hazard: [], traffic: [], air: [], weather: [] };
    for (const [id, spec] of Object.entries(LIVE_SPECS)) groups[spec.category].push(id);
    return { groups, byId };
  }, [live, staticData]);

  return (
    <div className="absolute inset-0 bg-surface-2">
      <div ref={containerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
      <LayerPanel
        visible={visible}
        setVisible={setVisible}
        groups={liveByCategory.groups}
        byId={liveByCategory.byId}
        loading={!live}
        refreshing={refreshing}
        nextInSec={nextInSec}
        hasData={lastAt > 0}
        onRefresh={refreshNow}
      />
    </div>
  );
}

// ── layer panel ─────────────────────────────────────────────────────────────

function LayerPanel({
  visible, setVisible, groups, byId, loading, refreshing, nextInSec, hasData, onRefresh,
}: {
  visible: Record<string, boolean>;
  setVisible: Dispatch<SetStateAction<Record<string, boolean>>>;
  groups: Record<LayerCategory, string[]>;
  byId: Record<string, LiveLayer | undefined>;
  loading: boolean;
  refreshing: boolean;
  nextInSec: number;
  hasData: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const toggle = (id: string) => setVisible((v) => ({ ...v, [id]: !v[id] }));
  const categories: LayerCategory[] = ['health', 'hazard', 'traffic', 'air', 'weather'];
  const activeCount = Object.values(visible).filter(Boolean).length;

  return (
    <div className="absolute top-4 left-4 z-10 w-60 max-w-[calc(100vw-2rem)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-white/95 backdrop-blur border border-border-strong rounded-t-lg text-text-primary"
      >
        <SlidersHorizontal className="w-4 h-4" />
        <span className="text-xs font-bold tracking-wide flex-1 text-left">Layers</span>
        <span className="text-[10px] font-mono text-text-secondary">
          {loading ? 'loading…' : `${activeCount} on`}
        </span>
        {open ? <X className="w-3.5 h-3.5 text-text-secondary" /> : null}
      </button>

      {/* Refresh control + countdown — transparency on data freshness. */}
      <div className={`flex items-center gap-2 px-2.5 py-1.5 bg-white/95 backdrop-blur border-x border-border-strong ${open ? '' : 'border-b rounded-b-lg'}`}>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh live data now"
          className="flex items-center gap-1.5 text-[10px] font-bold text-text-primary disabled:opacity-60"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <span className="flex-1 text-right text-[10px] font-mono text-text-secondary">
          {refreshing ? 'refreshing…' : hasData ? `next in ${nextInSec}s` : 'loading…'}
        </span>
      </div>

      {open && (
        <div className="bg-white/95 backdrop-blur border border-t-0 border-border-strong rounded-b-lg max-h-[calc(100vh-9rem)] overflow-y-auto p-2 space-y-3">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="text-[10px] uppercase font-bold tracking-widest text-text-secondary px-1 mb-1.5">{CATEGORY_LABEL[cat]}</div>
              <div className="space-y-1">
                {groups[cat].map((id) => {
                  const l = byId[id];
                  const isDown = !!l && l.state !== 'fresh';
                  return (
                    <Fragment key={id}>
                      <Toggle
                        on={!!visible[id]}
                        label={LIVE_SPECS[id].legend}
                        count={l?.count}
                        icon={LEGEND_ICON[id] ?? CATEGORY_ICON[cat]}
                        down={isDown}
                        title={isDown ? l?.error : undefined}
                        onClick={() => toggle(id)}
                      />
                    </Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, label, count, icon: Icon, onClick, down, title }: {
  on: boolean; label: string; count?: number; icon: typeof Hospital; onClick: () => void; down?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md border transition-colors ${
        on ? 'bg-surface-3 text-text-inverse border-border-strong' : 'bg-transparent text-text-secondary border-transparent hover:bg-surface-2'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="text-xs font-medium text-left flex-1 truncate">{label}</span>
      {down ? (
        <span className="text-[9px] uppercase font-bold text-text-primary bg-accent-warning rounded px-1">down</span>
      ) : count != null ? (
        <span className={`text-[10px] font-mono tabular-nums ${on ? 'text-text-inverse/70' : 'text-text-secondary'}`}>{count}</span>
      ) : null}
    </button>
  );
}
