import { Sparkles } from 'lucide-react';
import { unlockDemoAudio } from '../demoAudio';

export default function QuickDemoLauncher({ onPlay }: { onPlay: () => void }) {
  const embedded = new URLSearchParams(window.location.search).get('embedded') === '1';
  if (embedded) return null;

  return (
    <button
      type="button"
      onClick={() => {
        void unlockDemoAudio().then(onPlay);
      }}
      className="fixed bottom-16 left-4 z-[70] flex h-10 items-center gap-2 border-2 border-black bg-[#ff6b4a] px-3 text-[10px] font-black uppercase tracking-[0.16em] text-black shadow-[3px_3px_0_#111] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_#111]"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
    >
      <Sparkles className="h-3.5 w-3.5" />
      60s AI showcase
    </button>
  );
}
