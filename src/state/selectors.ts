// Derived selectors over the CSOT.
// Components import these instead of recomputing in-place.

import { getDistanceKm, etaMinutes } from '../utils/geo';
import type {
  CanonicalEvent,
  CaseRoom,
  CitizenReport,
  DistressSession,
  LngLat,
  NotificationNotice,
  Responder,
  Role,
} from './types';

export interface BriefingCounts {
  total: number;
  verifiedEvents: number;
  activeSos: number;
  pendingReports: number;
  activeCases: number;
  notificationsForCitizen: number;
}

export function selectBriefingCounts(args: {
  events: CanonicalEvent[];
  sosSessions: DistressSession[];
  reports: CitizenReport[];
  cases: CaseRoom[];
  notifications: NotificationNotice[];
  role: Role;
}): BriefingCounts {
  const verifiedEvents = args.events.filter((e) => e.status === 'verified').length;
  const activeSos = args.sosSessions.filter(
    (s) => !['resolved', 'cancelled'].includes(s.status),
  ).length;
  const pendingReports = args.reports.filter(
    (r) => r.status === 'pending' || r.status === 'claimed',
  ).length;
  const activeCases = args.cases.filter((c) => c.state !== 'resolved').length;
  const notificationsForCitizen = args.notifications.filter((n) =>
    n.roles.includes('citizen'),
  ).length;

  let total: number;
  if (args.role === 'ops') total = verifiedEvents + activeSos + pendingReports;
  else if (args.role === 'responder') total = verifiedEvents + activeSos + activeCases;
  else total = verifiedEvents + notificationsForCitizen;

  return {
    total,
    verifiedEvents,
    activeSos,
    pendingReports,
    activeCases,
    notificationsForCitizen,
  };
}

export interface NearbyEvent<T> {
  item: T;
  distanceKm: number;
}

export function selectNearby<T extends { location: LngLat }>(
  items: T[],
  origin: LngLat,
  withinKm: number,
): NearbyEvent<T>[] {
  return items
    .map((item) => ({ item, distanceKm: getDistanceKm(origin, item.location) }))
    .filter((entry) => entry.distanceKm <= withinKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export interface MissionTarget {
  type: 'sos' | 'case';
  id: string;
  title: string;
  subtitle: string;
  description: string;
  severity: 1 | 2 | 3 | 4 | 5;
  location: LngLat;
  kind: string;
}

export function selectCurrentMission(args: {
  selfResponderId: string;
  sosSessions: DistressSession[];
  cases: CaseRoom[];
  events: CanonicalEvent[];
}): MissionTarget | null {
  const sos = args.sosSessions.find(
    (s) => (s.memberCount ?? 0) > 0 && !['resolved', 'cancelled'].includes(s.status),
  );
  if (sos) {
    return {
      type: 'sos',
      id: sos.id,
      title: `${sos.category} SOS`,
      subtitle: `Citizen ${sos.citizenName}`,
      description: `Citizen SOS. Status: ${sos.status}. Completion needs responder and citizen acknowledgement.`,
      severity: 4,
      location: sos.location,
      kind: sos.category,
    };
  }
  const activeCase = args.cases.find(
    (c) => c.members.includes(args.selfResponderId) && c.state !== 'resolved',
  );
  if (!activeCase) return null;
  const event = args.events.find((e) => e.caseId === activeCase.id);
  return {
    type: 'case',
    id: activeCase.id,
    title: event?.title ?? `Case ${activeCase.name}`,
    subtitle: `#${activeCase.name} · ${activeCase.state}`,
    description:
      event?.kind === 'fire'
        ? 'Ops-formed fire response. Volunteers support resident welfare and stay out of suppression zones.'
        : event
          ? `${event.kind} incident formed by ops. Follow case room instructions before moving.`
          : 'Ops-formed case. Follow assigned role and case room instructions.',
    severity: activeCase.severity,
    location: activeCase.centroid,
    kind: event?.kind ?? 'case',
  };
}

export interface FitResult {
  score: number;
  reason: string;
}

export function fitForSos(
  responder: Responder | undefined,
  category: DistressSession['category'],
  distanceKm: number,
): FitResult {
  const role = responder?.role ?? 'aux';
  const match =
    (category === 'medical' && role === 'medic') ||
    (category === 'fire' && role === 'fire') ||
    (category === 'trapped' && role === 'search') ||
    (category === 'hazard' && role === 'aux');
  const distanceScore = Math.max(0, 34 - Math.round(distanceKm * 5));
  const score = Math.min(
    98,
    45 + distanceScore + (match ? 20 : 0) + (responder?.status === 'ready' ? 8 : 0),
  );
  return {
    score,
    reason: `${match ? 'Capability match' : 'Partial capability'} · ${distanceKm.toFixed(
      1,
    )} km · ${responder?.status ?? 'unknown'}`,
  };
}

export function fitForCase(
  responder: Responder | undefined,
  severity: 1 | 2 | 3 | 4 | 5,
  event: CanonicalEvent | undefined,
  distanceKm: number,
): FitResult {
  const match =
    (event?.kind === 'medical' && responder?.role === 'medic') ||
    (event?.kind === 'fire' && responder?.role === 'fire') ||
    (event?.kind === 'crash' && responder?.role !== 'aux') ||
    (event?.kind === 'flood' && ['search', 'aux'].includes(responder?.role ?? ''));
  const score = Math.min(
    96,
    38 + (match ? 24 : 8) + Math.max(0, 26 - Math.round(distanceKm * 3)) + severity * 3,
  );
  return {
    score,
    reason: `${match ? 'Role matches incident' : 'Support role'} · severity L${severity} · ${distanceKm.toFixed(1)} km`,
  };
}

// Realistic ETA helpers — replace the hardcoded "4:00" / "2:30" strings.

const URBAN_RESPONDER_KPH = 35; // mixed surface + footwork
export function etaFromDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 'now';
  const minutes = (distanceKm / URBAN_RESPONDER_KPH) * 60;
  if (minutes < 1) return 'under a minute';
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function etaProgress(distanceStartKm: number, distanceNowKm: number): number {
  if (distanceStartKm <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - distanceNowKm / distanceStartKm));
}

export function etaMinutesFor(distanceKm: number): number {
  return etaMinutes(distanceKm);
}
