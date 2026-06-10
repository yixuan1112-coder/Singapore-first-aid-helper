// CSOT provider. Domain types, seed data, and selectors live under ./state/*.
// See ./state/relations.ts for the cluster relation tree (intake → incidents →
// operations, with network/intel/presentation orbiting).
//
// This file holds only the React provider, action reducers, and side effects
// (NEA polling, WS bridge, responder movement, reverse geocode).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchLiveSnapshot, type LiveSnapshot } from './services/live';
import { askHostAi } from './services/hostAi';
import { csot, registerDemoQuickJoin } from './services/csot';
import { useCsotVersion } from './hooks/useCsot';
import { getDistanceKm, etaMinutes } from './utils/geo';
import { reverseGeocode } from './services/revgeocode';
import { SELF_ID } from './state/seed';
import { etaFromDistanceKm, selectBriefingCounts } from './state/selectors';
import type {
  ActionLog,
  AidCard,
  AppUser,
  CanonicalEvent,
  CaseMember,
  CaseRoom,
  ChatEntry,
  CitizenReport,
  DistressSession,
  InvestigationTask,
  LngLat,
  NotificationNotice,
  NotificationTier,
  Responder,
  Role,
  SelectedMapItem,
  SeverityLevel,
  ShellState,
  SosCaseDetails,
  SosCategory,
  TrackingState,
} from './state/types';

export type {
  ActionLog,
  AidCard,
  AppUser,
  CanonicalEvent,
  CaseMember,
  CaseRoom,
  ChatEntry,
  CitizenReport,
  DistressSession,
  InvestigationTask,
  LngLat,
  NotificationNotice,
  NotificationTier,
  SosCaseDetails,
  Responder,
  Role,
  SelectedMapItem,
  SeverityLevel,
  ShellState,
  SosCategory,
  TrackingState,
} from './state/types';

interface AppState {
  isAuthenticated: boolean;
  role: Role;
  setRole: (r: Role) => void;
  selfName: string;
  setSelfName: (name: string) => void;
  join: (name: string, role: Role) => void;
  leave: () => void;
  drawerContent: string | null;
  setDrawerContent: (id: string | null) => void;
  shellState: ShellState;
  setShellState: (s: ShellState) => void;

  events: CanonicalEvent[];
  reports: CitizenReport[];
  investigations: InvestigationTask[];
  sosSessions: DistressSession[];
  responders: Responder[];
  users: AppUser[];
  /** The signed-in user's directory record (name/phone/address), or null. */
  selfUser: AppUser | null;
  /** The signed-in user's private first-aid card, or null until filled. */
  aidCard: AidCard | null;
  updateAidCard: (patch: Partial<Omit<AidCard, 'userId' | 'updatedAt'>>) => void;
  /** The signed-in responder's own roster record (responder role only), or null. */
  selfResponder: Responder | null;
  /** Responder-only: go on/off shift. Only on-duty responders are paged. */
  setDuty: (on: boolean) => void;
  /** Responder-only: declare which SOS categories you can handle. */
  setProficiencies: (cats: SosCategory[]) => void;
  /** userIds currently connected to the broker (LWT-backed live presence). */
  onlineIds: Set<string>;
  cases: CaseRoom[];
  chat: ChatEntry[];
  liveSnapshot: LiveSnapshot | null;
  notifications: NotificationNotice[];
  actionLogs: ActionLog[];

  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** SOS currently opened in a detail sheet (from a map tap or the list), or null. */
  viewSosId: string | null;
  setViewSosId: (id: string | null) => void;
  activeCaseId: string | null;
  setActiveCaseId: (id: string | null) => void;
  tracking: TrackingState | null;
  setTracking: (t: TrackingState | null) => void;
  selectedMapItem: SelectedMapItem | null;
  setSelectedMapItem: (item: SelectedMapItem | null) => void;

  briefingInView: number;
  selfResponderId: string;

  pushNotification: (entry: Omit<NotificationNotice, 'id' | 'createdAt' | 'ackBy'>) => void;
  sendBroadcast: (b: { audience: Role[]; tier: NotificationTier; area?: string; message: string; details?: string }) => void;
  // Ops "Declare" — three modes that reuse existing flows:
  //  notice      → a persistent awareness marker on everyone's map + a bell alert.
  //  investigate → an InvestigationTask assigned to a responder (report-style).
  //  case        → an ops-owned SOS case room responders can join/coordinate in.
  declareNotice: (n: { kind: CanonicalEvent['kind']; title: string; note: string; tier: NotificationTier; area: string; location: LngLat }) => void;
  declareInvestigate: (i: { responderId: string; responderName?: string; kind: CanonicalEvent['kind']; title: string; body: string; location: LngLat }) => void;
  declareCase: (c: { category: SosCategory; title: string; details: string; area: string; location: LngLat }) => string;
  fileReport: (r: Omit<CitizenReport, 'id' | 'status' | 'createdAt' | 'reporterTrust'>) => string;
  verifyReport: (id: string) => void;
  dismissReport: (id: string) => void;
  /** Ops dispatches a report to a responder to investigate (creates a task). */
  dispatchReport: (reportId: string, responderId: string) => void;
  /** The assigned responder closes the investigation with an outcome. */
  resolveInvestigation: (reportId: string, outcome: string) => void;
  /** Ops blocks/terminates an SOS case it deems fake or unneeded. */
  terminateSos: (sosId: string, reason: string) => void;
  /** Ops stands a case down as HANDLED (resolved) — the clean close, distinct
   *  from terminate (fake/unneeded). Used to close ops-declared cases and to
   *  force-resolve a citizen SOS ops has confirmed handled. */
  standDownSos: (sosId: string) => void;

  startSos: (s: { citizenName: string; category: SosCategory; details?: string; location: LngLat; phone?: string }) => string;
  /** Responder joins an SOS case (subscribes to the private room, becomes a live
   *  member). Joining is what reveals the aid card — no accept/dispatch step. */
  joinSosCase: (sosId: string) => void;
  leaveSosCase: (sosId: string) => void;
  /** Joined responder marks themselves on scene. */
  markArrived: (sosId: string) => void;
  /** Group chat for a case — owner + joined responders only. */
  sendCaseChat: (sosId: string, text: string) => void;
  /** Private case-room selectors (only populated for the owner + joined). */
  caseMembers: (sosId: string) => CaseMember[];
  caseChat: (sosId: string) => ChatEntry[];
  caseDetails: (sosId: string) => SosCaseDetails | undefined;
  /** SOS case ids this responder has joined (drives live location publishing). */
  joinedCaseIds: Set<string>;
  confirmSosSafe: (sosId: string, by: 'citizen' | 'responder') => void;
  cancelSos: (sosId: string) => void;

  /** Tombstone a declared incident/notice (removes its map marker). */
  resolveEvent: (eventId: string) => void;
  updateSelfProfile: (patch: Partial<AppUser>) => void;

  // Case-room AI scaffold (dormant — reserved for the named-agent phase).
  sendChat: (caseId: string, authorId: string, text: string) => void;
  askHost: (caseId: string, query: string) => void;

  ackNotification: (notificationId: string, actorId: string) => void;

  selfLocation: LngLat | null;
  setSelfLocation: (loc: LngLat | null) => void;
  selfPlaceName: string | null;
  updateResponderLocation: (responderId: string, loc: LngLat) => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<Role>('citizen');
  const [selfName, setSelfName] = useState('');
  const [drawerContent, setDrawerContentRaw] = useState<string | null>(null);
  const [shellState, setShellState] = useState<ShellState>('S0');

  // NEA-derived weather incidents (PSI/rainfall). Every client derives these
  // from the same live snapshot, so they stay a LOCAL overlay rather than being
  // republished to CSOT (which would be a needless publish storm).
  const [liveEvents, setLiveEvents] = useState<CanonicalEvent[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(null);

  // ── CSOT-derived state ─────────────────────────────────────────────
  // The roster and user directory are NOT local seed: they are real people who
  // joined, mirrored live from the broker. Re-snapshot whenever any topic moves.
  const csotVersion = useCsotVersion();
  const responders = useMemo<Responder[]>(
    () => csot.collection<Responder>('operations', 'responder'),
    [csotVersion],
  );
  const users = useMemo<AppUser[]>(
    () => csot.collection<AppUser>('network', 'user'),
    [csotVersion],
  );
  // Case rooms are shared channels; chat is the message stream inside them.
  // Both live in the operations cluster so every member converges on the same
  // room state and roster — this is what makes a case room genuinely multi-user.
  const cases = useMemo<CaseRoom[]>(
    () => csot.collection<CaseRoom>('operations', 'case').sort((a, b) => b.startedAt - a.startedAt),
    [csotVersion],
  );
  const chat = useMemo<ChatEntry[]>(
    () => csot.collection<ChatEntry>('operations', 'chat').sort((a, b) => a.ts - b.ts),
    [csotVersion],
  );
  // Intake (citizen-originated) + incidents, all from CSOT. SOS and reports are
  // owner-scoped at the transport, so a citizen's collection holds only theirs.
  const sosSessions = useMemo<DistressSession[]>(
    () => csot.collection<DistressSession>('intake', 'sos').sort((a, b) => b.startedAt - a.startedAt),
    [csotVersion],
  );
  const reports = useMemo<CitizenReport[]>(
    () => csot.collection<CitizenReport>('intake', 'report').sort((a, b) => b.createdAt - a.createdAt),
    [csotVersion],
  );
  const investigations = useMemo<InvestigationTask[]>(
    () => csot.collection<InvestigationTask>('operations', 'investigation').sort((a, b) => b.createdAt - a.createdAt),
    [csotVersion],
  );
  const csotEvents = useMemo<CanonicalEvent[]>(
    () => csot.collection<CanonicalEvent>('incidents', 'event'),
    [csotVersion],
  );
  // The map/feeds see one merged stream: shared declared/verified incidents from
  // CSOT plus this client's live weather overlay.
  const events = useMemo<CanonicalEvent[]>(
    () => [...csotEvents, ...liveEvents],
    [csotEvents, liveEvents],
  );

  // SOS topic carries the owner id (csot/intake/sos/<owner>/<id>) so the broker
  // only delivers it to that citizen + responders/ops. patchSos preserves it.
  const putSos = useCallback((s: DistressSession) => {
    const owner = s.ownerId ?? csot.identity?.userId ?? 'anon';
    csot.put('intake', 'sos', `${owner}/${s.id}`, { ...s, ownerId: owner });
  }, []);
  const patchSos = useCallback((sosId: string, fn: (s: DistressSession) => DistressSession) => {
    const cur = csot.collection<DistressSession>('intake', 'sos').find((s) => s.id === sosId);
    if (cur) putSos(fn(cur));
  }, []);
  // Reports are owner-scoped the same way (ops-only + reporter until verified).
  const putReport = useCallback((r: CitizenReport) => {
    const owner = r.ownerId ?? csot.identity?.userId ?? 'anon';
    csot.put('intake', 'report', `${owner}/${r.id}`, { ...r, ownerId: owner });
  }, []);
  const patchReport = useCallback((reportId: string, fn: (r: CitizenReport) => CitizenReport) => {
    const cur = csot.collection<CitizenReport>('intake', 'report').find((r) => r.id === reportId);
    if (cur) putReport(fn(cur));
  }, []);
  // Canonical incidents are shared (no owner scoping).
  const putEvent = useCallback((e: CanonicalEvent) => {
    csot.put('incidents', 'event', e.id, e);
  }, []);

  // Notifications + audit logs, role-scoped at the transport (one copy per
  // targeted role under csot/presentation/<type>/<role>/<id>). ops sees every
  // role's copy, so dedup by id; for notifications, union ackBy across copies.
  const notifications = useMemo<NotificationNotice[]>(() => {
    const byId = new Map<string, NotificationNotice>();
    for (const n of csot.collection<NotificationNotice>('presentation', 'notification')) {
      const prev = byId.get(n.id);
      byId.set(n.id, prev
        ? { ...prev, ackBy: Array.from(new Set([...prev.ackBy, ...n.ackBy])) }
        : n);
    }
    return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [csotVersion]);
  const actionLogs = useMemo<ActionLog[]>(() => {
    const byId = new Map<string, ActionLog>();
    for (const l of csot.collection<ActionLog>('presentation', 'log')) byId.set(l.id, l);
    return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [csotVersion]);

  // Live presence: the broker publishes each member's online flag and, via the
  // Last-Will, an offline marker the instant they drop. This is the "who's in
  // the channel right now" signal, distinct from on/off-duty status.
  const onlineIds = useMemo<Set<string>>(
    () => new Set(
      csot.presence<{ userId: string; online: boolean }>()
        .filter((p) => p?.online)
        .map((p) => p.userId),
    ),
    [csotVersion],
  );
  // Self identity comes from the bridge-minted userId; falls back to the static
  // SELF_ID only before a successful join (so the responder workspace renders).
  const selfResponderId = csot.identity?.userId ?? SELF_ID;

  // The signed-in user's own directory record + private aid card.
  const selfUser = useMemo<AppUser | null>(
    () => users.find((u) => u.id === selfResponderId) ?? null,
    [users, selfResponderId],
  );
  const aidCard = useMemo<AidCard | null>(
    () => csot.get<AidCard>('network', 'aidcard', selfResponderId) ?? null,
    [csotVersion, selfResponderId],
  );
  const updateAidCard: AppState['updateAidCard'] = (patch) => {
    const id = csot.identity?.userId;
    if (!id) return;
    const cur = csot.get<AidCard>('network', 'aidcard', id);
    const next: AidCard = {
      allergies: '', conditions: [], carries: [], access: [], language: '',
      nokName: '', nokPhone: '', nokRelation: '',
      ...cur, ...patch, userId: id, updatedAt: Date.now(),
    };
    csot.put('network', 'aidcard', id, next);
  };

  // All roster writes flow through here so CSOT stays the single source of truth.
  const patchResponder = useCallback((id: string, fn: (r: Responder) => Responder) => {
    const cur = csot.collection<Responder>('operations', 'responder').find((r) => r.id === id);
    if (cur) csot.put('operations', 'responder', id, fn(cur));
  }, []);

  // Responder-only: the signed-in responder's own roster record + shift/skills.
  const selfResponder = useMemo<Responder | null>(
    () => responders.find((r) => r.id === selfResponderId) ?? null,
    [responders, selfResponderId],
  );
  const setDuty: AppState['setDuty'] = (on) =>
    patchResponder(selfResponderId, (r) => ({ ...r, onDuty: on, status: on ? 'ready' : 'out' }));
  const setProficiencies: AppState['setProficiencies'] = (proficiencies) =>
    patchResponder(selfResponderId, (r) => ({ ...r, proficiencies }));
  // Chat id carries the caseId in the topic path (csot/operations/chat/<case>/<msg>)
  // so the broker scopes a room's history and citizens can be granted just chat.
  const putChat = useCallback((entry: ChatEntry) => {
    csot.put('operations', 'chat', `${entry.caseId}/${entry.id}`, entry);
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewSosId, setViewSosId] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  // SOS cases this responder has joined — drives live member-location publishing.
  const [joinedCaseIds, setJoinedCaseIds] = useState<Set<string>>(() => new Set());
  const [selfLocation, setSelfLocation] = useState<LngLat | null>(null);
  const [selfPlaceName, setSelfPlaceName] = useState<string | null>(null);
  const lastGeocodeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selfLocation) {
      setSelfPlaceName(null);
      lastGeocodeKeyRef.current = null;
      return;
    }
    // Round to 3 decimals (~110m grid) so we don't spam revgeocode on tiny GPS jitter
    const key = `${selfLocation.lat.toFixed(3)},${selfLocation.lng.toFixed(3)}`;
    if (key === lastGeocodeKeyRef.current) return;
    lastGeocodeKeyRef.current = key;
    let cancelled = false;
    const handle = setTimeout(() => {
      reverseGeocode(selfLocation).then((res) => {
        if (cancelled) return;
        if (res.state === 'live' && res.placeName) setSelfPlaceName(res.placeName);
        else setSelfPlaceName(null);
      });
    }, 600);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [selfLocation]);
  const [selectedMapItem, setSelectedMapItem] = useState<SelectedMapItem | null>(null);

  const setDrawerContent = useCallback((id: string | null) => {
    setDrawerContentRaw(id);
    setShellState(id ? 'S2' : 'S0');
  }, []);

  const join: AppState['join'] = (name, nextRole) => {
    setSelfName(name.trim());
    setRole(nextRole);
    setIsAuthenticated(true);
    setDrawerContentRaw(null);
    setShellState('S0');
    // Mint a real identity on the bridge and connect the core MQTT transport.
    // Failure (broker not reachable) degrades gracefully — the app still runs.
    csot.join(name.trim(), nextRole)
      .then((id) => {
        // A RETURNING demo account already has its profile, aid card, skills and
        // duty state retained in the broker — they replay on reconnect. Writing
        // the defaults below would clobber them, so only seed for a NEW account.
        if (csot.restored) return;
        // Publish self into the CSOT so others see a real person, not seed.
        csot.put('network', 'user', id.userId, {
          id: id.userId,
          username: id.name,
          displayName: id.name,
          phone: '',
          primaryRole: nextRole,
          address: '',
          skills: [],
          available: true,
        });
        // A responder joins the dispatchable roster. Org/skill are unknown until
        // self-declared — we don't fabricate them. Location starts at last known
        // GPS (or SG centre) and is refined by the live-tracking effect.
        if (nextRole === 'responder') {
          csot.put('operations', 'responder', id.userId, {
            id: id.userId,
            name: id.name,
            org: 'Volunteer',
            role: 'aux',
            status: 'ready',
            location: selfLocation ?? { lng: 103.8198, lat: 1.3521 },
            groups: [],
            unitType: 'volunteer',
            onDuty: true,
            proficiencies: [],
          });
        }
      })
      .catch(() => {});
  };

  const leave: AppState['leave'] = () => {
    csot.leave();
    setIsAuthenticated(false);
    setSelfName('');
    setDrawerContentRaw(null);
    setShellState('S0');
    setTracking(null);
  };

  // Embedded demo iframes: register sign-in before first paint so the director
  // can call quickJoin as soon as clients load.
  const joinRef = useRef(join);
  joinRef.current = join;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useLayoutEffect(() => {
    const demoSession = new URLSearchParams(window.location.search).get('demoSession');
    if (!demoSession) return;
    registerDemoQuickJoin((name: string, nextRole: string) => {
      const trimmed = name.trim();
      const id = csot.identity;
      if (id && (id.name !== trimmed || id.role !== nextRole)) leaveRef.current();
      joinRef.current(trimmed, nextRole as Role);
    });
    return () => registerDemoQuickJoin(null);
  }, []);

  // Push real GPS into the self responder's CSOT record so ops sees the true
  // position (and distance/ETA fit scores) of the person on the ground.
  useEffect(() => {
    if (role !== 'responder' || !selfLocation || !csot.identity) return;
    patchResponder(selfResponderId, (r) => ({ ...r, location: selfLocation }));
    // Live-track inside every joined SOS case: republish my member entry with the
    // fresh location + ETA. The owner (subscribed to the private room) sees me
    // approaching, GrabFood-style. Only the room's participants receive this.
    // NB: read the SOS location DIRECTLY from the store, not the memoized
    // sosSessions — depending on it here would loop (patchResponder bumps the
    // version → new sosSessions → effect re-runs → patchResponder → …).
    for (const sosId of joinedCaseIds) {
      const me = csot.collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`).find((m) => m.id === selfResponderId);
      const sos = csot.collection<DistressSession>('intake', 'sos').find((s) => s.id === sosId);
      const eta = sos && me?.status !== 'arrived' ? etaFromDistanceKm(getDistanceKm(selfLocation, sos.location)) : me?.eta;
      csot.publishTopic(`csot/case/${sosId}/member/${selfResponderId}`, {
        id: selfResponderId,
        name: me?.name ?? selfName ?? 'Responder',
        role: me?.role ?? 'responder',
        proficiencies: me?.proficiencies ?? [],
        status: me?.status ?? 'en_route',
        joinedAt: me?.joinedAt ?? Date.now(),
        location: selfLocation,
        eta,
      } satisfies CaseMember);
    }
  }, [role, selfLocation, selfResponderId, patchResponder, joinedCaseIds, selfName]);

  // When a joined case ends (owner resolved or cancelled it), clean up our
  // membership locally: drop the subscription and free the responder.
  useEffect(() => {
    if (role !== 'responder') return;
    for (const sosId of joinedCaseIds) {
      const sos = sosSessions.find((s) => s.id === sosId);
      if (sos && !['resolved', 'cancelled'].includes(sos.status)) continue;
      csot.unsubscribeTopic(`csot/case/${sosId}/#`);
      setJoinedCaseIds((prev) => { const n = new Set(prev); n.delete(sosId); return n; });
      patchResponder(selfResponderId, (r) => (r.assignedSosId === sosId ? { ...r, status: 'ready', assignedSosId: undefined } : r));
    }
  }, [role, joinedCaseIds, sosSessions, selfResponderId, patchResponder]);

  // Ops reflects a closed investigation back onto the citizen's report — ops is
  // the only party that sees BOTH the operations investigation and the intake
  // report, so it bridges them. The ref makes it strictly once-per-investigation
  // so a write can never re-trigger this effect into a loop.
  const reflectedReports = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (role !== 'ops') return;
    for (const t of investigations) {
      if (t.status !== 'resolved' || reflectedReports.current.has(t.id)) continue;
      const rep = csot.collection<CitizenReport>('intake', 'report').find((r) => r.id === t.reportId);
      if (rep && rep.status !== 'resolved' && rep.status !== 'dismissed') {
        reflectedReports.current.add(t.id);
        patchReport(rep.id, (r) => ({
          ...r,
          status: 'resolved',
          auditTrail: [...(r.auditTrail ?? []), `Investigator closed: ${t.outcome || 'resolved'}.`],
        }));
      }
    }
  }, [role, investigations, patchReport]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const snap = await fetchLiveSnapshot();
      if (!alive) return;
      setLiveSnapshot(snap);
      // Promote dangerous PSI/rainfall readings into the local live-event overlay.
      setLiveEvents(() => {
        const next: CanonicalEvent[] = [];
        for (const p of snap.psi) {
          if (p.psi24h !== null && p.psi24h >= 100) {
            next.push({
              id: 'LIVE-PSI-' + p.region,
              kind: 'weather',
              title: 'Unhealthy PSI · ' + p.region,
              severity: (p.psi24h >= 200 ? 4 : p.psi24h >= 150 ? 3 : 2) as SeverityLevel,
              status: 'verified',
              location: { lng: p.lng, lat: p.lat },
              source: 'NEA PSI live',
              createdAt: snap.fetchedAt,
              liveValue: p.psi24h + ' PSI',
            });
          }
        }
        for (const r of snap.rainfall.filter((r) => r.mm > 1)) {
          next.push({
            id: 'LIVE-RAIN-' + r.stationId,
            kind: 'weather',
            title: 'Active rainfall · ' + r.name,
            severity: (r.mm > 10 ? 3 : r.mm > 4 ? 2 : 1) as SeverityLevel,
            status: 'verified',
            location: { lng: r.lng, lat: r.lat },
            source: 'NEA rainfall live',
            createdAt: snap.fetchedAt,
            liveValue: r.mm.toFixed(1) + ' mm',
          });
        }
        return next;
      });
    };
    pull();
    const t = setInterval(pull, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // IDs must be globally unique across clients: a per-counter alone collides
  // (every client started at 5000, so two browsers both minted REP-5005 → the
  // same retained report under two owners, React key clashes, and ops verifying
  // "REP-5005" could hit the wrong owner's copy). Suffix a per-session token.
  const counter = useRef(5000);
  const idToken = useRef(Math.random().toString(36).slice(2, 7));
  const newId = (p: string) => `${p}-${++counter.current}-${idToken.current}`;

  // Fan out one retained copy per audience role, so each role's subscription
  // (and only that role) receives it. visibleTo drives who can see a log.
  const pushLog = useCallback(
    (entry: Omit<ActionLog, 'id' | 'createdAt'>) => {
      const log: ActionLog = { ...entry, id: newId('LOG'), createdAt: Date.now() };
      for (const r of entry.visibleTo) csot.put('presentation', 'log', `${r}/${log.id}`, log);
    },
    []
  );

  const pushNotification = useCallback(
    (entry: Omit<NotificationNotice, 'id' | 'createdAt' | 'ackBy'>) => {
      const notif: NotificationNotice = { ...entry, id: newId('NT'), createdAt: Date.now(), ackBy: [] };
      for (const r of entry.roles) csot.put('presentation', 'notification', `${r}/${notif.id}`, notif);
    },
    []
  );

  // Ops-authored area broadcast — fans out as a role-scoped alert to the chosen
  // audience (residents / responders / both). Reuses the notification transport;
  // ops sees every copy (subscribes csot/#) as its sent-log. Fire-and-forget.
  const sendBroadcast: AppState['sendBroadcast'] = ({ audience, tier, area, message, details }) => {
    pushNotification({ kind: 'broadcast', tier, roles: audience, title: message, body: details ?? '', area });
    pushLog({
      actorId: selfResponderId,
      actorRole: 'ops',
      action: 'broadcast.sent',
      targetId: selfResponderId,
      message: `Broadcast (${tier}) → ${audience.join(' + ')}${area ? ` · ${area}` : ''}: ${message}`,
      severity: tier === 'critical' ? 5 : tier === 'urgent' ? 4 : 2,
      visibleTo: ['ops'],
    });
  };

  // ── Ops "Declare" ────────────────────────────────────────────────────────
  // A Notice is awareness-only: a canonical event (so it pins on every role's
  // map, beyond the API indicators) plus a broadcast-tier bell alert. No response
  // workflow — fire-and-forget.
  const declareNotice: AppState['declareNotice'] = ({ kind, title, note, tier, area, location }) => {
    const id = newId('EV');
    const severity = (tier === 'critical' ? 5 : tier === 'urgent' ? 4 : tier === 'watch' ? 3 : 2) as SeverityLevel;
    putEvent({ id, kind, title, severity, status: 'verified', location, source: `Ops notice · ${area || 'Islandwide'}`, createdAt: Date.now() });
    pushNotification({ kind: 'broadcast', tier, roles: ['citizen', 'responder', 'ops'], title, body: note, area: area || 'Islandwide', targetId: id });
    pushLog({
      actorId: selfResponderId, actorRole: 'ops', action: 'notice.declared', targetId: id,
      message: `Notice "${title}" posted${area ? ` · ${area}` : ''}.`, severity, visibleTo: ['ops', 'responder'],
    });
  };

  // An ops-originated investigation, dispatched to a chosen responder — identical
  // to report dispatch but with no backing citizen report (reportId left blank).
  const declareInvestigate: AppState['declareInvestigate'] = ({ responderId, responderName, kind, title, body, location }) => {
    const id = newId('INV');
    csot.put('operations', 'investigation', id, {
      id, reportId: '', assignedTo: responderId, assignedName: responderName,
      kind, title, body, location, status: 'open', createdAt: Date.now(),
    } satisfies InvestigationTask);
    patchResponder(responderId, (r) => ({ ...r, status: 'en_route' }));
    pushLog({
      actorId: selfResponderId, actorRole: 'ops', action: 'investigation.declared', targetId: id,
      message: `Ops asked ${responderName ?? responderId} to investigate "${title}".`, severity: 2, visibleTo: ['ops', 'responder'],
    });
    pushNotification({
      tier: 'watch', roles: ['responder'], title: 'Investigation assigned',
      body: `Ops asked you to check: ${title}.`, targetId: id,
    });
  };

  // An ops-originated case: same two-tier SOS machinery (public signal + private
  // room) but ops is the owner. Responders discover it, join, and coordinate in
  // the room exactly as for a citizen SOS. Ops closes it via Terminate.
  const declareCase: AppState['declareCase'] = ({ category, title, details, area, location }) => {
    const id = newId('SOS');
    const who = title || `Ops case · ${area || 'area'}`;
    putSos({
      id, ownerId: selfResponderId, citizenName: who, category, details,
      location, status: 'requesting', memberCount: 0, startedAt: Date.now(),
    });
    csot.subscribeTopic(`csot/case/${id}/#`);
    csot.publishTopic(`csot/case/${id}/info`, { ownerName: who, category } satisfies SosCaseDetails);
    pushLog({
      actorId: selfResponderId, actorRole: 'ops', action: 'case.declared', targetId: id,
      message: `Ops opened a ${category} case "${who}"${area ? ` · ${area}` : ''}. On-duty responders nearby recommended.`,
      severity: 4, visibleTo: ['ops', 'responder'],
    });
    pushNotification({
      tier: 'urgent', roles: ['responder'], title: `Ops case · ${category}`,
      body: `${who}${area ? ` · ${area}` : ''}. Join to respond.`, targetId: id,
    });
    return id;
  };

  // Ack updates only the actor's own role-copy (the one they actually hold);
  // ops merges ackBy across copies when reading, so the picture stays whole.
  const ackNotification: AppState['ackNotification'] = (notificationId, actorId) => {
    const key = `${role}/${notificationId}`;
    const cur = csot.get<NotificationNotice>('presentation', 'notification', key);
    if (!cur || cur.ackBy.includes(actorId)) return;
    csot.put('presentation', 'notification', key, { ...cur, ackBy: [...cur.ackBy, actorId] });
  };

  const fileReport: AppState['fileReport'] = (r) => {
    const id = newId('REP');
    const rec: CitizenReport = {
      ...r,
      id,
      ownerId: selfResponderId,
      status: 'pending',
      reporterTrust: 0.6,
      createdAt: Date.now(),
      auditTrail: ['Citizen filed report. Routed to ops queue only.'],
    };
    putReport(rec);
    pushLog({
      actorId: selfResponderId,
      actorRole: 'citizen',
      action: 'report.filed',
      targetId: id,
      message: `${rec.title} filed by citizen. Awaiting ops claim/verify/dismiss.`,
      severity: rec.kind === 'fire' ? 4 : 2,
      visibleTo: ['ops'],
    });
    pushNotification({
      tier: rec.kind === 'fire' ? 'urgent' : 'watch',
      roles: ['ops'],
      title: `New citizen report: ${rec.kind}`,
      body: `${rec.title}. Responders will only see it after ops verification unless it is SOS.`,
      targetId: id,
    });
    return id;
  };
  const verifyReport: AppState['verifyReport'] = (id) => {
    const report = reports.find((r) => r.id === id);
    if (!report) return;
    const eventId = newId('EV');
    putEvent({
      id: eventId,
      kind: report.kind,
      title: report.title,
      severity: 3 as SeverityLevel,
      status: 'verified',
      location: report.location,
      source: 'ops verification',
      createdAt: Date.now(),
    });
    patchReport(id, (r) => ({
      ...r,
      status: 'verified',
      promotedToEventId: eventId,
      notifiedReporter: true,
      auditTrail: [
        ...(r.auditTrail ?? []),
        'Ops verified report.',
        `Canonical event ${eventId} published to responders and citizens.`,
        'Reporter acknowledgement notification queued.',
      ],
    }));
    pushLog({
      actorId: 'ops',
      actorRole: 'ops',
      action: 'report.verified',
      targetId: id,
      message: `${report.title} verified. Event ${eventId} is now visible to responders/citizens.`,
      severity: 3,
      visibleTo: ['ops', 'responder'],
    });
    pushNotification({
      tier: 'info',
      roles: ['citizen'],
      title: 'Report verified',
      body: `${report.title} has been verified by ops. Nearby users and responders can now see it.`,
      targetId: eventId,
    });
    pushNotification({
      tier: report.kind === 'fire' ? 'urgent' : 'watch',
      roles: ['responder'],
      title: `Verified incident: ${report.kind}`,
      body: `${report.title}. Join only if fit and not interfering with official units.`,
      targetId: eventId,
    });
  };
  const dismissReport: AppState['dismissReport'] = (id) => {
    const report = reports.find((r) => r.id === id);
    patchReport(id, (r) => ({
      ...r,
      status: 'dismissed',
      notifiedReporter: true,
      auditTrail: [...(r.auditTrail ?? []), 'Ops dismissed report and notified reporter.'],
    }));
    pushLog({
      actorId: 'ops',
      actorRole: 'ops',
      action: 'report.dismissed',
      targetId: id,
      message: `${report?.title ?? id} dismissed by ops. Reporter notification queued.`,
      visibleTo: ['ops'],
    });
    pushNotification({
      tier: 'info',
      roles: ['citizen'],
      title: 'Report reviewed',
      body: `${report?.title ?? 'Your report'} was reviewed by ops and not published as an incident.`,
      targetId: id,
    });
  };

  // Ops dispatches a non-emergency report to a responder to investigate. Creates
  // an InvestigationTask in the operations cluster (which responders see) so the
  // assigned responder gets the task without access to the raw report queue.
  const dispatchReport: AppState['dispatchReport'] = (reportId, responderId) => {
    const report = reports.find((r) => r.id === reportId);
    const responder = responders.find((r) => r.id === responderId);
    if (!report) return;
    csot.put('operations', 'investigation', reportId, {
      id: reportId,
      reportId,
      assignedTo: responderId,
      assignedName: responder?.name,
      kind: report.kind,
      title: report.title,
      body: report.body,
      location: report.location,
      status: 'open',
      createdAt: Date.now(),
    });
    patchReport(reportId, (r) => ({
      ...r,
      status: 'investigating',
      assignedInvestigatorId: responderId,
      investigatorName: responder?.name,
      auditTrail: [...(r.auditTrail ?? []), `Ops dispatched ${responder?.name ?? responderId} to investigate.`],
    }));
    patchResponder(responderId, (r) => ({ ...r, status: 'en_route' }));
    pushLog({
      actorId: selfResponderId, actorRole: 'ops', action: 'report.dispatched', targetId: reportId,
      message: `Ops dispatched ${responder?.name ?? responderId} to investigate "${report.title}".`,
      severity: 2, visibleTo: ['ops', 'responder'],
    });
    pushNotification({
      tier: 'watch', roles: ['responder'], title: 'Investigation assigned',
      body: `Ops asked you to check: ${report.title}.`, targetId: reportId,
    });
  };

  // The assigned responder closes the investigation with an outcome.
  const resolveInvestigation: AppState['resolveInvestigation'] = (reportId, outcome) => {
    const task = investigations.find((t) => t.id === reportId);
    // The responder owns the investigation (operations cluster) but can't write
    // to the citizen's report (intake is ops-scoped) — ops reflects the closure
    // back onto the report (see the ops effect below).
    csot.put('operations', 'investigation', reportId, { ...(task as InvestigationTask), status: 'resolved', outcome });
    patchResponder(selfResponderId, (r) => ({ ...r, status: 'ready' }));
    pushLog({
      actorId: selfResponderId, actorRole: 'responder', action: 'report.investigated', targetId: reportId,
      message: `Investigation closed: ${outcome || 'resolved'}.`, severity: 2, visibleTo: ['ops', 'responder'],
    });
    // Citizen-reported investigations notify the reporter; ops-originated ones
    // (no backing report) report back to ops instead.
    if (task?.reportId) {
      pushNotification({
        tier: 'info', roles: ['citizen'], title: 'Report checked',
        body: `A responder checked your report. ${outcome || ''}`.trim(), targetId: reportId,
      });
    } else {
      pushNotification({
        tier: 'info', roles: ['ops'], title: 'Investigation closed',
        body: `${task?.title ?? 'Investigation'} · ${outcome || 'resolved'}`, targetId: reportId,
      });
    }
  };

  // Ops blocks/terminates an SOS case it deems fake or unneeded. Tears down the
  // private room and frees any responders who had joined.
  const terminateSos: AppState['terminateSos'] = (sosId, reason) => {
    patchSos(sosId, (s) => ({ ...s, status: 'cancelled', finalReport: `Terminated by ops: ${reason}` }));
    for (const m of csot.collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`)) {
      patchResponder(m.id, (r) => (r.assignedSosId === sosId ? { ...r, status: 'ready', assignedSosId: undefined } : r));
    }
    teardownCaseRoom(sosId);
    pushLog({
      actorId: selfResponderId, actorRole: 'ops', action: 'sos.terminated', targetId: sosId,
      message: `Ops terminated ${sosId} (${reason}).`, severity: 3, visibleTo: ['ops', 'responder', 'citizen'],
    });
    pushNotification({
      tier: 'info', roles: ['citizen'], title: 'SOS closed by ops',
      body: `Ops closed this SOS: ${reason}.`, targetId: sosId,
    });
  };

  // Clean close (handled). Mirrors terminateSos but resolves rather than cancels,
  // so it reads as "we dealt with it" — the proper end for an ops-declared case
  // (which has no citizen to complete the dual-ack) or any case ops confirms done.
  const standDownSos: AppState['standDownSos'] = (sosId) => {
    const sos = sosSessions.find((s) => s.id === sosId);
    patchSos(sosId, (s) => ({ ...s, status: 'resolved', finalReport: 'Stood down by ops — handled.' }));
    for (const m of csot.collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`)) {
      patchResponder(m.id, (r) => (r.assignedSosId === sosId ? { ...r, status: 'ready', assignedSosId: undefined } : r));
    }
    teardownCaseRoom(sosId);
    pushLog({
      actorId: selfResponderId, actorRole: 'ops', action: 'sos.stood_down', targetId: sosId,
      message: `Ops stood down ${sos?.category ?? 'the'} case ${sosId} (handled).`, severity: 2, visibleTo: ['ops', 'responder', 'citizen'],
    });
    pushNotification({
      tier: 'info', roles: ['responder'], title: 'Case stood down',
      body: `Ops marked ${sos?.citizenName ?? sosId} resolved. Thanks for responding.`, targetId: sosId,
    });
  };

  const startSos: AppState['startSos'] = (s) => {
    const id = newId('SOS');
    // PUBLIC signal: discoverable by responders + ops, owner-scoped away from
    // other citizens. Carries NO aid card / phone — those live in the private
    // case room and are revealed only to responders who JOIN.
    putSos({
      id,
      ownerId: selfResponderId,
      citizenName: s.citizenName,
      category: s.category,
      details: s.details,
      location: s.location,
      status: 'requesting',
      memberCount: 0,
      startedAt: Date.now(),
    });
    // PRIVATE case room: only the owner (subscribing now) and joined responders
    // (subscribing on join) receive it. Holds aid card + contact, live member
    // tracking, and the group chat.
    csot.subscribeTopic(`csot/case/${id}/#`);
    csot.publishTopic(`csot/case/${id}/info`, {
      ownerName: s.citizenName,
      category: s.category,
      phone: s.phone ?? selfUser?.phone,
      aidCard: aidCard ?? undefined,
    } satisfies SosCaseDetails);
    pushLog({
      actorId: selfResponderId,
      actorRole: 'citizen',
      action: 'sos.created',
      targetId: id,
      message: `${s.citizenName} opened a ${s.category} SOS. On-duty responders within range are recommended to join.`,
      severity: 4,
      visibleTo: ['ops', 'responder', 'citizen'],
    });
    pushNotification({
      tier: 'critical',
      roles: ['ops'],
      title: `SOS · ${s.category}`,
      body: `${s.citizenName} raised a ${s.category} SOS. Responders nearby are being recommended to join.`,
      targetId: id,
    });
    return id;
  };

  // Responder JOINS an SOS case: subscribe to the private room, publish self as a
  // live member, flip the public signal to "active". Joining is what reveals the
  // aid card (the private room) — there is no separate accept/dispatch step.
  const joinSosCase: AppState['joinSosCase'] = (sosId) => {
    const sos = sosSessions.find((x) => x.id === sosId);
    const loc = selfLocation ?? selfResponder?.location ?? { lng: 103.8198, lat: 1.3521 };
    const eta = sos ? etaFromDistanceKm(getDistanceKm(loc, sos.location)) : undefined;
    csot.subscribeTopic(`csot/case/${sosId}/#`);
    csot.publishTopic(`csot/case/${sosId}/member/${selfResponderId}`, {
      id: selfResponderId,
      name: selfName || 'Responder',
      role: 'responder',
      proficiencies: selfResponder?.proficiencies ?? [],
      location: loc,
      status: 'en_route',
      eta,
      joinedAt: Date.now(),
    } satisfies CaseMember);
    setJoinedCaseIds((prev) => new Set(prev).add(sosId));
    patchResponder(selfResponderId, (r) => ({ ...r, status: 'en_route', assignedSosId: sosId }));
    patchSos(sosId, (x) => ({
      ...x,
      status: 'active',
      memberCount: csot.collectionByPrefix(`csot/case/${sosId}/member/`).length,
    }));
    pushLog({
      actorId: selfResponderId,
      actorRole: 'responder',
      action: 'sos.joined',
      targetId: sosId,
      message: `${selfName || 'A responder'} joined the ${sos?.category ?? 'SOS'} case.`,
      severity: 4,
      visibleTo: ['ops', 'responder', 'citizen'],
    });
  };

  const leaveSosCase: AppState['leaveSosCase'] = (sosId) => {
    csot.removeTopic(`csot/case/${sosId}/member/${selfResponderId}`);
    csot.unsubscribeTopic(`csot/case/${sosId}/#`);
    setJoinedCaseIds((prev) => { const n = new Set(prev); n.delete(sosId); return n; });
    patchResponder(selfResponderId, (r) => ({ ...r, status: 'ready', assignedSosId: undefined }));
    patchSos(sosId, (x) => {
      const remaining = csot.collectionByPrefix(`csot/case/${sosId}/member/`).length;
      return { ...x, memberCount: remaining, status: remaining === 0 && x.status === 'active' ? 'requesting' : x.status };
    });
    pushLog({
      actorId: selfResponderId,
      actorRole: 'responder',
      action: 'sos.left',
      targetId: sosId,
      message: `${selfName || 'A responder'} left the case.`,
      severity: 2,
      visibleTo: ['ops', 'responder', 'citizen'],
    });
  };

  // A joined responder marks themselves on scene.
  const markArrived: AppState['markArrived'] = (sosId) => {
    const me = csot
      .collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`)
      .find((m) => m.id === selfResponderId);
    if (!me) return;
    csot.publishTopic(`csot/case/${sosId}/member/${selfResponderId}`, { ...me, status: 'arrived', eta: 'now' });
    patchResponder(selfResponderId, (r) => ({ ...r, status: 'on_scene' }));
  };

  // Group chat shared by the owner + joined responders — published into the
  // private case room, so only participants (and ops) ever receive it.
  const sendCaseChat: AppState['sendCaseChat'] = (sosId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const mid = newId('MSG');
    csot.publishTopic(`csot/case/${sosId}/chat/${mid}`, {
      id: mid,
      caseId: sosId,
      authorId: selfResponderId,
      authorName: selfName || (role === 'citizen' ? 'You' : 'Responder'),
      authorRole: role,
      kind: 'message',
      text: trimmed,
      ts: Date.now(),
    } satisfies ChatEntry);
  };

  function teardownCaseRoom(sosId: string) {
    for (const m of csot.collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`)) {
      csot.removeTopic(`csot/case/${sosId}/member/${m.id}`);
    }
    for (const ch of csot.collectionByPrefix<ChatEntry>(`csot/case/${sosId}/chat/`)) {
      csot.removeTopic(`csot/case/${sosId}/chat/${ch.id}`);
    }
    csot.removeTopic(`csot/case/${sosId}/info`);
    csot.unsubscribeTopic(`csot/case/${sosId}/#`);
  }

  // Dual-ack resolution: the citizen taps "I'm safe", a responder taps
  // "Resolved". When both have, the case closes and the private room is torn down.
  const confirmSosSafe: AppState['confirmSosSafe'] = (sosId, by) => {
    const sos = sosSessions.find((s) => s.id === sosId);
    if (!sos) return;
    const nextCitizen = by === 'citizen' ? true : !!sos.citizenConfirmedSafe;
    const nextResponder = by === 'responder' ? true : !!sos.responderConfirmedSafe;
    const resolved = nextCitizen && nextResponder;
    patchSos(sosId, (s) => ({
      ...s,
      status: resolved ? 'resolved' : s.status,
      citizenConfirmedSafe: nextCitizen,
      responderConfirmedSafe: nextResponder,
      finalReport: resolved ? 'Citizen and a responder both confirmed safe.' : s.finalReport,
    }));
    if (resolved) {
      for (const m of csot.collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`)) {
        patchResponder(m.id, (r) => (r.assignedSosId === sosId ? { ...r, status: 'ready', assignedSosId: undefined } : r));
      }
      teardownCaseRoom(sosId);
    }
    pushLog({
      actorId: selfResponderId,
      actorRole: by,
      action: 'sos.completion_ack',
      targetId: sosId,
      message: `${by} confirmed safe. ${resolved ? 'Case resolved.' : 'Waiting for the other side.'}`,
      severity: resolved ? 2 : 4,
      visibleTo: ['ops', 'responder', 'citizen'],
    });
  };

  const cancelSos: AppState['cancelSos'] = (sosId) => {
    patchSos(sosId, (s) => ({ ...s, status: 'cancelled' }));
    for (const m of csot.collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`)) {
      patchResponder(m.id, (r) => (r.assignedSosId === sosId ? { ...r, status: 'ready', assignedSosId: undefined } : r));
    }
    teardownCaseRoom(sosId);
    pushLog({
      actorId: selfResponderId,
      actorRole: 'citizen',
      action: 'sos.cancelled',
      targetId: sosId,
      message: `${sosId} cancelled by the citizen.`,
      visibleTo: ['ops', 'responder', 'citizen'],
    });
  };

  // Private case-room reads. Only populated for clients subscribed to the room
  // (the owner + joined responders + ops) — empty for everyone else.
  const caseMembers: AppState['caseMembers'] = (sosId) =>
    csot
      .collectionByPrefix<CaseMember>(`csot/case/${sosId}/member/`)
      .filter((m) => m && m.id)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  const caseChat: AppState['caseChat'] = (sosId) =>
    csot.collectionByPrefix<ChatEntry>(`csot/case/${sosId}/chat/`).sort((a, b) => a.ts - b.ts);
  const caseDetails: AppState['caseDetails'] = (sosId) =>
    csot.collectionByPrefix<SosCaseDetails>(`csot/case/${sosId}/info`)[0];

  const updateSelfProfile: AppState['updateSelfProfile'] = (patch) => {
    const id = csot.identity?.userId;
    if (!id) return;
    const cur = csot.collection<AppUser>('network', 'user').find((u) => u.id === id);
    if (cur) csot.put('network', 'user', id, { ...cur, ...patch });
  };

  const sendChat: AppState['sendChat'] = (caseId, authorId, text) => {
    const id = newId('CH');
    putChat({ id, caseId, authorId, kind: 'message', text, ts: Date.now() });
    if (text.toLowerCase().startsWith('/host')) {
      setTimeout(() => askHost(caseId, text), 400);
    }
  };

  const fallbackHost = (query: string, caseId: string): Pick<ChatEntry, 'text' | 'chips'> => {
    const q = query.toLowerCase();
    const caseRoom = cases.find((c) => c.id === caseId);
    const caseMembers = caseRoom ? responders.filter((r) => caseRoom.members.includes(r.id)) : [];
    const caseEvent = events.find((e) => e.caseId === caseId);

    // /host status
    if (q.includes('status') && !q.includes('formation')) {
      if (!caseRoom) return { text: 'Case state unavailable.', chips: [{ label: 'tool: case_state', ref: 'unavailable' }] };
      const onScene = caseMembers.filter((r) => r.status === 'on_scene').length;
      const enRoute = caseMembers.filter((r) => r.status === 'en_route').length;
      return {
        text: `${caseRoom.name} · ${caseRoom.state} · sev ${caseRoom.severity} · ${caseMembers.length} members · ${onScene} on scene · ${enRoute} en route.`,
        chips: [{ label: 'tool: case_state', ref: caseRoom.state }, { label: 'tool: roster', ref: `${caseMembers.length}` }],
      };
    }

    // /host route <m> to <p>
    if (q.includes('route')) {
      if (!caseRoom) return { text: 'Route unavailable: no active case.', chips: [{ label: 'tool: route', ref: 'unavailable' }] };
      const target = caseRoom.centroid;
      const lines = caseMembers.map((r) => {
        const km = getDistanceKm(r.location, target);
        return `${r.name}: ${km.toFixed(2)} km · ETA ${etaMinutes(km)} min to case centroid.`;
      });
      return {
        text: lines.length ? `Routes to ${caseRoom.name}:\n${lines.join('\n')}` : 'No members assigned to route.',
        chips: [{ label: 'tool: route', ref: 'haversine' }],
      };
    }

    // /host nearest aed — honest stub
    if (q.includes('aed') || (q.includes('nearest') && !q.includes('hospital'))) {
      return { text: 'Nearest AED: unavailable. OneMap AED theme not yet wired.', chips: [{ label: 'tool: onemap_theme', ref: 'unavailable' }] };
    }

    // /host hospital load — honest stub
    if (q.includes('hospital')) {
      return { text: 'Hospital A&E load: unavailable. No live MOH/hospital source wired.', chips: [{ label: 'tool: hospital_load', ref: 'unavailable' }] };
    }

    // /host weather
    if (q.includes('weather') || q.includes('psi')) {
      const psi = liveSnapshot?.psi[0];
      return {
        text: psi ? `PSI national ${psi.psi24h}. Air quality ${(psi.psi24h ?? 0) < 55 ? 'good' : 'moderate'}. Source: NEA live.` : 'NEA PSI: unavailable. Live fetch not configured.',
        chips: [{ label: 'tool: nea_psi', ref: psi ? 'live' : 'unavailable' }],
      };
    }

    // /host check <m>
    if (q.includes('check')) {
      const tokens = q.replace('/host', '').replace('check', '').trim().split(/\s+/).filter(Boolean);
      const found = caseMembers.find((r) => tokens.some((t) => r.name.toLowerCase().includes(t) || r.id.toLowerCase().includes(t)));
      if (!found) return { text: 'Check: member not found in this case roster.', chips: [{ label: 'tool: roster', ref: 'no_match' }] };
      return {
        text: `${found.name} (${found.org}) · ${found.status} · loc ${found.location.lat.toFixed(4)},${found.location.lng.toFixed(4)} · last beat: unavailable (no heartbeat source).`,
        chips: [{ label: 'tool: roster', ref: found.status }],
      };
    }

    // /host suggest formation
    if (q.includes('formation') || q.includes('suggest')) {
      if (!caseRoom) return { text: 'Formation suggestion unavailable: no active case.', chips: [{ label: 'tool: formation', ref: 'unavailable' }] };
      const roleCounts: Record<string, number> = {};
      caseMembers.forEach((r) => { roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1; });
      const roster = Object.entries(roleCounts).map(([k, v]) => `${k}:${v}`).join(' · ') || 'empty';
      const need: string[] = [];
      if (caseEvent?.kind === 'fire' && !roleCounts.fire) need.push('fire');
      if (caseEvent?.kind === 'medical' && !roleCounts.medic) need.push('medic');
      if (!roleCounts.medic && (caseRoom.severity >= 3)) need.push('medic');
      return {
        text: `Roster: ${roster}. ${need.length ? `Suggest add: ${need.join(', ')}.` : 'Composition acceptable for current case kind.'}`,
        chips: [{ label: 'tool: formation', ref: need.length ? 'gap' : 'ok' }],
      };
    }

    // /host new pings?
    if (q.includes('ping') || q.includes('new')) {
      const open = sosSessions.filter((s) => !['resolved', 'cancelled'].includes(s.status) && (s.memberCount ?? 0) === 0);
      if (!caseRoom || open.length === 0) {
        return { text: open.length === 0 ? 'No unassigned SOS pings.' : 'No active case to compare against.', chips: [{ label: 'tool: sos_queue', ref: `${open.length}` }] };
      }
      const sorted = open
        .map((s) => ({ s, km: getDistanceKm(s.location, caseRoom.centroid) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 3);
      const lines = sorted.map(({ s, km }) => `${s.id} · ${s.category} · ${km.toFixed(1)} km from case`);
      return { text: `Open pings near ${caseRoom.name}:\n${lines.join('\n')}`, chips: [{ label: 'tool: sos_queue', ref: `${open.length}` }] };
    }

    // /host playback 5m
    if (q.includes('playback')) {
      const cutoff = Date.now() - 5 * 60_000;
      const recent = chat.filter((c) => c.caseId === caseId && c.ts >= cutoff);
      if (recent.length === 0) return { text: 'No chat activity in last 5 min.', chips: [{ label: 'tool: chat_log', ref: '0' }] };
      const lines = recent.slice(-6).map((c) => {
        const author = c.authorId === 'host' ? 'Host' : c.authorId === 'ops' ? 'Ops' : (responders.find((r) => r.id === c.authorId)?.name ?? c.authorId);
        return `${author}: ${c.text.slice(0, 80)}`;
      });
      return { text: `Last 5 min (${recent.length} entries):\n${lines.join('\n')}`, chips: [{ label: 'tool: chat_log', ref: `${recent.length}` }] };
    }

    // /host escalate?
    if (q.includes('escalate')) {
      if (!caseRoom) return { text: 'Escalation assessment unavailable: no active case found.', chips: [{ label: 'tool: case_state', ref: 'unavailable' }] };
      const openSos = sosSessions.filter((s) => !['resolved', 'cancelled'].includes(s.status)).length;
      const decision = caseRoom.severity >= 4 || openSos >= 3 ? 'YES' : 'NO';
      const why = caseRoom.severity >= 4 ? `severity ${caseRoom.severity} ≥ 4` : openSos >= 3 ? `${openSos} open SOS pings` : `severity ${caseRoom.severity} below threshold; ${openSos} open pings`;
      return { text: `${decision}. Rationale: ${why}.`, chips: [{ label: 'tool: case_state', ref: caseRoom.state }] };
    }

    // /host pause watchdog 10m — captain-only acknowledgement; no real watchdog wired
    if (q.includes('pause') || q.includes('watchdog')) {
      const isCaptain = caseRoom?.captain === selfResponderId;
      if (!isCaptain) return { text: 'Pause watchdog: captain-only command.', chips: [{ label: 'tool: watchdog', ref: 'denied' }] };
      const until = new Date(Date.now() + 10 * 60_000).toLocaleTimeString();
      return { text: `Watchdog mute acknowledged until ${until}. (Local-only; no proactive watchdog yet wired.)`, chips: [{ label: 'tool: watchdog', ref: 'muted_local' }] };
    }

    // /host draft aar
    if (q.includes('aar')) {
      if (!caseRoom) return { text: 'AAR draft unavailable: no case selected.', chips: [{ label: 'tool: aar', ref: 'unavailable' }] };
      const durationMin = Math.round((Date.now() - caseRoom.startedAt) / 60_000);
      const chatCount = chat.filter((c) => c.caseId === caseId).length;
      return {
        text: [
          `AAR draft · ${caseRoom.name}`,
          `Event: ${caseEvent?.title ?? 'unspecified'} (${caseEvent?.kind ?? 'n/a'})`,
          `Severity: ${caseRoom.severity} · State: ${caseRoom.state} · Duration: ${durationMin} min`,
          `Members (${caseMembers.length}): ${caseMembers.map((r) => r.name).join(', ') || 'none'}`,
          `Chat entries: ${chatCount}. Captain: ${responders.find((r) => r.id === caseRoom.captain)?.name ?? 'unassigned'}.`,
          `Outcomes / lessons: pending captain input.`,
        ].join('\n'),
        chips: [{ label: 'tool: aar', ref: 'draft' }],
      };
    }

    // /host help
    if (q.includes('help')) {
      return {
        text: 'Commands: /host status · /host route · /host nearest aed · /host hospital load · /host weather · /host check <member> · /host suggest formation · /host new pings? · /host playback 5m · /host escalate? · /host pause watchdog 10m · /host draft aar · /host help',
        chips: [],
      };
    }

    return { text: 'Host AI unavailable. Try /host help for commands.', chips: [{ label: 'tool: host_ai', ref: 'unavailable' }] };
  };

  const askHost: AppState['askHost'] = (caseId, query) => {
    const id = newId('CH');
    const caseRoom = cases.find((c) => c.id === caseId);
    const caseEvent = events.find((e) => e.caseId === caseId);
    const caseMembers = responders.filter((r) => caseRoom?.members.includes(r.id));
    const recentCutoff = Date.now() - 5 * 60_000;
    const recentChat = chat
      .filter((c) => c.caseId === caseId && c.ts >= recentCutoff)
      .slice(-8)
      .map((c) => ({ author: c.authorId, kind: c.kind, text: c.text.slice(0, 140), ts: c.ts }));
    const openSos = sosSessions
      .filter((s) => !['resolved', 'cancelled'].includes(s.status) && (s.memberCount ?? 0) === 0)
      .map((s) => ({ id: s.id, category: s.category, status: s.status, location: s.location }));
    askHostAi({
      role,
      workspace: 'case_lobby',
      prompt: query,
      context: {
        case: caseRoom,
        event: caseEvent,
        responders: caseMembers.map((r) => ({ id: r.id, name: r.name, status: r.status, role: r.role, location: r.location, org: r.org })),
        sos: openSos,
        chatRecent: recentChat,
        liveSnapshot: liveSnapshot ? { psi: liveSnapshot.psi?.[0] ?? null } : null,
        selfResponderId,
      },
    })
      .then((reply) => {
        const entry = reply.state === 'live'
          ? { text: reply.text, chips: reply.chips }
          : fallbackHost(query, caseId);
        putChat({ id, caseId, authorId: 'host', kind: 'host', ...entry, ts: Date.now() });
      })
      .catch(() => {
        const fallback = fallbackHost(query, caseId);
        putChat({ id, caseId, authorId: 'host', kind: 'host', text: fallback.text, chips: fallback.chips, ts: Date.now() });
      });
  };

  const updateResponderLocation: AppState['updateResponderLocation'] = (responderId, loc) => {
    patchResponder(responderId, (r) => ({ ...r, location: loc }));
  };

  const briefingInView = useMemo(
    () =>
      selectBriefingCounts({ events, sosSessions, reports, cases, notifications, role }).total,
    [events, reports, sosSessions, cases, notifications, role],
  );

  const value: AppState = {
    isAuthenticated,
    role,
    setRole,
    selfName,
    setSelfName,
    join,
    leave,
    pushNotification,
    sendBroadcast,
    declareNotice,
    declareInvestigate,
    declareCase,
    drawerContent,
    setDrawerContent,
    shellState,
    setShellState,
    events,
    reports,
    investigations,
    sosSessions,
    responders,
    users,
    selfUser,
    aidCard,
    updateAidCard,
    selfResponder,
    setDuty,
    setProficiencies,
    onlineIds,
    cases,
    chat,
    liveSnapshot,
    notifications,
    actionLogs,
    selectedId,
    setSelectedId,
    viewSosId,
    setViewSosId,
    activeCaseId,
    setActiveCaseId,
    tracking,
    setTracking,
    selectedMapItem,
    setSelectedMapItem,
    briefingInView,
    selfResponderId,
    fileReport,
    verifyReport,
    dismissReport,
    dispatchReport,
    resolveInvestigation,
    terminateSos,
    startSos,
    standDownSos,
    joinSosCase,
    leaveSosCase,
    markArrived,
    sendCaseChat,
    caseMembers,
    caseChat,
    caseDetails,
    joinedCaseIds,
    confirmSosSafe,
    cancelSos,
    resolveEvent: (eventId: string) => {
      // Mark resolved with a real retained message (not an empty-payload
      // tombstone) — the map-marker effect + ops console both filter out
      // 'resolved', so it disappears reliably on every client. Live weather
      // overlays regenerate from NEA each pull, so they aren't resolvable here.
      const ev = csot.collection<CanonicalEvent>('incidents', 'event').find((e) => e.id === eventId);
      if (ev) putEvent({ ...ev, status: 'resolved' });
    },
    updateSelfProfile,
    sendChat,
    askHost,
    ackNotification,
    selfLocation,
    setSelfLocation,
    selfPlaceName,
    updateResponderLocation,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
};
