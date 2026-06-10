import { useState } from 'react';
import { HeartPulse, Flame, AlertOctagon, ShieldAlert, TriangleAlert, HelpCircle, X, Lock, Phone, Siren, Users, Search, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppContext, type SosCategory, type DistressSession, type Role, type InvestigationTask } from '../AppContext';
import { getDistanceKm } from '../utils/geo';
import CaseChat from './CaseChat';

const ICON: Record<SosCategory, typeof HeartPulse> = {
  medical: HeartPulse, fire: Flame, trapped: AlertOctagon, threat: ShieldAlert, hazard: TriangleAlert, other: HelpCircle,
};
const LABEL: Record<SosCategory, string> = {
  medical: 'Medical', fire: 'Fire', trapped: 'Trapped', threat: 'Threat', hazard: 'Hazard', other: 'Other',
};
const ROLE_LABEL: Record<Role, string> = { citizen: 'Citizen', responder: 'Responder', ops: 'Ops' };

// Responders within this radius of an SOS get the convenience "Join?" nudge.
const RECOMMEND_KM = 2;

function waitedMin(s: DistressSession): number {
  return Math.max(0, Math.round((Date.now() - s.startedAt) / 60000));
}

export default function ResponderSos() {
  const { role, selfResponder, selfResponderId, sosSessions, joinedCaseIds, viewSosId, setViewSosId, investigations } = useAppContext();
  const [listOpen, setListOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  if (role !== 'responder' && role !== 'ops') return null;
  const isOps = role === 'ops';

  const origin = selfResponder?.location ?? { lng: 103.8198, lat: 1.3521 };
  const onDuty = selfResponder?.onDuty ?? false;
  const myProfs = selfResponder?.proficiencies ?? [];
  const joined = (s: DistressSession) => joinedCaseIds.has(s.id);
  // Skills decide WHO gets the priority page. If you declared proficiencies you're
  // nudged only for matching categories (or 'other'); declare none and you're
  // treated as a generalist (paged for everything). Either way anyone can still
  // JOIN any SOS from the queue — skills gate the urgent nudge, not access.
  const skillMatch = (s: DistressSession) =>
    myProfs.length === 0 || s.category === 'other' || myProfs.includes(s.category);
  // Am I being recommended to this SOS? On-duty, within 2km, skill-matched, not
  // already joined.
  const recommendedForMe = (s: DistressSession) =>
    role === 'responder' && onDuty && !joined(s) && s.status !== 'resolved' && s.status !== 'cancelled' &&
    skillMatch(s) && getDistanceKm(origin, s.location) <= RECOMMEND_KM;

  const active = sosSessions
    .filter((s) => !['resolved', 'cancelled'].includes(s.status))
    .map((s) => ({ s, km: getDistanceKm(origin, s.location) }))
    .sort((a, b) => {
      const ar = recommendedForMe(a.s) ? 0 : 1;
      const br = recommendedForMe(b.s) ? 0 : 1;
      return ar - br || a.km - b.km;
    });

  const myRecs = active.filter((x) => recommendedForMe(x.s));
  const viewing = active.find((x) => x.s.id === viewSosId)?.s ?? sosSessions.find((s) => s.id === viewSosId) ?? null;

  // Investigations ops dispatched to me (non-emergency reports). Responder only.
  const myTasks = isOps ? [] : investigations.filter((t) => t.assignedTo === selfResponderId && t.status === 'open');
  const viewingTask = investigations.find((t) => t.id === taskId) ?? null;
  const totalQueue = active.length + myTasks.length;

  return (
    <>
      {/* Nearby-help nudge — bottom-centre action bar, clear of the duty controls
          (top-centre) and the queue dropdown (top-right). */}
      {myRecs.length > 0 && !viewing && (
        <button
          onClick={() => setViewSosId(myRecs[0].s.id)}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100vw-2rem)] flex items-center gap-2.5 pl-4 pr-5 h-12 rounded-full bg-accent-critical text-white shadow-lg animate-pulse hover:animate-none hover:brightness-110 transition"
        >
          <Siren className="w-4 h-4 shrink-0" />
          <span className="text-sm font-bold whitespace-nowrap">
            Someone nearby needs help · {LABEL[myRecs[0].s.category]}
            {myRecs.length > 1 ? ` +${myRecs.length - 1}` : ''}
          </span>
          <span className="text-[11px] font-semibold opacity-90 whitespace-nowrap">{myRecs[0].km.toFixed(1)} km</span>
        </button>
      )}

      {/* Responder queue = a collapsible dropdown under the profile circle (ops
          uses the separate Ops console). Two sections: nearby SOS +
          investigations dispatched to me. Default collapsed so it never blocks. */}
      {!isOps && totalQueue > 0 && (
        <div className="absolute top-16 right-4 z-20 w-72 max-w-[calc(100vw-2rem)]">
          <button
            onClick={() => setListOpen((v) => !v)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 bg-surface-0 border border-border-strong shadow-lg text-text-primary ${listOpen ? 'rounded-t-xl' : 'rounded-xl'}`}
          >
            <Siren className="w-4 h-4" />
            <span className="text-xs font-bold tracking-wide flex-1 text-left">Your queue</span>
            <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${myRecs.length > 0 ? 'bg-accent-critical text-white' : 'bg-surface-2 text-text-secondary'}`}>{totalQueue}</span>
            {listOpen ? <ChevronUp className="w-3.5 h-3.5 text-text-secondary" /> : <ChevronDown className="w-3.5 h-3.5 text-text-secondary" />}
          </button>
          {listOpen && (
            <div className="max-h-[70vh] overflow-y-auto bg-surface-0 border border-t-0 border-border-strong rounded-b-xl shadow-xl">
              {active.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase font-bold tracking-widest text-accent-critical">Nearby SOS · {active.length}</div>
                  <div className="divide-y divide-border-soft">
                    {active.map(({ s, km }) => {
                      const Icon = ICON[s.category];
                      const rec = recommendedForMe(s);
                      return (
                        <button key={s.id} onClick={() => setViewSosId(s.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2 ${rec ? 'bg-accent-critical/5' : ''}`}>
                          <span className="w-8 h-8 rounded-full bg-accent-critical/10 text-accent-critical flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-text-primary">{LABEL[s.category]}</span>
                            <span className="block text-[11px] text-text-secondary">{km.toFixed(1)} km · {(s.memberCount ?? 0)} responding</span>
                          </span>
                          {joined(s) && <span className="text-[9px] font-bold uppercase text-accent-success">joined</span>}
                          {!joined(s) && rec && <span className="text-[9px] font-bold uppercase text-white bg-accent-critical rounded px-1.5 py-0.5">Near</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {myTasks.length > 0 && (
                <div className="border-t border-border-soft">
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase font-bold tracking-widest text-text-secondary">Investigations · {myTasks.length}</div>
                  <div className="divide-y divide-border-soft">
                    {myTasks.map((t) => (
                      <button key={t.id} onClick={() => setTaskId(t.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                        <span className="w-8 h-8 rounded-full bg-surface-2 text-text-secondary flex items-center justify-center shrink-0"><Search className="w-4 h-4" /></span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-text-primary truncate">{t.title}</span>
                          <span className="block text-[11px] text-text-secondary capitalize">{t.kind} · from ops</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {viewing && (
        <SosDetail s={viewing} isOps={isOps} recommended={recommendedForMe(viewing)} kmAway={getDistanceKm(origin, viewing.location)} />
      )}
      {viewingTask && viewingTask.assignedTo === selfResponderId && (
        <TaskDetail t={viewingTask} onClose={() => setTaskId(null)} />
      )}
    </>
  );
}

// ── overlays (module scope so they never remount on a parent re-render —
//    nesting them inside ResponderSos was wiping in-progress chat/textarea state
//    every time CSOT ticked) ────────────────────────────────────────────────

function SosDetail({ s, isOps, recommended, kmAway }: { s: DistressSession; isOps: boolean; recommended: boolean; kmAway: number }) {
  const { role, joinedCaseIds, setViewSosId, joinSosCase, terminateSos, standDownSos } = useAppContext();
  const Icon = ICON[s.category];
  const amMember = joinedCaseIds.has(s.id);
  // Aid card + contact + chat live in the PRIVATE room — only the owner and
  // joined responders are subscribed. Ops oversees all.
  const inRoom = isOps || amMember;

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setViewSosId(null)}>
      <div className="w-full sm:max-w-md h-full bg-surface-0 flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 px-5 h-14 border-b border-border-soft shrink-0">
          <span className="w-9 h-9 rounded-full bg-accent-critical text-white flex items-center justify-center"><Icon className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-text-primary">{LABEL[s.category]} SOS</div>
            <div className="text-[11px] text-text-secondary">{isOps ? `${waitedMin(s)}m waiting` : `${kmAway.toFixed(1)} km away`} · {(s.memberCount ?? 0)} responding</div>
          </div>
          <button onClick={() => setViewSosId(null)} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {recommended && (
            <div className="rounded-xl bg-accent-critical/10 text-accent-critical px-3 py-2.5 flex items-center gap-2">
              <Siren className="w-4 h-4 shrink-0" />
              <span className="text-xs font-bold">You're nearby and on duty — join to help {s.citizenName}.</span>
            </div>
          )}
          <Row label="Who">{s.citizenName}</Row>
          <Row label="Location">{s.location.lat.toFixed(4)}°N {s.location.lng.toFixed(4)}°E</Row>
          {s.details && <Row label="What's happening">{s.details}</Row>}

          {!inRoom ? (
            <div className="rounded-xl border border-border-soft bg-surface-1 p-4 flex items-start gap-3">
              <Lock className="w-4 h-4 text-text-secondary mt-0.5 shrink-0" />
              <p className="text-xs text-text-secondary leading-relaxed">
                Contact and aid card are shared with you once you join this case.
              </p>
            </div>
          ) : (
            <CaseDetail sosId={s.id} />
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border-soft shrink-0">
          {role === 'responder' && !amMember && (
            <button onClick={() => joinSosCase(s.id)} className="w-full h-11 rounded-lg bg-accent-critical text-white font-semibold text-sm flex items-center justify-center gap-2">
              <Users className="w-4 h-4" /> Join &amp; help
            </button>
          )}
          {role === 'responder' && amMember && <MemberActions sosId={s.id} />}
          {isOps && (
            <div className="flex items-center gap-2">
              {/* Stand down = handled/resolved (the clean close, esp. for ops-declared
                  cases that have no citizen to complete the dual-ack). Terminate =
                  fake/unneeded. */}
              <button
                onClick={() => { standDownSos(s.id); setViewSosId(null); }}
                className="flex-1 h-11 rounded-lg bg-accent-success text-white font-semibold text-sm flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Stand down
              </button>
              <button
                onClick={() => { terminateSos(s.id, 'fake or unneeded'); setViewSosId(null); }}
                className="h-11 px-3 rounded-lg border border-border-strong text-accent-critical font-semibold text-sm"
              >
                Terminate
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

// Private-room body: contact + aid card + live members (by role+skills) + chat.
function CaseDetail({ sosId }: { sosId: string }) {
  const { caseDetails, caseMembers } = useAppContext();
  const info = caseDetails(sosId);
  const members = caseMembers(sosId);
  const chips = (arr?: string[]) => (arr && arr.length ? arr.join(', ') : '—');
  return (
    <div className="space-y-4">
      {info?.phone && (
        <Row label="Contact">
          <a href={`tel:${info.phone}`} className="inline-flex items-center gap-1 text-accent-info"><Phone className="w-3.5 h-3.5" />{info.phone}</a>
        </Row>
      )}
      {info?.aidCard ? (
        <div className="rounded-xl border border-border-soft bg-surface-1 p-4 space-y-2">
          <div className="text-xs font-bold text-text-primary">Aid card</div>
          <Mini label="Allergies" value={info.aidCard.allergies || '—'} />
          <Mini label="Conditions" value={chips(info.aidCard.conditions)} />
          <Mini label="Carries" value={chips(info.aidCard.carries)} />
          <Mini label="Access" value={chips(info.aidCard.access)} />
          <Mini label="Language" value={info.aidCard.language || '—'} />
          {info.aidCard.nokName && <Mini label="Next of kin" value={`${info.aidCard.nokName}${info.aidCard.nokPhone ? ` · ${info.aidCard.nokPhone}` : ''}`} />}
        </div>
      ) : (
        <Row label="Aid card">Not provided.</Row>
      )}
      <div>
        <div className="text-[11px] uppercase font-bold tracking-widest text-text-secondary mb-1.5">On this case · {members.length}</div>
        <div className="space-y-1.5">
          {members.length === 0 && <p className="text-xs text-text-secondary">No one has joined yet.</p>}
          {members.map((m) => {
            const arrived = m.status === 'arrived';
            const skills = m.proficiencies?.length ? m.proficiencies.map((p) => LABEL[p]).join(', ') : null;
            return (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${arrived ? 'bg-accent-success' : 'bg-accent-info'}`} />
                <span className="flex-1 min-w-0">
                  <span className="text-text-primary font-semibold">{m.name || ROLE_LABEL[m.role] || 'Responder'}</span>
                  <span className="text-[11px] text-text-secondary"> · {ROLE_LABEL[m.role] ?? 'Responder'}{skills ? ` · ${skills}` : ''}</span>
                </span>
                <span className="text-[11px] text-text-secondary shrink-0">{arrived ? 'on scene' : m.eta ? `ETA ${m.eta}` : 'en route'}</span>
              </div>
            );
          })}
        </div>
      </div>
      <CaseChat sosId={sosId} />
    </div>
  );
}

function MemberActions({ sosId }: { sosId: string }) {
  const { caseMembers, markArrived, confirmSosSafe, leaveSosCase, sosSessions, selfResponderId } = useAppContext();
  const me = caseMembers(sosId).find((m) => m.id === selfResponderId);
  const sos = sosSessions.find((x) => x.id === sosId);
  return (
    <div className="flex gap-2">
      {me?.status !== 'arrived' && (
        <button onClick={() => markArrived(sosId)} className="flex-1 h-11 rounded-lg bg-surface-3 text-text-inverse font-semibold text-sm">On scene</button>
      )}
      {me?.status === 'arrived' && (
        <button onClick={() => confirmSosSafe(sosId, 'responder')} disabled={sos?.responderConfirmedSafe} className="flex-1 h-11 rounded-lg bg-accent-success text-white font-semibold text-sm disabled:opacity-50">
          {sos?.responderConfirmedSafe ? 'Waiting on citizen' : 'Resolved'}
        </button>
      )}
      <button onClick={() => leaveSosCase(sosId)} className="h-11 px-3 rounded-lg border border-border-strong text-text-secondary font-semibold text-sm">Leave</button>
    </div>
  );
}

// Investigation task ops dispatched to this responder — close it with an outcome.
function TaskDetail({ t, onClose }: { t: InvestigationTask; onClose: () => void }) {
  const { resolveInvestigation } = useAppContext();
  const [outcome, setOutcome] = useState('');
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:max-w-md h-full bg-surface-0 flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 px-5 h-14 border-b border-border-soft shrink-0">
          <span className="w-9 h-9 rounded-full bg-surface-2 text-text-primary flex items-center justify-center"><Search className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-text-primary truncate">{t.title}</div>
            <div className="text-[11px] text-text-secondary capitalize">{t.kind} · investigation</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {t.body && (
            <div>
              <div className="text-[11px] uppercase font-bold tracking-widest text-text-secondary">What ops flagged</div>
              <div className="mt-0.5 text-sm text-text-primary">{t.body}</div>
            </div>
          )}
          <div>
            <div className="text-[11px] uppercase font-bold tracking-widest text-text-secondary">Location</div>
            <div className="mt-0.5 text-sm text-text-primary">{t.location.lat.toFixed(4)}°N {t.location.lng.toFixed(4)}°E</div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Outcome</span>
            <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={3} placeholder="What did you find? e.g. cleared, escalated, nothing there"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary resize-none" />
          </label>
        </div>
        <footer className="px-5 py-3 border-t border-border-soft shrink-0">
          <button onClick={() => { resolveInvestigation(t.id, outcome.trim() || 'Resolved'); onClose(); }}
            className="w-full h-11 rounded-lg bg-accent-success text-white font-semibold text-sm flex items-center justify-center gap-2">
            <Check className="w-4 h-4" /> Close investigation
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase font-bold tracking-widest text-text-secondary">{label}</div>
      <div className="mt-0.5 text-sm text-text-primary">{children}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-text-secondary w-20 shrink-0">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}
