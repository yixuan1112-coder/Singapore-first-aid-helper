import { useAppContext } from '../AppContext';

// Responder-only live shift control. Sits top-centre over the map so going on/
// off duty is one tap — only on-duty responders get paged for SOS.
export default function ResponderControls() {
  const { role, selfResponder, setDuty } = useAppContext();
  if (role !== 'responder') return null;

  const onDuty = selfResponder?.onDuty ?? false;
  const noSkills = (selfResponder?.proficiencies?.length ?? 0) === 0;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
      <button
        onClick={() => setDuty(!onDuty)}
        className={`flex items-center gap-2 h-9 pl-2.5 pr-3 rounded-full border text-xs font-semibold shadow-sm backdrop-blur transition-colors ${
          onDuty
            ? 'bg-accent-success/95 text-white border-accent-success'
            : 'bg-white/95 text-text-secondary border-border-strong'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${onDuty ? 'bg-white' : 'bg-text-muted'}`} />
        {onDuty ? 'On duty' : 'Off duty'}
      </button>
      {onDuty && noSkills && (
        <span className="text-[10px] font-semibold text-text-primary bg-accent-warning rounded px-2 py-0.5 shadow-sm">
          Paged for all SOS — set your skills to focus
        </span>
      )}
    </div>
  );
}
