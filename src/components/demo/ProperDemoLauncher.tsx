import { Sparkles } from 'lucide-react';
import { unlockDemoAudio } from './properAudio';

// My own from-scratch live-demo button — separate from Codex's LiveDemoLauncher.
// Distinct colour + position so the two never overlap or get confused. Launches
// the LiveDirector pipeline with my own Qwen voices (voice-proper/). Detachable:
// remove this button + its route and nothing else is affected.
export default function ProperDemoLauncher({ onPlay }: { onPlay: () => void }) {
  const embedded = new URLSearchParams(window.location.search).get('embedded') === '1';
  if (embedded) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // The click is the user gesture that unlocks audio autoplay.
        void unlockDemoAudio().finally(onPlay);
      }}
      className="fixed bottom-4 left-44 z-[70] flex h-10 items-center gap-2 border-2 border-black bg-[#171713] px-3 text-[10px] font-black uppercase tracking-[0.16em] text-[#f1cf54] shadow-[3px_3px_0_#111] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_#111]"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
    >
      <Sparkles className="h-3.5 w-3.5" />
      My live demo
    </button>
  );
}
