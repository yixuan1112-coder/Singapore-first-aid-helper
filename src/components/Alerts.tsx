import { useState } from 'react';
import { Bell, X, Megaphone } from 'lucide-react';
import { useAppContext, type NotificationTier } from '../AppContext';

const TIER: Record<NotificationTier, { label: string; dot: string; chip: string }> = {
  info: { label: 'Info', dot: 'bg-accent-info', chip: 'bg-accent-info/15 text-accent-info' },
  watch: { label: 'Watch', dot: 'bg-accent-info', chip: 'bg-accent-info/15 text-accent-info' },
  urgent: { label: 'Warning', dot: 'bg-accent-warning', chip: 'bg-accent-warning/15 text-accent-warning' },
  critical: { label: 'Emergency', dot: 'bg-accent-critical', chip: 'bg-accent-critical/15 text-accent-critical' },
};

function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// Read surface for ops broadcasts. Residents/responders see alerts targeted at
// them (transport-scoped); ops sees every broadcast as its sent-log. A bell to
// the left of the profile avatar opens a right-side sheet — no rail collision.
export default function Alerts() {
  const { role, notifications, ackNotification, selfResponderId } = useAppContext();
  const [open, setOpen] = useState(false);
  const isOps = role === 'ops';

  const broadcasts = notifications
    .filter((n) => n.kind === 'broadcast')
    .sort((a, b) => b.createdAt - a.createdAt);
  // Ops can't "read" a broadcast it never received a copy of — no unread for ops.
  const unread = isOps ? [] : broadcasts.filter((b) => !b.ackBy.includes(selfResponderId));
  const hot = unread.some((b) => b.tier === 'critical' || b.tier === 'urgent');

  const openSheet = () => {
    setOpen(true);
    if (!isOps) for (const b of unread) ackNotification(b.id, selfResponderId);
  };

  return (
    <>
      <button
        onClick={openSheet}
        title={isOps ? 'Broadcasts sent' : 'Alerts'}
        className="absolute top-4 right-16 z-20 w-10 h-10 rounded-full bg-white/95 backdrop-blur border border-border-strong flex items-center justify-center text-text-primary shadow-sm hover:bg-white"
      >
        <Bell className="w-4 h-4" />
        {unread.length > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center bg-accent-critical ${hot ? 'animate-pulse' : ''}`}>
            {unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-md h-full bg-surface-0 flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center gap-3 px-5 h-14 border-b border-border-soft shrink-0">
              <span className="w-9 h-9 rounded-full bg-surface-2 text-text-primary flex items-center justify-center"><Megaphone className="w-5 h-5" /></span>
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold text-text-primary">{isOps ? 'Broadcasts sent' : 'Alerts'}</div>
                <div className="text-[11px] text-text-secondary">{broadcasts.length} total</div>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-2"><X className="w-4 h-4" /></button>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
              {broadcasts.length === 0 && (
                <div className="text-center text-sm text-text-secondary py-10">
                  {isOps ? 'No broadcasts sent yet.' : 'No alerts. You’ll see ops broadcasts here.'}
                </div>
              )}
              {broadcasts.map((b) => {
                const t = TIER[b.tier];
                return (
                  <div key={b.id} className="rounded-xl border border-border-soft bg-surface-1 p-3.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                      <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${t.chip}`}>{t.label}</span>
                      {b.area && <span className="text-[11px] text-text-secondary">· {b.area}</span>}
                      <span className="flex-1" />
                      <span className="text-[11px] text-text-secondary">{ago(b.createdAt)}</span>
                    </div>
                    <div className="text-sm font-semibold text-text-primary">{b.title}</div>
                    {b.body && <div className="mt-0.5 text-[13px] text-text-secondary leading-snug">{b.body}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
