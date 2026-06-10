import { useEffect, useState } from 'react';
import { Megaphone, X, Send, Users, HandHelping, Siren, MapPin, Search, Flag, Crosshair } from 'lucide-react';
import { useAppContext, type Role, type NotificationTier, type SosCategory, type CanonicalEvent } from '../AppContext';
import { mapPick } from '../state/mapPick';

const SG_CENTER = { lng: 103.8198, lat: 1.3521 };

// Ops create-actions, bottom-centre (free for ops): broadcast a message, or
// declare a notice / investigation / case onto the operating picture.
export default function OpsActions() {
  const { role } = useAppContext();
  const [composing, setComposing] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  if (role !== 'ops') return null;

  return (
    <>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        <button
          onClick={() => setDeclaring(true)}
          className="h-12 px-5 rounded-full bg-surface-0 border border-border-strong text-text-primary font-bold text-sm shadow-lg flex items-center gap-2 hover:bg-surface-2 active:scale-[0.98] transition"
        >
          <Flag className="w-4 h-4" /> Declare
        </button>
        <button
          onClick={() => setComposing(true)}
          className="h-12 px-6 rounded-full bg-surface-3 text-text-inverse font-bold text-sm shadow-lg flex items-center gap-2 hover:brightness-110 active:scale-[0.98] transition"
        >
          <Megaphone className="w-4 h-4" /> Broadcast
        </button>
      </div>
      {composing && <BroadcastComposer onClose={() => setComposing(false)} />}
      {declaring && <DeclareComposer onClose={() => setDeclaring(false)} />}
    </>
  );
}

const AUD: { key: string; label: string; roles: Role[]; icon: typeof Users }[] = [
  { key: 'both', label: 'Everyone', roles: ['citizen', 'responder'], icon: Users },
  { key: 'res', label: 'Citizens', roles: ['citizen'], icon: Users },
  { key: 'resp', label: 'Responders', roles: ['responder'], icon: HandHelping },
];

const URGENCY: { tier: NotificationTier; label: string; on: string }[] = [
  { tier: 'info', label: 'Info', on: 'bg-accent-info text-white border-accent-info' },
  { tier: 'urgent', label: 'Warning', on: 'bg-accent-warning text-white border-accent-warning' },
  { tier: 'critical', label: 'Emergency', on: 'bg-accent-critical text-white border-accent-critical' },
];

// Module scope so a provider re-render never wipes the half-typed broadcast.
function BroadcastComposer({ onClose }: { onClose: () => void }) {
  const { sendBroadcast } = useAppContext();
  const [audKey, setAudKey] = useState('both');
  const [tier, setTier] = useState<NotificationTier>('urgent');
  const [area, setArea] = useState('');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState('');

  const send = () => {
    if (!message.trim()) return;
    const aud = AUD.find((a) => a.key === audKey) ?? AUD[0];
    sendBroadcast({ audience: aud.roles, tier, area: area.trim() || 'Islandwide', message: message.trim(), details: details.trim() || undefined });
    onClose();
  };

  return (
    <Sheet title="Broadcast" icon={<Megaphone className="w-4 h-4" />} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <Field label="Send to">
          <div className="grid grid-cols-3 gap-2">
            {AUD.map((a) => {
              const on = audKey === a.key;
              return (
                <button key={a.key} onClick={() => setAudKey(a.key)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors ${on ? 'bg-surface-3 text-text-inverse border-border-strong' : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'}`}>
                  <a.icon className="w-5 h-5" />
                  <span className="text-xs font-semibold">{a.label}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Urgency">
          <div className="grid grid-cols-3 gap-2">
            {URGENCY.map((u) => {
              const on = tier === u.tier;
              return (
                <button key={u.tier} onClick={() => setTier(u.tier)}
                  className={`h-10 rounded-xl border text-xs font-semibold transition-colors ${on ? u.on : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'}`}>
                  {u.label}
                </button>
              );
            })}
          </div>
        </Field>
        <Input label="Area (optional)" value={area} onChange={setArea} placeholder="e.g. Bishan · or leave blank for islandwide" />
        <Input label="Message" value={message} onChange={setMessage} placeholder="e.g. Flash flood — avoid the underpass" />
        <TextArea label="Details (optional)" value={details} onChange={setDetails} placeholder="What people should do" />
      </div>
      <Footer onClick={send} disabled={!message.trim()} label="Send broadcast" icon={<Send className="w-4 h-4" />} />
    </Sheet>
  );
}

// ── Declare ─────────────────────────────────────────────────────────────────

type Mode = 'notice' | 'investigate' | 'case';
const MODES: { key: Mode; label: string; icon: typeof Flag; blurb: string }[] = [
  { key: 'notice', label: 'Notice', icon: MapPin, blurb: 'Pin an awareness marker on every map + alert.' },
  { key: 'investigate', label: 'Investigate', icon: Search, blurb: 'Send a responder to check something out.' },
  { key: 'case', label: 'Case', icon: Siren, blurb: 'Open a case room responders can join.' },
];

// CanonicalEvent kinds offered for notice/investigate, and SOS categories for a case.
const KINDS: CanonicalEvent['kind'][] = ['fire', 'flood', 'medical', 'crash', 'hazard', 'weather', 'other'];
const SOS_CATS: SosCategory[] = ['medical', 'fire', 'trapped', 'threat', 'hazard', 'other'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function DeclareComposer({ onClose }: { onClose: () => void }) {
  const { declareNotice, declareInvestigate, declareCase, selfLocation, selfPlaceName, responders } = useAppContext();
  const [mode, setMode] = useState<Mode>('notice');
  const [title, setTitle] = useState('');
  const [area, setArea] = useState(selfPlaceName ?? '');
  const [note, setNote] = useState('');
  const [tier, setTier] = useState<NotificationTier>('urgent');
  const [kind, setKind] = useState<CanonicalEvent['kind']>('hazard');
  const [cat, setCat] = useState<SosCategory>('medical');
  const [responderId, setResponderId] = useState('');

  // Location is CLICK-TO-PLACE: defaults to the ops fix, but ops should tap the
  // map to put the declaration WHERE IT IS, not where the operator is standing.
  const [loc, setLoc] = useState<{ lng: number; lat: number }>(() => selfLocation ?? SG_CENTER);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    return mapPick.subscribe(() => {
      const p = mapPick.picked();
      if (p) { mapPick.take(); setLoc(p); setPicking(false); }
    });
  }, []);
  const startPick = () => { setPicking(true); mapPick.request(); };
  const cancelPick = () => { mapPick.cancel(); setPicking(false); };

  // On-duty responders are the ones an investigation can be dispatched to.
  const onDuty = responders.filter((r) => r.onDuty && r.status !== 'offline');

  const canSubmit =
    !!title.trim() && (mode !== 'investigate' || !!responderId);

  const submit = () => {
    if (!canSubmit) return;
    if (mode === 'notice') {
      declareNotice({ kind, title: title.trim(), note: note.trim(), tier, area: area.trim(), location: loc });
    } else if (mode === 'investigate') {
      const r = onDuty.find((x) => x.id === responderId);
      declareInvestigate({ responderId, responderName: r?.name, kind, title: title.trim(), body: note.trim(), location: loc });
    } else {
      declareCase({ category: cat, title: title.trim(), details: note.trim(), area: area.trim(), location: loc });
    }
    onClose();
  };

  const submitLabel = mode === 'notice' ? 'Post notice' : mode === 'investigate' ? 'Dispatch investigation' : 'Open case';

  // While picking, hide the modal (no backdrop) so the map underneath is
  // clickable — just a banner. Component stays mounted, so the form is intact.
  if (picking) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 pl-4 pr-3 h-11 rounded-full bg-surface-3 text-text-inverse shadow-2xl max-w-[calc(100vw-2rem)]">
        <Crosshair className="w-4 h-4 shrink-0" />
        <span className="text-sm font-semibold whitespace-nowrap">Tap the map to place this {mode}</span>
        <button onClick={cancelPick} className="text-xs font-semibold rounded-full px-2 py-1 bg-white/15 hover:bg-white/25 shrink-0">Cancel</button>
      </div>
    );
  }

  return (
    <Sheet title="Declare" icon={<Flag className="w-4 h-4" />} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const on = mode === m.key;
            return (
              <button key={m.key} onClick={() => setMode(m.key)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors ${on ? 'bg-surface-3 text-text-inverse border-border-strong' : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'}`}>
                <m.icon className="w-5 h-5" />
                <span className="text-xs font-semibold">{m.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-text-secondary -mt-1">{MODES.find((m) => m.key === mode)!.blurb}</p>

        <Input label="Title" value={title} onChange={setTitle} placeholder={mode === 'case' ? 'e.g. Collapsed scaffolding · 3 trapped' : 'e.g. Fallen tree blocking road'} />

        {/* category / kind */}
        {mode === 'case' ? (
          <Field label="Category">
            <ChipRow options={SOS_CATS} value={cat} onChange={setCat} />
          </Field>
        ) : (
          <Field label="Kind">
            <ChipRow options={KINDS} value={kind} onChange={setKind} />
          </Field>
        )}

        {mode === 'notice' && (
          <Field label="Urgency">
            <div className="grid grid-cols-3 gap-2">
              {URGENCY.map((u) => {
                const on = tier === u.tier;
                return (
                  <button key={u.tier} onClick={() => setTier(u.tier)}
                    className={`h-10 rounded-xl border text-xs font-semibold transition-colors ${on ? u.on : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'}`}>
                    {u.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {mode === 'investigate' && (
          <Field label="Assign to">
            {onDuty.length === 0 ? (
              <p className="text-xs text-text-secondary py-1">No on-duty responders available right now.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {onDuty.map((r) => {
                  const on = responderId === r.id;
                  const skills = r.proficiencies?.length ? r.proficiencies.map(cap).join(', ') : 'No skills set';
                  return (
                    <button key={r.id} onClick={() => setResponderId(r.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${on ? 'bg-surface-3 text-text-inverse border-border-strong' : 'bg-surface-1 border-border-soft hover:border-text-secondary'}`}>
                      <HandHelping className="w-4 h-4 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className={`block text-sm font-semibold ${on ? 'text-text-inverse' : 'text-text-primary'}`}>{r.name || 'Responder'}</span>
                        <span className={`block text-[11px] ${on ? 'text-text-inverse/70' : 'text-text-secondary'}`}>Responder · {skills}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        )}

        {(mode === 'notice' || mode === 'case') && (
          <Input label="Area (optional)" value={area} onChange={setArea} placeholder="e.g. Bishan" />
        )}

        <TextArea
          label={mode === 'investigate' ? 'What to check' : mode === 'case' ? 'Details (optional)' : 'Note (optional)'}
          value={note} onChange={setNote}
          placeholder={mode === 'investigate' ? 'What should the responder look for?' : mode === 'case' ? 'Anything responders should know' : 'What people should know'}
        />

        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 min-w-0">Placing at {loc.lat.toFixed(4)}°N {loc.lng.toFixed(4)}°E</span>
          <button onClick={startPick} className="text-[11px] font-semibold text-text-primary border border-border-strong rounded-md px-2 py-1 hover:bg-surface-2 shrink-0">Pick on map</button>
        </div>
      </div>
      <Footer onClick={submit} disabled={!canSubmit} label={submitLabel} icon={<Flag className="w-4 h-4" />} />
    </Sheet>
  );
}

// ── shared sheet primitives ───────────────────────────────────────────────

function Sheet({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-surface-0 rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 h-14 border-b border-border-soft sticky top-0 bg-surface-0 z-10">
          <h2 className="text-base font-bold text-text-primary flex items-center gap-2">{icon} {title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Footer({ onClick, disabled, label, icon }: { onClick: () => void; disabled: boolean; label: string; icon: React.ReactNode }) {
  return (
    <footer className="px-5 py-3 border-t border-border-soft sticky bottom-0 bg-surface-0">
      <button onClick={onClick} disabled={disabled}
        className="w-full h-12 rounded-xl bg-surface-3 text-text-inverse font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
        {icon} {label}
      </button>
    </footer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full h-10 px-3 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary" />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary resize-none" />
    </label>
  );
}

function ChipRow<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o;
        return (
          <button key={o} onClick={() => onChange(o)}
            className={`px-3 h-8 rounded-full border text-xs font-semibold capitalize transition-colors ${on ? 'bg-surface-3 text-text-inverse border-border-strong' : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'}`}>
            {o}
          </button>
        );
      })}
    </div>
  );
}
