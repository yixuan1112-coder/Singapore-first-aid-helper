import { useEffect, useState } from 'react';
import { FileWarning, X, TriangleAlert, Waves, Car, Flame, CloudRain, HelpCircle, Check, Search } from 'lucide-react';
import { useAppContext } from '../AppContext';
import type { CitizenReport } from '../AppContext';

type Kind = CitizenReport['kind'];
const KINDS: { value: Kind; label: string; icon: typeof TriangleAlert }[] = [
  { value: 'hazard', label: 'Hazard', icon: TriangleAlert },
  { value: 'flood', label: 'Flood', icon: Waves },
  { value: 'crash', label: 'Crash', icon: Car },
  { value: 'fire', label: 'Fire', icon: Flame },
  { value: 'weather', label: 'Weather', icon: CloudRain },
  { value: 'other', label: 'Other', icon: HelpCircle },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'Sent — ops reviewing',
  claimed: 'Ops reviewing',
  investigating: 'A responder is checking it',
  verified: 'Verified — now an incident',
  resolved: 'Checked & closed',
  dismissed: 'Reviewed — no action',
};

// Civilian non-emergency reporting. Separate from SOS — a report goes to the ops
// queue (responders only see it if ops dispatches an investigation or verifies it).
export default function ReportIssue() {
  const { role, selfResponderId, reports } = useAppContext();
  const [composing, setComposing] = useState(false);
  if (role !== 'citizen') return null;

  const mine = reports
    .filter((r) => r.ownerId === selfResponderId && !['resolved', 'dismissed', 'verified'].includes(r.status))
    .slice(0, 2);

  return (
    <div className="absolute bottom-6 right-4 z-20 flex flex-col items-end gap-2 max-w-[calc(100vw-2rem)]">
      {mine.map((r) => (
        <div key={r.id} className="rounded-lg bg-surface-0 border border-border-strong shadow-lg px-3 py-2 w-60">
          <div className="text-xs font-bold text-text-primary truncate">{r.title}</div>
          <div className="text-[11px] text-text-secondary flex items-center gap-1 mt-0.5">
            <Search className="w-3 h-3" /> {STATUS_LABEL[r.status] ?? r.status}
          </div>
        </div>
      ))}
      <button
        onClick={() => setComposing(true)}
        className="h-10 px-4 rounded-full bg-surface-0 border border-border-strong text-text-primary font-semibold text-xs shadow-lg flex items-center gap-1.5 hover:bg-surface-2 transition"
      >
        <FileWarning className="w-4 h-4" /> Report an issue
      </button>
      {composing && <Compose onClose={() => setComposing(false)} />}
    </div>
  );
}

// Module scope so a provider re-render (e.g. a GPS fix bumping selfLocation)
// never REMOUNTS this and wipes the half-filled report.
function Compose({ onClose }: { onClose: () => void }) {
  const { fileReport, selfLocation } = useAppContext();
  const [kind, setKind] = useState<Kind | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loc, setLoc] = useState<{ lng: number; lat: number } | null>(selfLocation);

  useEffect(() => {
    if (loc || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ lng: p.coords.longitude, lat: p.coords.latitude }),
      () => {}, { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [loc]);

  const submit = () => {
    if (!kind || !title.trim()) return;
    fileReport({
      kind,
      title: title.trim(),
      body: body.trim(),
      location: loc ?? selfLocation ?? { lng: 103.8198, lat: 1.3521 },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-surface-0 rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 h-14 border-b border-border-soft">
          <h2 className="text-base font-bold text-text-primary">Report an issue</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
        </header>
        <div className="px-5 py-4 space-y-4">
          <div>
            <span className="text-xs font-medium text-text-secondary">What kind of issue?</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {KINDS.map((k) => {
                const on = kind === k.value;
                return (
                  <button key={k.value} onClick={() => setKind(k.value)}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors ${on ? 'bg-surface-3 text-text-inverse border-border-strong' : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'}`}>
                    <k.icon className="w-5 h-5" />
                    <span className="text-xs font-semibold">{k.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Short title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fallen tree blocking lane"
              className="mt-1 w-full h-10 px-3 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Details (optional)</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="What's the situation?"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary resize-none" />
          </label>
          <div className="text-[11px] text-text-muted">{loc ? 'Using your live location.' : 'Locating…'} This goes to ops, not an emergency line.</div>
        </div>
        <footer className="px-5 py-3 border-t border-border-soft">
          <button onClick={submit} disabled={!kind || !title.trim()}
            className="w-full h-12 rounded-xl bg-surface-3 text-text-inverse font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            <Check className="w-4 h-4" /> Send report
          </button>
        </footer>
      </div>
    </div>
  );
}
