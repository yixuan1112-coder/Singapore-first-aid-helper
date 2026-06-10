import { useEffect, useState } from 'react';
import { User, X, ShieldCheck, Check, LogOut } from 'lucide-react';
import { useAppContext } from '../AppContext';

const CONDITIONS = ['Asthma', 'Epilepsy', 'Diabetic', 'Heart condition', 'Pregnant'];
const CARRIES = ['Inhaler', 'EpiPen', 'Insulin', 'Glucose'];
const ACCESS = ['Wheelchair', 'Hard of hearing', 'Visually impaired'];
const LANGUAGES = ['English', 'Mandarin', 'Malay', 'Tamil', 'Other'];

// SOS categories a responder can declare proficiency in (value → label).
const SOS_CATS: { value: import('../AppContext').SosCategory; label: string }[] = [
  { value: 'medical', label: 'Medical' },
  { value: 'fire', label: 'Fire' },
  { value: 'trapped', label: 'Trapped' },
  { value: 'threat', label: 'Threat' },
  { value: 'hazard', label: 'Hazard' },
  { value: 'other', label: 'Other' },
];

export default function Profile() {
  const { selfName, selfUser } = useAppContext();
  const [open, setOpen] = useState(false);
  const initial = (selfUser?.displayName || selfName || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Your profile"
        className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-surface-0 border border-border-strong flex items-center justify-center text-sm font-bold text-text-primary shadow-sm hover:bg-surface-2"
      >
        {initial}
      </button>
      {open && <ProfileSheet onClose={() => setOpen(false)} />}
    </>
  );
}

// Module scope: defining this inside Profile() gave it a fresh identity on every
// provider re-render (a GPS fix bumps CSOT ~every couple seconds), which
// REMOUNTED the whole sheet — wiping half-typed fields and visibly repainting
// the panel (the "fuzzy" flicker). Hoisted, it re-renders in place.
function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { role, selfName, selfUser, aidCard, selfResponder, updateSelfProfile, updateAidCard, setProficiencies, leave } = useAppContext();
  const [name, setName] = useState(selfUser?.displayName || selfName || '');
    const [phone, setPhone] = useState(selfUser?.phone || '');
    const [address, setAddress] = useState(selfUser?.address || '');

    const [allergies, setAllergies] = useState(aidCard?.allergies || '');
    const [conditions, setConditions] = useState<string[]>(aidCard?.conditions || []);
    const [carries, setCarries] = useState<string[]>(aidCard?.carries || []);
    const [access, setAccess] = useState<string[]>(aidCard?.access || []);
    const [language, setLanguage] = useState(aidCard?.language || 'English');
    const [nokName, setNokName] = useState(aidCard?.nokName || '');
    const [nokPhone, setNokPhone] = useState(aidCard?.nokPhone || '');
    const [nokRelation, setNokRelation] = useState(aidCard?.nokRelation || '');

    const [prof, setProf] = useState<string[]>(selfResponder?.proficiencies || []);

    const [saved, setSaved] = useState(false);
    useEffect(() => { if (saved) { const t = setTimeout(() => setSaved(false), 1600); return () => clearTimeout(t); } }, [saved]);

    const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
      set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

    const save = () => {
      updateSelfProfile({ displayName: name.trim(), phone: phone.trim(), address: address.trim() });
      updateAidCard({ allergies: allergies.trim(), conditions, carries, access, language, nokName: nokName.trim(), nokPhone: nokPhone.trim(), nokRelation: nokRelation.trim() });
      if (role === 'responder') setProficiencies(prof as import('../AppContext').SosCategory[]);
      setSaved(true);
    };

    return (
      <div className="fixed inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
        <div
          className="w-full sm:max-w-md h-full bg-surface-0 flex flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between px-5 h-14 border-b border-border-soft shrink-0">
            <h2 className="text-base font-bold text-text-primary">Profile</h2>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2">
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
            {/* Identity */}
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-surface-3 text-text-inverse flex items-center justify-center text-lg font-bold">
                  <User className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-text-primary truncate">{name || 'Your name'}</div>
                  <div className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-medium text-accent-success">
                    <ShieldCheck className="w-3.5 h-3.5" /> Verified with Singpass
                  </div>
                </div>
              </div>
              <Field label="Full name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Phone"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="9XXX XXXX" /></Field>
              <Field label="Address"><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Block, street, unit" /></Field>
            </section>

            {/* Aid card */}
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-text-primary">Aid card</h3>
                <p className="text-xs text-text-secondary mt-0.5">What a first-aider should know on scene — not medical records.</p>
              </div>
              <Field label="Allergies"><input className={inputCls} value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="e.g. Penicillin, peanuts" /></Field>
              <ChipField label="Conditions" options={CONDITIONS} selected={conditions} onToggle={(v) => toggle(conditions, setConditions, v)} />
              <ChipField label="Carries" options={CARRIES} selected={carries} onToggle={(v) => toggle(carries, setCarries, v)} />
              <ChipField label="Access needs" options={ACCESS} selected={access} onToggle={(v) => toggle(access, setAccess, v)} />
              <Field label="Preferred language">
                <div className="flex flex-wrap gap-1.5">
                  {LANGUAGES.map((l) => (
                    <Chip key={l} on={language === l} onClick={() => setLanguage(l)}>{l}</Chip>
                  ))}
                </div>
              </Field>
            </section>

            {/* Responder-only: what they can help with */}
            {role === 'responder' && (
              <section className="space-y-2 rounded-xl border border-border-soft bg-surface-1 p-4">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">Responder · what you can help with</h3>
                  <p className="text-xs text-text-secondary mt-0.5">You'll be paged for SOS in these categories when you're on duty.</p>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SOS_CATS.map((c) => (
                    <Chip key={c.value} on={prof.includes(c.value)} onClick={() => setProf(prof.includes(c.value) ? prof.filter((x) => x !== c.value) : [...prof, c.value])}>{c.label}</Chip>
                  ))}
                </div>
              </section>
            )}

            {/* Next of kin */}
            <section className="space-y-3">
              <h3 className="text-sm font-bold text-text-primary">Emergency contact</h3>
              <Field label="Name"><input className={inputCls} value={nokName} onChange={(e) => setNokName(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone"><input className={inputCls} value={nokPhone} onChange={(e) => setNokPhone(e.target.value)} inputMode="tel" /></Field>
                <Field label="Relation"><input className={inputCls} value={nokRelation} onChange={(e) => setNokRelation(e.target.value)} placeholder="e.g. Spouse" /></Field>
              </div>
            </section>

            <p className="text-[11px] leading-relaxed text-text-muted">
              Your aid card stays private. It's shared only with the responder who takes your SOS, and with ops — never with other residents.
            </p>
          </div>

          <footer className="px-5 py-3 border-t border-border-soft shrink-0 flex items-center gap-2">
            <button
              onClick={() => { leave(); onClose(); }}
              title="Log out"
              className="h-11 px-3 rounded-lg border border-border-strong text-accent-critical font-semibold text-sm flex items-center justify-center gap-1.5 hover:bg-accent-critical/5 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
            <button
              onClick={save}
              className="flex-1 h-11 rounded-lg bg-surface-3 text-text-inverse font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {saved ? (<><Check className="w-4 h-4" /> Saved</>) : 'Save'}
            </button>
          </footer>
        </div>
      </div>
    );
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ChipField({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div>
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip key={o} on={selected.includes(o)} onClick={() => onToggle(o)}>{o}</Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 h-8 rounded-full text-xs font-medium border transition-colors ${
        on ? 'bg-surface-3 text-text-inverse border-border-strong' : 'bg-surface-1 text-text-secondary border-border-soft hover:border-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}
