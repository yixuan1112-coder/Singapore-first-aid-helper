import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, MapPin, Sun, LifeBuoy, Radar, ChevronLeft } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { askAgent, type AgentMark } from '../services/agents';
import { bekalDirectives } from '../state/bekalDirectives';
import { conditionsStore } from '../state/conditionsStore';
import { demoBekalFastReply } from '../demo/demoBekalFast';

const RESOLVED = ['resolved', 'cancelled'];
type AgentId = 'pelita' | 'bekal' | 'pondok';

interface AgentDef { id: AgentId; name: string; blurb: string; icon: typeof Sun }
const DEFS: Record<AgentId, AgentDef> = {
  pelita: { id: 'pelita', name: 'Pelita', blurb: 'Live conditions — what’s good, bad, interesting', icon: Sun },
  bekal: { id: 'bekal', name: 'Bekal', blurb: 'SOS companion — hospitals, AEDs, safety', icon: LifeBuoy },
  pondok: { id: 'pondok', name: 'Pondok', blurb: 'Ops lookout — who’s on, what’s ongoing', icon: Radar },
};

interface Msg { role: 'user' | 'assistant'; content: string; marks?: AgentMark[] }

// One hub for all three agents. The model is the mothership; each agent is a box.
export default function AgentHub() {
  const { role, selfResponderId, selfName, selfLocation, sosSessions, joinedCaseIds, viewSosId, responders, reports, selfUser, selfResponder, aidCard } = useAppContext();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<AgentId | null>(null);
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeSos = role === 'citizen'
    ? sosSessions.find((s) => s.ownerId === selfResponderId && !RESOLVED.includes(s.status))
    : (viewSosId ? sosSessions.find((s) => s.id === viewSosId && !RESOLVED.includes(s.status)) : undefined)
      ?? sosSessions.find((s) => joinedCaseIds.has(s.id) && !RESOLVED.includes(s.status));

  // Which agents this role/context can reach. Pelita = everyone, always. Bekal =
  // anyone in an SOS context. Pondok = ops only.
  const available: AgentId[] = [
    'pelita',
    ...(activeSos ? ['bekal' as const] : []),
    ...(role === 'ops' ? ['pondok' as const] : []),
  ];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [threads, active, busy]);

  // Additive demo hook: lets the showcase director LISTEN for a real agent reply
  // (even while the panel is closed) instead of assuming one arrived. No effect
  // on normal app behaviour.
  useEffect(() => {
    const w = window as unknown as {
      __kkAgent?: {
        replyCount: (agent: string) => number;
        lastReply: (agent: string) => string;
        busy: () => boolean;
        conditionsReady: () => boolean;
      };
    };
    w.__kkAgent = {
      replyCount: (agent) => (threads[agent] ?? []).filter((m) => m.role === 'assistant').length,
      lastReply: (agent) => {
        const thread = threads[agent] ?? [];
        for (let i = thread.length - 1; i >= 0; i -= 1) if (thread[i].role === 'assistant') return thread[i].content;
        return '';
      },
      busy: () => busy,
      conditionsReady: () => {
        const snap = conditionsStore.getAgentSnapshot();
        return !!(snap && Array.isArray(snap.layers) && snap.layers.length > 0);
      },
    };
    return () => { if (w.__kkAgent) delete w.__kkAgent; };
  }, [threads, busy]);

  if (!role) return null;

  const messages = active ? (threads[active] ?? []) : [];

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !active) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setThreads((t) => ({ ...t, [active]: [...(t[active] ?? []), { role: 'user', content: text }] }));
    setInput('');
    setBusy(true);

    const w = window as Window & { __kkDemoBekalFast?: boolean };
    const demoFast = active === 'bekal' && w.__kkDemoBekalFast ? demoBekalFastReply(text) : null;
    if (demoFast) {
      await new Promise((resolve) => setTimeout(resolve, demoFast.delayMs));
      setThreads((t) => ({
        ...t,
        [active]: [...(t[active] ?? []), { role: 'assistant', content: demoFast.reply, marks: demoFast.directives }],
      }));
      if (demoFast.directives.length > 0) bekalDirectives.set(demoFast.directives);
      setBusy(false);
      return;
    }

    const location = active === 'bekal' ? (activeSos?.location ?? selfLocation ?? null) : selfLocation ?? null;
    // 1-to-1 channel: the agent always knows WHO it's helping (profile + aid card
    // + GPS) so it can be specific. Plus the conditions snapshot the map already
    // refreshed on its 60s timer — conditions-read reads it OFF the cache (no fetch).
    const profile = {
      name: selfName || selfUser?.displayName,
      role,
      address: selfUser?.address || undefined,
      proficiencies: selfResponder?.proficiencies,
      aidCard: aidCard ?? undefined,
    };
    const context = { responders, sos: sosSessions, reports, conditions: conditionsStore.getAgentSnapshot(), profile };
    const reply = await askAgent({ agent: active, role, location, message: text, history, context });
    setThreads((t) => ({ ...t, [active]: [...(t[active] ?? []), { role: 'assistant', content: reply.reply, marks: reply.directives }] }));
    if (reply.directives.length > 0) bekalDirectives.set(reply.directives);
    setBusy(false);
  };

  const ActiveDef = active ? DEFS[active] : null;

  return (
    <>
      {!open && (
        <button
          onClick={() => { setOpen(true); if (available.length === 1) setActive(available[0]); }}
          className="absolute bottom-20 right-4 z-20 h-11 px-4 rounded-full bg-surface-3 text-text-inverse font-bold text-xs shadow-lg flex items-center gap-2 hover:brightness-110 active:scale-[0.98] transition"
        >
          <Sparkles className="w-4 h-4" /> AI Kaki
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-md h-[80vh] sm:h-[70vh] bg-surface-0 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center gap-3 px-5 h-14 border-b border-border-soft shrink-0">
              {active ? (
                <button onClick={() => setActive(null)} className="w-8 h-8 -ml-1 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><ChevronLeft className="w-4 h-4" /></button>
              ) : (
                <span className="w-9 h-9 rounded-full bg-surface-3 text-text-inverse flex items-center justify-center"><Sparkles className="w-5 h-5" /></span>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold text-text-primary">{ActiveDef ? ActiveDef.name : 'AI Kaki'}</div>
                <div className="text-[11px] text-text-secondary truncate">{ActiveDef ? ActiveDef.blurb : 'Pick a helper'}</div>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
            </header>

            {!active && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {available.map((id) => {
                  const d = DEFS[id];
                  return (
                    <button key={id} onClick={() => setActive(id)} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-border-soft bg-surface-1 text-left hover:border-text-secondary transition-colors">
                      <span className="w-10 h-10 rounded-full bg-surface-3 text-text-inverse flex items-center justify-center shrink-0"><d.icon className="w-5 h-5" /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-text-primary">{d.name}</span>
                        <span className="block text-[11px] text-text-secondary">{d.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {active && (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                  {messages.length === 0 && (
                    <div className="text-center text-sm text-text-secondary py-6">
                      Hi {selfName || 'there'} — I'm {ActiveDef!.name}. {active === 'pelita' ? 'Ask me how conditions look.' : active === 'bekal' ? 'Ask for the nearest hospital or AED, or what to do.' : 'Ask me who’s on duty or what’s ongoing.'}
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <span className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line leading-snug ${m.role === 'user' ? 'bg-accent-info text-white' : 'bg-surface-1 border border-border-soft text-text-primary'}`}>{m.content}</span>
                      {m.marks && m.marks.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5 max-w-[88%]">
                          {m.marks.map((mk, j) => (
                            <span key={j} className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-surface-2 text-text-secondary">
                              <MapPin className="w-3 h-3" />{mk.label}{mk.km != null ? ` · ${mk.km}km` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {busy && <div className="flex items-center gap-2 text-xs text-text-secondary"><Sparkles className="w-3.5 h-3.5 animate-pulse" /> {ActiveDef!.name} is checking…</div>}
                </div>
                <div className="px-4 py-3 border-t border-border-soft shrink-0 flex items-center gap-2">
                  <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                    placeholder={`Ask ${ActiveDef!.name}…`} disabled={busy}
                    className="flex-1 h-11 px-3 rounded-lg border border-border-soft bg-surface-1 text-sm text-text-primary outline-none focus:border-text-primary disabled:opacity-60" />
                  <button onClick={send} disabled={busy || !input.trim()} className="w-11 h-11 rounded-lg bg-surface-3 text-text-inverse flex items-center justify-center disabled:opacity-40"><Send className="w-4 h-4" /></button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
