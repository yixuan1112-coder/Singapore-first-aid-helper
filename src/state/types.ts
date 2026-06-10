// Domain types for Kampung Kaki, grouped by cluster.
// Clusters reflect the CSOT relation tree — see ./relations.ts.

/** L1–L5 severity used across events/reports/notifications. */
export type SeverityLevel = 1 | 2 | 3 | 4 | 5;

export type Role = 'citizen' | 'responder' | 'ops';
export type ShellState = 'S0' | 'S2' | 'S4' | 'S6' | 'S9';
export type HostWorkspace =
  | 'citizen_alert'
  | 'citizen_assistant'
  | 'responder_case'
  | 'responder_mission'
  | 'ops_command';

export interface LngLat {
  lng: number;
  lat: number;
}

// ──────────────────────────────────────────────────────────────────────
// CLUSTER · intake  (citizen-originated signals)
// reports → (ops verify) → incidents
// sos → (responder accept) → assignment
// ──────────────────────────────────────────────────────────────────────

export interface CitizenReport {
  id: string;
  kind: CanonicalEvent['kind'];
  title: string;
  body: string;
  location: LngLat;
  /** CSOT userId of the reporter — scopes the topic so only they + ops see it. */
  ownerId?: string;
  reporterTrust: number;
  status: 'pending' | 'claimed' | 'verified' | 'dismissed' | 'investigating' | 'resolved';
  claimedBy?: string;
  /** Set when ops dispatches the report to a responder to investigate. */
  assignedInvestigatorId?: string;
  investigatorName?: string;
  createdAt: number;
  promotedToEventId?: string;
  notifiedReporter?: boolean;
  auditTrail?: string[];
}

// An investigation a responder was dispatched to by ops (for non-emergency
// reports). Lives in the operations cluster so the assigned responder + ops see
// it; carries the report details so the responder needn't read the raw report.
export interface InvestigationTask {
  id: string;        // = reportId
  reportId: string;
  assignedTo: string;
  assignedName?: string;
  kind: CanonicalEvent['kind'];
  title: string;
  body: string;
  location: LngLat;
  status: 'open' | 'resolved';
  createdAt: number;
  outcome?: string;
}

// The kinds of help an SOS can need. A responder declares which of these they
// can handle (proficiencies); paging matches the SOS category against them.
export type SosCategory = 'medical' | 'fire' | 'trapped' | 'threat' | 'hazard' | 'other';

// The PUBLIC SOS signal — the discoverable call for help. Responders + ops see
// it (to decide whether to join); other citizens never receive it (owner-scoped
// topic). It deliberately carries NO aid card / phone — those are private to the
// case room and revealed only to responders who JOIN.
export interface DistressSession {
  id: string;
  /** CSOT userId of the citizen in distress — scopes the topic so only they +
   *  responders/ops receive it; other citizens never see another's SOS. */
  ownerId?: string;
  citizenName: string;
  category: SosCategory;
  /** One line of context the citizen types when sending. */
  details?: string;
  location: LngLat;
  /** requesting = open, no responder yet; active = ≥1 responder joined. */
  status: 'requesting' | 'active' | 'resolved' | 'cancelled';
  /** How many responders have joined — carried on the signal so non-member
   *  responders/ops see traction without the private member list. */
  memberCount?: number;
  startedAt: number;
  citizenConfirmedSafe?: boolean;
  responderConfirmedSafe?: boolean;
  finalReport?: string;
}

// A responder who JOINED an SOS case. Lives in the PRIVATE case room
// (csot/case/<caseId>/member/<id>) — visible only to the owner + joined
// responders (+ ops oversight), never to other citizens or non-joined responders.
export interface CaseMember {
  id: string;
  name: string;
  /** What this person IS on the case — people coordinate by role+skills, not names. */
  role: Role;
  proficiencies?: SosCategory[];
  location: LngLat;
  status: 'en_route' | 'arrived';
  eta?: string;
  joinedAt: number;
}

// Private case details, revealed to members on join (aid card + contact).
// Lives at csot/case/<caseId>/info.
export interface SosCaseDetails {
  ownerName: string;
  category: SosCategory;
  phone?: string;
  aidCard?: AidCard;
}

// ──────────────────────────────────────────────────────────────────────
// CLUSTER · incidents  (ops-published canonical truth)
// events ↔ zones (zones extend events with polygon area)
// events.caseId → operations.cases
// ──────────────────────────────────────────────────────────────────────

export interface CanonicalEvent {
  id: string;
  kind: 'fire' | 'flood' | 'medical' | 'crash' | 'hazard' | 'weather' | 'other';
  title: string;
  severity: SeverityLevel;
  status: 'provisional' | 'verified' | 'resolved';
  location: LngLat;
  area?: LngLat[];
  source: string;
  createdAt: number;
  caseId?: string;
  liveValue?: string;
  // Responder-initiated case-formation request. Set when a responder taps
  // "Request ops case" on the verified event; cleared when ops accepts
  // (case created via assignIncident) or declines.
  caseRequestedBy?: string;
  caseRequestedAt?: number;
}

// ──────────────────────────────────────────────────────────────────────
// CLUSTER · operations  (live response work)
// cases ↔ chat (chat[].caseId → cases.id)
// cases.members[] → responders[].id
// responders.assignedSosId → intake.sos.id
// ──────────────────────────────────────────────────────────────────────

export interface Responder {
  id: string;
  name: string;
  org: 'SCDF' | 'Volunteer' | 'SPF' | 'SAF' | 'Medic' | 'NEA' | 'LTA';
  role: 'medic' | 'fire' | 'search' | 'aux';
  status: 'ready' | 'en_route' | 'on_scene' | 'out' | 'offline';
  location: LngLat;
  assignedSosId?: string;
  groups: string[];
  unitType?: 'volunteer' | 'professional';
  /** Whether the responder is currently on shift — only on-duty responders are paged. */
  onDuty?: boolean;
  /** SOS categories this responder can handle — drives who gets paged. */
  proficiencies?: SosCategory[];
  demo?: boolean;
  covert?: boolean;
  note?: string;
}

export interface CaseRoom {
  id: string;
  name: string;
  severity: SeverityLevel;
  centroid: LngLat;
  members: string[];
  captain: string;
  state: 'forming' | 'staging' | 'active' | 'consolidating' | 'resolved';
  startedAt: number;
  source?: 'ops' | 'sos' | 'professional';
  restricted?: boolean;
  closure?: {
    responderAck?: boolean;
    citizenAck?: boolean;
    opsClosed?: boolean;
    finalReport?: string;
  };
}

export interface ChatEntry {
  id: string;
  caseId: string;
  authorId: string;
  /** Display name of the author, carried so readers needn't resolve the roster. */
  authorName?: string;
  /** Author's role — what readers actually identify each other by. */
  authorRole?: Role;
  kind: 'message' | 'system' | 'host' | 'voice';
  text: string;
  chips?: { label: string; ref: string }[];
  ts: number;
}

// ──────────────────────────────────────────────────────────────────────
// CLUSTER · network  (community + identity)
// users (identity), groups (org/capability cadres), volunteerEvents (planned)
// ──────────────────────────────────────────────────────────────────────

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  phone: string;
  primaryRole: Role;
  secondaryRole?: Role;
  address: string;
  skills: string[];
  available: boolean;
}

// First-aid "need to know" card every user fills once. NOT medical records —
// self-disclosed particulars a lay first-aider needs on scene. Stored private
// to the owner (csot/network/aidcard/<userId>); a snapshot is attached to an
// SOS and revealed only to ops + the responder who takes the mission.
export interface AidCard {
  userId: string;
  allergies: string;        // free text, e.g. "Penicillin, peanuts"
  conditions: string[];     // asthma / epilepsy / diabetic / heart / pregnant …
  carries: string[];        // inhaler / EpiPen / insulin / glucose …
  access: string[];         // wheelchair / hard of hearing / visually impaired …
  language: string;         // preferred language
  nokName: string;          // next of kin
  nokPhone: string;
  nokRelation: string;
  updatedAt: number;
}

// ──────────────────────────────────────────────────────────────────────
// CLUSTER · intel  (signals, logs, awareness)
// liveSnapshot (NEA), actionLogs (audit), notifications (push)
// ──────────────────────────────────────────────────────────────────────

export type NotificationTier = 'info' | 'watch' | 'urgent' | 'critical';

export interface NotificationNotice {
  id: string;
  /** 'broadcast' = an ops-authored area alert (vs incidental 'system' notices). */
  kind?: 'system' | 'broadcast';
  tier: NotificationTier;
  roles: Role[];
  title: string;
  body: string;
  /** Display scope of a broadcast — 'Islandwide' or a planning-area name. */
  area?: string;
  targetId?: string;
  createdAt: number;
  ackBy: string[];
}

export interface ActionLog {
  id: string;
  actorId: string;
  actorRole: Role | 'system';
  action: string;
  targetId: string;
  message: string;
  severity?: SeverityLevel;
  createdAt: number;
  visibleTo: Role[];
}

// ──────────────────────────────────────────────────────────────────────
// CLUSTER · presentation  (ephemeral shell + UI selection state)
// ──────────────────────────────────────────────────────────────────────

export interface TrackingState {
  kind: string;
  title: string;
  eta: string;
  progress?: number;
  tone?: 'critical' | 'warning' | 'neutral';
  drawerId?: string;
}

export interface SelectedMapItem {
  id: string;
  category: string;
  title: string;
  detail: string;
  source: string;
  lng: number;
  lat: number;
  tone?: string;
}
