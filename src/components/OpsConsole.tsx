import { useState } from 'react';
import { HeartPulse, Flame, AlertOctagon, ShieldAlert, TriangleAlert, HelpCircle, ClipboardList, X, Trash2, Send, Radar, ChevronDown, ChevronUp, MapPin, CheckCircle2 } from 'lucide-react';
import { useAppContext, type SosCategory, type CitizenReport } from '../AppContext';
import { getDistanceKm } from '../utils/geo';

const CAT_ICON: Record<SosCategory, typeof HeartPulse> = {
  medical: HeartPulse, fire: Flame, trapped: AlertOctagon, threat: ShieldAlert, hazard: TriangleAlert, other: HelpCircle,
};
const CAT_LABEL: Record<SosCategory, string> = {
  medical: 'Medical', fire: 'Fire', trapped: 'Trapped', threat: 'Threat', hazard: 'Hazard', other: 'Other',
};

function elapsed(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

// The ops console: one always-present, compact list of everything that needs
// attention — live SOS cases (tap → the shared SOS detail) and citizen reports
// (tap → triage: dispatch a responder to investigate, or dismiss).
export default function OpsConsole() {
  const { role, sosSessions, reports, events, resolveEvent, setViewSosId } = useAppContext();
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (role !== 'ops') return null;

  const liveSos = sosSessions
    .filter((s) => !['resolved', 'cancelled'].includes(s.status))
    .sort((a, b) => a.startedAt - b.startedAt);
  const openReports = reports
    .filter((r) => !['dismissed', 'resolved', 'verified'].includes(r.status))
    .sort((a, b) => a.createdAt - b.createdAt);
  // Declared incidents/notices on the map (excludes live NEA overlays + resolved)
  // — ops can stand each one down when it no longer applies.
  const notices = events
    .filter((e) => e.status !== 'resolved' && !e.id.startsWith('LIVE-'))
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = liveSos.length + openReports.length + notices.length;
  const viewingReport = reports.find((r) => r.id === openReportId) ?? null;

  return (
    <>
      <div className="absolute top-16 right-4 z-20 w-72 max-w-[calc(100vw-2rem)]">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`w-full flex items-center gap-2 px-3 py-2.5 bg-surface-0 border border-border-strong shadow-lg text-text-primary ${open ? 'rounded-t-xl' : 'rounded-xl'}`}
        >
          <Radar className="w-4 h-4" />
          <span className="text-xs font-bold tracking-wide flex-1 text-left">Ops</span>
          {total > 0 && (
            <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${liveSos.length > 0 ? 'bg-accent-critical text-white' : 'bg-surface-2 text-text-secondary'}`}>{total}</span>
          )}
          {open ? <ChevronUp className="w-3.5 h-3.5 text-text-secondary" /> : <ChevronDown className="w-3.5 h-3.5 text-text-secondary" />}
        </button>
        {open && (
        <div className="max-h-[70vh] overflow-y-auto bg-surface-0 border border-t-0 border-border-strong rounded-b-xl shadow-xl">
          {total === 0 && (
            <div className="px-3 py-6 text-center text-xs text-text-secondary">All clear — no live SOS or open reports.</div>
          )}

          {liveSos.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase font-bold tracking-widest text-accent-critical">SOS · {liveSos.length}</div>
              <div className="divide-y divide-border-soft">
                {liveSos.map((s) => {
                  const Icon = CAT_ICON[s.category];
                  return (
                    <button key={s.id} onClick={() => setViewSosId(s.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                      <span className="w-8 h-8 rounded-full bg-accent-critical/10 text-accent-critical flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-text-primary truncate">{CAT_LABEL[s.category]} · {s.citizenName}</span>
                        <span className="block text-[11px] text-text-secondary">{elapsed(s.startedAt)} · {(s.memberCount ?? 0)} responding</span>
                      </span>
                      {(s.memberCount ?? 0) === 0 && <span className="text-[9px] font-bold uppercase text-white bg-accent-critical rounded px-1.5 py-0.5">Open</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {openReports.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase font-bold tracking-widest text-text-secondary">Reports · {openReports.length}</div>
              <div className="divide-y divide-border-soft">
                {openReports.map((r) => (
                  <button key={r.id} onClick={() => setOpenReportId(r.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                    <span className="w-8 h-8 rounded-full bg-surface-2 text-text-secondary flex items-center justify-center shrink-0"><ClipboardList className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-text-primary truncate">{r.title}</span>
                      <span className="block text-[11px] text-text-secondary capitalize">{r.kind} · {r.status === 'investigating' ? `with ${r.investigatorName ?? 'responder'}` : elapsed(r.createdAt)}</span>
                    </span>
                    {r.status === 'pending' && <span className="text-[9px] font-bold uppercase text-accent-warning bg-accent-warning/15 rounded px-1.5 py-0.5">New</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {notices.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase font-bold tracking-widest text-text-secondary">On the map · {notices.length}</div>
              <div className="divide-y divide-border-soft">
                {notices.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-8 h-8 rounded-full bg-surface-2 text-text-secondary flex items-center justify-center shrink-0"><MapPin className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-text-primary truncate">{e.title}</span>
                      <span className="block text-[11px] text-text-secondary truncate">{e.source} · sev {e.severity}</span>
                    </span>
                    <button onClick={() => resolveEvent(e.id)} title="Stand down" className="text-[11px] font-semibold text-text-secondary hover:text-text-primary border border-border-strong rounded-md px-2 py-1 shrink-0">Stand down</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      {viewingReport && <ReportDetail r={viewingReport} onClose={() => setOpenReportId(null)} />}
    </>
  );
}

function ReportDetail({ r, onClose }: { r: CitizenReport; onClose: () => void }) {
  const { responders, dispatchReport, dismissReport, verifyReport } = useAppContext();
  const [picking, setPicking] = useState(false);
  const candidates = responders
    .filter((x) => x.onDuty)
    .map((x) => ({ x, km: getDistanceKm(x.location, r.location) }))
    .sort((a, b) => a.km - b.km);

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:max-w-md h-full bg-surface-0 flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 px-5 h-14 border-b border-border-soft shrink-0">
          <span className="w-9 h-9 rounded-full bg-surface-2 text-text-primary flex items-center justify-center"><ClipboardList className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-text-primary truncate">{r.title}</div>
            <div className="text-[11px] text-text-secondary capitalize">{r.kind} · {r.status} · {elapsed(r.createdAt)}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {r.body && <Row label="Details">{r.body}</Row>}
          <Row label="Location">{r.location.lat.toFixed(4)}°N {r.location.lng.toFixed(4)}°E</Row>
          {r.status === 'investigating' && <Row label="Investigator">{r.investigatorName ?? 'Assigned'}</Row>}
          {picking && r.status !== 'investigating' && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase font-bold tracking-widest text-text-secondary">Dispatch to investigate</div>
              {candidates.length === 0 && <p className="text-xs text-text-secondary">No responders on duty.</p>}
              {candidates.map(({ x, km }) => (
                <div key={x.id} className="flex items-center gap-2 rounded-lg border border-border-soft p-2.5">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-text-primary truncate">{x.name}</span>
                    <span className="block text-[11px] text-text-secondary">{km.toFixed(1)} km · {x.status.replace('_', ' ')}</span>
                  </span>
                  <button onClick={() => { dispatchReport(r.id, x.id); onClose(); }} className="text-xs font-semibold rounded-md px-3 py-1.5 bg-surface-3 text-text-inverse">Send</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-border-soft shrink-0 space-y-2">
          {r.status === 'investigating' ? (
            <div className="text-center text-xs text-text-secondary py-2">Being investigated by {r.investigatorName ?? 'a responder'}.</div>
          ) : (
            <>
              {/* This is real → publish it as a canonical incident everyone sees. */}
              <button onClick={() => { verifyReport(r.id); onClose(); }} className="w-full h-11 rounded-lg bg-surface-3 text-text-inverse font-semibold text-sm flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Verify → publish as incident
              </button>
              <div className="flex gap-2">
                <button onClick={() => { dismissReport(r.id); onClose(); }} className="h-11 px-3 rounded-lg border border-border-strong text-accent-critical font-semibold text-sm flex items-center gap-1.5">
                  <Trash2 className="w-4 h-4" /> Fake
                </button>
                <button onClick={() => setPicking((v) => !v)} className="flex-1 h-11 rounded-lg border border-border-strong text-text-primary font-semibold text-sm flex items-center justify-center gap-2">
                  <Send className="w-4 h-4" /> {picking ? 'Choose a responder' : 'Dispatch to investigate'}
                </button>
              </div>
            </>
          )}
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
