import { useMemo, useState } from 'react';
import {
  UserRound, HandHelping, ShieldCheck, Mail, Lock, Phone, ArrowLeft,
  Check, Smartphone, Fingerprint, ChevronRight,
} from 'lucide-react';
import { useAppContext, type Role } from '../AppContext';

// ---------------------------------------------------------------------------
// Authentication flow.
//
// Login is DEMO — every path eventually calls join(name, role). But the screens
// shown are the real ones we intend to ship: Singpass-first sign in, an
// email/password fallback, account sign-up, and a verification step. A clearly
// marked "Explore in demo mode" link skips straight to the role picker.
// ---------------------------------------------------------------------------

type Screen = 'welcome' | 'email' | 'signup' | 'singpass' | 'role';

const ROLES: Array<{ role: Role; title: string; blurb: string; icon: typeof UserRound }> = [
  { role: 'citizen', title: 'Citizen', blurb: 'See live conditions near you and send an SOS when you need help.', icon: UserRound },
  { role: 'responder', title: 'Responder', blurb: 'Get paged for incidents you can help with and respond on the ground.', icon: HandHelping },
  { role: 'ops', title: 'Ops', blurb: 'Watch the whole picture, triage signals, and dispatch responders.', icon: ShieldCheck },
];

export default function Join() {
  const { join } = useAppContext();
  const [screen, setScreen] = useState<Screen>('welcome');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [verified, setVerified] = useState(false); // Singpass-verified identity
  const [demo, setDemo] = useState(false);

  const goRole = () => setScreen('role');

  // A successful Singpass auth returns a legally verified name. We prefill one
  // so the verified badge reads true; the user can still adjust it in demo.
  const onSingpass = () => {
    if (!name.trim()) setName('Tan Mei Ling');
    setVerified(true);
    goRole();
  };

  return (
    <main className="min-h-screen bg-surface-1 text-text-primary flex flex-col">
      {screen === 'welcome' && (
        <Welcome
          onSingpass={() => setScreen('singpass')}
          onEmail={() => setScreen('email')}
          onSignup={() => setScreen('signup')}
          onDemo={() => { setDemo(true); setVerified(false); goRole(); }}
        />
      )}

      {screen === 'singpass' && (
        <Singpass onBack={() => setScreen('welcome')} onDone={onSingpass} />
      )}

      {screen === 'email' && (
        <AuthShell title="Log in" onBack={() => setScreen('welcome')}>
          <Field icon={Mail} label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" autoFocus />
          <Field icon={Lock} label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
          <div className="flex justify-end">
            <button className="text-xs font-semibold text-accent-info">Forgot password?</button>
          </div>
          <PrimaryButton onClick={goRole}>Log in</PrimaryButton>
          <Divider>or</Divider>
          <SingpassButton onClick={() => setScreen('singpass')} />
          <p className="text-center text-xs text-text-secondary">
            New here?{' '}
            <button onClick={() => setScreen('signup')} className="font-bold text-accent-info">Create an account</button>
          </p>
        </AuthShell>
      )}

      {screen === 'signup' && (
        <AuthShell title="Create account" onBack={() => setScreen('welcome')}>
          <Field icon={UserRound} label="Full name" value={name} onChange={setName} placeholder="As per NRIC" autoFocus />
          <Field icon={Mail} label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" />
          <Field icon={Phone} label="Mobile" type="tel" value={phone} onChange={setPhone} placeholder="+65 9123 4567" />
          <Field icon={Lock} label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" />
          <div className="rounded-xl border border-border-soft bg-surface-1 p-3 flex items-start gap-3">
            <Fingerprint className="w-5 h-5 text-[#d0011c] shrink-0 mt-0.5" />
            <p className="text-xs text-text-secondary leading-relaxed">
              Verify with <span className="font-bold text-text-primary">Singpass</span> so responders and operations can
              trust your identity in an emergency.
            </p>
          </div>
          <PrimaryButton onClick={() => setScreen('singpass')}>
            Continue with Singpass
          </PrimaryButton>
          <button onClick={goRole} className="w-full text-center text-xs font-semibold text-text-secondary py-1">
            Skip verification for now
          </button>
        </AuthShell>
      )}

      {screen === 'role' && (
        <RoleStep
          name={name}
          setName={setName}
          verified={verified}
          demo={demo}
          onBack={() => setScreen('welcome')}
          onPick={(role) => join(name.trim() || 'Guest', role)}
        />
      )}
    </main>
  );
}

// --------------------------------------------------------------------------
// Welcome
// --------------------------------------------------------------------------
function Welcome({ onSingpass, onEmail, onSignup, onDemo }: {
  onSingpass: () => void; onEmail: () => void; onSignup: () => void; onDemo: () => void;
}) {
  return (
    <>
      <section className="bg-surface-3 text-text-inverse px-6 pt-10 pb-10 sm:px-10">
        <div className="max-w-md mx-auto flex flex-col items-center text-center">
          <img
            src="/kampung-kaki-logo.png"
            alt="Kampung Kaki"
            className="h-48 sm:h-56 w-auto object-contain select-none pointer-events-none"
          />
          <p className="mt-1 text-sm font-medium text-white/75 leading-relaxed">
            Singapore's neighbourhood first-aid coordination layer — one shared, live picture when minutes matter.
          </p>
        </div>
      </section>

      <section className="flex-1 px-6 py-8 sm:px-10">
        <div className="max-w-md mx-auto space-y-3">
          <SingpassButton onClick={onSingpass} large />
          <Divider>or</Divider>
          <button
            onClick={onEmail}
            className="w-full h-12 rounded-xl border-2 border-border-strong bg-surface-0 font-bold text-sm flex items-center justify-center gap-2 hover:bg-surface-2 transition"
          >
            <Mail className="w-4 h-4" /> Log in with email
          </button>
          <button
            onClick={onSignup}
            className="w-full h-12 rounded-xl bg-surface-0 border-2 border-border-strong font-bold text-sm flex items-center justify-center gap-2 hover:bg-surface-2 transition"
          >
            Create an account
          </button>

          <div className="pt-4">
            <button
              onClick={onDemo}
              className="w-full text-center text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary transition flex items-center justify-center gap-1"
            >
              Explore in demo mode <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <p className="mt-1 text-center text-[11px] text-text-muted">No account — jump straight in to look around.</p>
          </div>
        </div>
      </section>
    </>
  );
}

// --------------------------------------------------------------------------
// Singpass — authentic-looking verification screen (demo: any tap proceeds)
// --------------------------------------------------------------------------
function Singpass({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'app' | 'password'>('app');
  const qr = useMemo(() => qrPattern('kampungkaki-singpass-demo'), []);

  return (
    <div className="flex-1 flex flex-col bg-[#f5f5f5]">
      <header className="h-14 px-4 flex items-center gap-3 bg-white border-b border-black/10">
        <button onClick={onBack} className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center text-black/60 hover:bg-black/5">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Wordmark />
      </header>

      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="flex border-b border-black/10 text-sm font-semibold">
            <Tab on={tab === 'app'} onClick={() => setTab('app')}>Singpass app</Tab>
            <Tab on={tab === 'password'} onClick={() => setTab('password')}>Password login</Tab>
          </div>

          {tab === 'app' ? (
            <div className="p-6 flex flex-col items-center text-center">
              <p className="text-sm text-black/70 mb-4">Scan with the <b>Singpass app</b> to log in.</p>
              <div className="p-3 bg-white border border-black/10 rounded-xl">
                <div className="grid" style={{ gridTemplateColumns: `repeat(${QR}, 1fr)`, width: 176, height: 176 }}>
                  {qr.map((on, i) => (
                    <div key={i} style={{ background: on ? '#000' : 'transparent' }} />
                  ))}
                </div>
              </div>
              <button
                onClick={onDone}
                className="mt-6 w-full h-12 rounded-full bg-[#d0011c] text-white font-bold text-sm flex items-center justify-center gap-2 hover:brightness-110 transition"
              >
                <Smartphone className="w-4 h-4" /> Simulate scan &amp; log in
              </button>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              <SgField label="Singpass ID" placeholder="e.g. S1234567A" />
              <SgField label="Password" type="password" placeholder="Password" />
              <button
                onClick={onDone}
                className="w-full h-12 rounded-full bg-[#d0011c] text-white font-bold text-sm hover:brightness-110 transition"
              >
                Log in
              </button>
              <div className="flex items-center justify-center gap-4 text-xs text-[#d0011c] font-semibold pt-1">
                <button>Forgot Singpass ID</button>
                <span className="text-black/20">|</span>
                <button>Reset password</button>
              </div>
            </div>
          )}

          <div className="px-6 py-4 border-t border-black/10 bg-[#fafafa] flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-black/40" />
            <p className="text-[11px] text-black/50 leading-snug">
              Demo only — no real Singpass call is made. Your NRIC and password are never collected.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <span className="text-xl font-bold tracking-tight text-[#d0011c] lowercase select-none">
      singpass
    </span>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 transition ${on ? 'text-[#d0011c] border-b-2 border-[#d0011c]' : 'text-black/50 hover:text-black/70'}`}
    >
      {children}
    </button>
  );
}

function SgField({ label, type = 'text', placeholder }: { label: string; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-black/60">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        className="mt-1 w-full h-11 px-3 rounded-lg border border-black/20 bg-white text-sm text-black outline-none focus:border-[#d0011c]"
      />
    </label>
  );
}

// --------------------------------------------------------------------------
// Role step — final choice; every auth path lands here.
// --------------------------------------------------------------------------
function RoleStep({ name, setName, verified, demo, onBack, onPick }: {
  name: string; setName: (v: string) => void; verified: boolean; demo: boolean;
  onBack: () => void; onPick: (role: Role) => void;
}) {
  const ready = name.trim().length >= 2;
  return (
    <AuthShell title={demo ? 'Choose a space' : 'How are you joining?'} onBack={onBack}>
      {verified ? (
        <div className="rounded-xl border-2 border-accent-success/40 bg-accent-success/5 p-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-accent-success text-white flex items-center justify-center shrink-0">
            <Check className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-text-primary truncate">{name}</div>
            <div className="text-[11px] font-semibold text-accent-success">Verified with Singpass</div>
          </div>
        </div>
      ) : (
        <Field icon={UserRound} label="Your name" value={name} onChange={setName} placeholder="e.g. Mei Ling" autoFocus />
      )}

      <p className="text-[10px] font-black uppercase tracking-widest text-text-secondary pt-1">
        {ready ? 'Pick how you want to use Kampung Kaki' : 'Enter your name to continue'}
      </p>

      <div className="space-y-2.5">
        {ROLES.map((item) => (
          <button
            key={item.role}
            data-kk-role={item.role}
            disabled={!ready}
            onClick={() => onPick(item.role)}
            className="w-full text-left flex items-center gap-3 rounded-xl border-2 border-border-strong bg-surface-0 p-3.5 enabled:hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <span className="w-11 h-11 rounded-lg border-2 border-border-strong bg-surface-2 flex items-center justify-center shrink-0">
              <item.icon className="w-5 h-5" strokeWidth={2.2} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-base font-black uppercase">{item.title}</span>
              <span className="block text-xs text-text-secondary font-medium leading-snug mt-0.5">{item.blurb}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-text-secondary shrink-0" />
          </button>
        ))}
      </div>
    </AuthShell>
  );
}

// --------------------------------------------------------------------------
// Shared building blocks
// --------------------------------------------------------------------------
function AuthShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <>
      <header className="h-14 px-4 flex items-center gap-3 border-b border-border-soft bg-surface-0">
        <button onClick={onBack} className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-base font-black uppercase tracking-tight">{title}</span>
      </header>
      <section className="flex-1 px-6 py-7 sm:px-10">
        <div className="max-w-md mx-auto space-y-4">{children}</div>
      </section>
    </>
  );
}

function Field({ icon: Icon, label, value, onChange, placeholder, type = 'text', autoFocus }: {
  icon: typeof Mail; label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">{label}</span>
      <div className="mt-1 flex items-center gap-2 h-12 px-3 rounded-xl border-2 border-border-strong bg-surface-0 focus-within:shadow-[3px_3px_0_rgba(26,26,26,1)] transition">
        <Icon className="w-4 h-4 text-text-secondary shrink-0" />
        <input
          autoFocus={autoFocus}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-text-primary outline-none"
        />
      </div>
    </label>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-12 rounded-xl bg-surface-3 text-text-inverse font-bold text-sm hover:brightness-125 transition"
    >
      {children}
    </button>
  );
}

function SingpassButton({ onClick, large }: { onClick: () => void; large?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full ${large ? 'h-14' : 'h-12'} rounded-xl bg-[#d0011c] text-white font-bold text-sm flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] transition`}
    >
      <Fingerprint className="w-5 h-5" />
      Log in with <span className="lowercase font-black tracking-tight">singpass</span>
    </button>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="flex-1 h-px bg-border-soft" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{children}</span>
      <span className="flex-1 h-px bg-border-soft" />
    </div>
  );
}

// Deterministic QR-ish bit pattern (decorative only).
const QR = 21;
function qrPattern(seed: string): boolean[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const cells: boolean[] = [];
  const finder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= QR - 7) || (r >= QR - 7 && c < 7);
  for (let r = 0; r < QR; r++) {
    for (let c = 0; c < QR; c++) {
      if (finder(r, c)) {
        const lr = r >= QR - 7 ? r - (QR - 7) : r;
        const lc = c >= QR - 7 ? c - (QR - 7) : c;
        const ring = lr === 0 || lr === 6 || lc === 0 || lc === 6;
        const core = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
        cells.push(ring || core);
      } else {
        h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
        cells.push((h & 7) === 0 ? false : (h & 3) === 0);
      }
    }
  }
  return cells;
}
