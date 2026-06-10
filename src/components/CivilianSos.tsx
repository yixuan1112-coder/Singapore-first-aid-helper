import { useEffect, useState } from 'react';
import { HeartPulse, Flame, AlertOctagon, ShieldAlert, TriangleAlert, HelpCircle, X, Check, MessageSquare } from 'lucide-react';
import { useAppContext, type SosCategory } from '../AppContext';
import CaseChat from './CaseChat';

const CATS: { value: SosCategory; label: string; icon: typeof HeartPulse }[] = [
  { value: 'medical', label: 'Medical', icon: HeartPulse },
  { value: 'fire', label: 'Fire', icon: Flame },
  { value: 'trapped', label: 'Trapped', icon: AlertOctagon },
  { value: 'threat', label: 'Threat', icon: ShieldAlert },
  { value: 'hazard', label: 'Hazard', icon: TriangleAlert },
  { value: 'other', label: 'Other', icon: HelpCircle },
];

// Civilian view of the SOS — 3 states only: Sent → Help coming → Resolved.
function phase(status: string): 'sent' | 'coming' | 'resolved' {
  if (status === 'requesting') return 'sent';
  if (status === 'resolved') return 'resolved';
  return 'coming';
}

export default function CivilianSos() {
  const { role, selfResponderId, sosSessions, confirmSosSafe, cancelSos, caseMembers } = useAppContext();
  const [composing, setComposing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Only residents raise an SOS for themselves. Responders/ops act on others'
  // cases through their own surfaces (SOS list / Operations console).
  if (role !== 'citizen') return null;

  const ownSos = sosSessions.find(
    (s) => s.ownerId === selfResponderId && !['resolved', 'cancelled'].includes(s.status),
  );

  if (!ownSos) {
    return (
      <>
        <button
          onClick={() => setComposing(true)}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 h-12 px-7 rounded-full bg-accent-critical text-white font-bold text-sm shadow-lg hover:brightness-110 active:scale-[0.98] transition"
        >
          Need help
        </button>
        {composing && <Compose onClose={() => setComposing(false)} />}
      </>
    );
  }

  const s = ownSos;
  const ph = phase(s.status);
  const cat = CATS.find((c) => c.value === s.category);
  const members = caseMembers(s.id);
  const nearest = members.filter((m) => m.status !== 'arrived').sort((a, b) => (a.eta ?? '').localeCompare(b.eta ?? ''))[0];

  return (
    <>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[min(440px,calc(100vw-2rem))]">
        <div className="rounded-2xl bg-surface-0 border border-border-strong shadow-2xl overflow-hidden">
          <div className={`px-4 py-3 flex items-center gap-3 ${ph === 'resolved' ? 'bg-accent-success' : 'bg-accent-critical'} text-white`}>
            {ph !== 'resolved' && <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold">
                {ph === 'sent' && 'SOS sent — finding responders nearby'}
                {ph === 'coming' && `${members.length} responder${members.length === 1 ? '' : 's'} coming`}
                {ph === 'resolved' && 'Resolved — stay safe'}
              </div>
              <div className="text-[11px] opacity-90">
                {cat?.label}
                {ph === 'coming' && nearest?.eta ? ` · nearest ETA ${nearest.eta}` : ''}
                {ph === 'coming' && members.some((m) => m.status === 'arrived') ? ' · someone is on scene' : ''}
              </div>
            </div>
            {members.length > 0 && ph !== 'resolved' && (
              <button onClick={() => setChatOpen(true)} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0" title="Chat">
                <MessageSquare className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Responders are also rendered live, approaching, on the map; here we
              list who's coming — by ROLE + skills, since names mean nothing to
              someone who's never met them. */}
          {ph === 'coming' && members.length > 0 && (
            <div className="px-4 py-2 border-b border-border-soft space-y-1">
              {members.slice(0, 5).map((m) => {
                const skills = m.proficiencies?.length ? m.proficiencies.map((p) => CATS.find((c) => c.value === p)?.label ?? p).join(', ') : null;
                return (
                  <div key={m.id} className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'arrived' ? 'bg-accent-success' : 'bg-accent-info'}`} />
                    <span className="flex-1 min-w-0 text-text-primary font-medium">
                      {m.name || 'Responder'}
                      <span className="text-text-secondary font-normal"> · Responder{skills ? ` · ${skills}` : ''}</span>
                    </span>
                    <span className="text-text-secondary">{m.status === 'arrived' ? 'on scene' : m.eta ? `ETA ${m.eta}` : 'en route'}</span>
                  </div>
                );
              })}
              {members.length > 5 && <div className="text-[11px] text-text-secondary">+{members.length - 5} more coming</div>}
            </div>
          )}

          <div className="px-4 py-3 flex gap-2">
            {ph === 'sent' && (
              <button onClick={() => cancelSos(s.id)} className="flex-1 h-10 rounded-lg border border-border-strong text-sm font-semibold text-text-secondary hover:bg-surface-2">Cancel</button>
            )}
            {ph === 'coming' && (
              <button
                onClick={() => confirmSosSafe(s.id, 'citizen')}
                disabled={s.citizenConfirmedSafe}
                className="flex-1 h-10 rounded-lg bg-accent-success text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {s.citizenConfirmedSafe ? <><Check className="w-4 h-4" /> Marked safe</> : "I'm safe"}
              </button>
            )}
          </div>
        </div>
      </div>

      {chatOpen && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setChatOpen(false)}>
          <div className="w-full sm:max-w-md bg-surface-0 rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between px-5 h-14 border-b border-border-soft">
              <h2 className="text-base font-bold text-text-primary">Your responders</h2>
              <button onClick={() => setChatOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
            </header>
            <div className="px-5 py-4"><CaseChat sosId={s.id} /></div>
          </div>
        </div>
      )}
    </>
  );
}

// Module scope so a provider re-render (e.g. a GPS fix bumping selfLocation every
// couple seconds) never REMOUNTS this and wipes the half-filled form.
function Compose({ onClose }: { onClose: () => void }) {
  const { startSos, selfName, selfLocation } = useAppContext();
  const [category, setCategory] = useState<SosCategory | null>(null);
  const [details, setDetails] = useState('');
  // Seed from the live tracked position so we always have a real fix; refine
  // with a fresh high-accuracy reading if one arrives.
  const [loc, setLoc] = useState<{ lng: number; lat: number } | null>(selfLocation);
  const [locating, setLocating] = useState(!selfLocation);

  useEffect(() => {
    if (!navigator.geolocation) { setLocating(false); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ lng: p.coords.longitude, lat: p.coords.latitude }); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const send = () => {
    if (!category) return;
    startSos({
      citizenName: selfName || 'Citizen',
      category,
      details: details.trim() || undefined,
      location: loc ?? selfLocation ?? { lng: 103.8198, lat: 1.3521 },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-surface-0 rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 h-14 border-b border-border-soft">
          <h2 className="text-base font-bold text-text-primary">Need help</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
        </header>
        <div className="px-5 py-4 space-y-4">
          <div>
            <span className="text-xs font-medium text-text-secondary">What's the emergency?</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {CATS.map((c) => {
                const on = category === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors ${
                      on ? 'bg-accent-critical text-white border-accent-critical' : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'
                    }`}
                  >
                    <c.icon className="w-5 h-5" />
                    <span className="text-xs font-semibold">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Add a detail (optional)</span>
            <input
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. friend collapsed, breathing"
              className="mt-1 w-full h-10 px-3 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary"
            />
          </label>
          <div className="text-[11px] text-text-muted">
            {locating ? 'Getting your location…' : loc ? 'Using your live location.' : 'Location unavailable — sending approximate position.'}
          </div>
        </div>
        <footer className="px-5 py-3 border-t border-border-soft">
          <button
            onClick={send}
            disabled={!category}
            className="w-full h-12 rounded-xl bg-accent-critical text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
          >
            Send for help
          </button>
        </footer>
      </div>
    </div>
  );
}
