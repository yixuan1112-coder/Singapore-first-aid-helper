// Relation tree for the Kampung Kaki CSOT.
// Single source — keep wireframe / docs / God Mode toolbar in sync with this.
//
// CLUSTER ROOTS
// ──────────────────────────────────────────────────────────────────────
//   intake        — citizen-originated signals (low trust until verified)
//   incidents     — ops-published canonical truth (events, zones)
//   operations    — live response work (cases, chat, responder positions)
//   network       — community + identity (users, groups, volunteer events)
//   intel         — situational awareness (sources, NEA snapshot, logs, notifications)
//   presentation  — ephemeral UI shell state (role, drawer, tracking pill)
//
// EDGES (read top-to-bottom; arrows show "becomes / triggers")
// ──────────────────────────────────────────────────────────────────────
//   intake.reports ──(ops.verify)──▶ incidents.events
//   intake.sos     ──(responder.accept)──▶ operations.assignment(sos↔responder)
//   intake.sos     ──(ops.escalate)──▶ operations.cases
//   incidents.events ──(ops.assignIncident)──▶ operations.cases ◀── operations.chat
//   incidents.zones (polygon) ──(declareZone)──▶ incidents.events
//   intel.liveSnapshot.psi ≥ 100 ──(auto)──▶ incidents.events  (id LIVE-PSI-*)
//   intel.liveSnapshot.rainfall > 1mm ──(auto)──▶ incidents.events  (id LIVE-RAIN-*)
//   network.groups.members[] ──▶ operations.responders[].groups[]
//   network.volunteerEvents.registeredResponderIds[] ──▶ operations.responders[]
//   any action ──▶ intel.actionLogs   +   intel.notifications (role-scoped)
//   presentation.role  ──drives──▶ visible workspaces, dock, leftrail
//
// HOST AI DISPATCH MATRIX  (role × workspace → system prompt + tool set)
// ──────────────────────────────────────────────────────────────────────
//   citizen × citizen_alert      → safety advisor (Situation/Do now/If worse)
//   citizen × citizen_assistant  → AI Kaki general help
//   responder × responder_case   → slash-aware case-room copilot
//   responder × responder_mission→ mission-board copilot (joinable + fit)
//   ops × ops_command            → dispatch + declaration copilot
//
// TOOLS the Host AI may call server-side (api/host/tools.js):
//   getLivePsi()                — NEA 24-hour PSI by region
//   getLiveRainfall(near?)      — NEA rainfall, optionally bounded by lng/lat km
//   getNearestAed(lng,lat)      — OneMap aed_locations theme
//   getNearestHospital(lng,lat) — OneMap moh_hospitals theme
//   getActiveSos()              — SOS that have not resolved/cancelled
//   getCaseRoster(caseId)       — case members + statuses
//   getResponderRoster()        — active responders summary
//
// Anything outside this matrix must say "unavailable" rather than invent.

export const CLUSTERS = [
  {
    id: 'intake',
    label: 'Intake',
    blurb: 'Citizen reports + SOS. Low trust until verified.',
    types: ['CitizenReport', 'DistressSession'],
  },
  {
    id: 'incidents',
    label: 'Incidents',
    blurb: 'Ops-published canonical events.',
    types: ['CanonicalEvent'],
  },
  {
    id: 'operations',
    label: 'Operations',
    blurb: 'Live response: case rooms, chat, responder positions.',
    types: ['CaseRoom', 'ChatEntry', 'Responder'],
  },
  {
    id: 'network',
    label: 'Network',
    blurb: 'Identity directory.',
    types: ['AppUser'],
  },
  {
    id: 'intel',
    label: 'Intel',
    blurb: 'NEA snapshot, action logs, notifications.',
    types: ['LiveSnapshot', 'ActionLog', 'NotificationNotice'],
  },
  {
    id: 'presentation',
    label: 'Presentation',
    blurb: 'Ephemeral shell + UI selection state.',
    types: ['Role', 'ShellState', 'TrackingState', 'SelectedMapItem'],
  },
] as const;

export type ClusterId = (typeof CLUSTERS)[number]['id'];

export const HOST_DISPATCH = [
  { role: 'citizen', workspace: 'citizen_alert', label: 'Citizen · safety advisor' },
  { role: 'citizen', workspace: 'citizen_assistant', label: 'Citizen · AI Kaki' },
  { role: 'responder', workspace: 'responder_case', label: 'Responder · case copilot' },
  { role: 'responder', workspace: 'responder_mission', label: 'Responder · mission copilot' },
  { role: 'ops', workspace: 'ops_command', label: 'Ops · command copilot' },
] as const;
