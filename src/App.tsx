import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react';
import { AppProvider } from './AppContext';
import Shell from './components/Shell';
import LiveDemoLauncher from './components/demo/LiveDemoLauncher';
import QuickDemoLauncher from './components/demo/quick/QuickDemoLauncher';

const demoFallback = (
  <main className="flex h-screen w-screen items-center justify-center bg-[#12110e] text-[#f4f0e6]">
    <p className="text-[11px] font-black uppercase tracking-[0.24em]">Loading demo…</p>
  </main>
);

class DemoErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#12110e] px-6 text-center text-[#f4f0e6]">
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#ff6b4a]">{this.props.name} failed to load</p>
        <p className="max-w-md text-[12px] leading-relaxed text-[#f4f0e6]/80">{this.state.error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="border-2 border-[#e8c547] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#e8c547]"
        >
          Reload
        </button>
      </main>
    );
  }
}

function lazyDemo<T extends { default: React.ComponentType<any> }>(
  loader: () => Promise<T>,
  label: string,
) {
  return lazy(async () => {
    try {
      return await loader();
    } catch (err) {
      console.error(`[demo] failed to load ${label}`, err);
      const message = err instanceof Error ? err.message : String(err);
      return {
        default: function DemoLoadFailed() {
          return (
            <main
              className="flex h-screen w-screen flex-col items-center justify-center gap-4 px-6 text-center"
              style={{ backgroundColor: '#12110e', color: '#f4f0e6', fontFamily: 'ui-monospace, monospace' }}
            >
              <p className="text-[11px] font-black uppercase tracking-[0.24em]" style={{ color: '#ff6b4a' }}>
                {label} failed to load
              </p>
              <p className="max-w-md text-[12px] leading-relaxed opacity-80">{message}</p>
              <p className="max-w-md text-[11px] opacity-60">
                Try: stop the dev server, run <code>rm -rf node_modules/.vite</code>, then <code>npm run dev</code> again.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="border-2 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em]"
                style={{ borderColor: '#e8c547', color: '#e8c547' }}
              >
                Reload
              </button>
            </main>
          );
        },
      };
    }
  });
}

const LiveDirector = lazyDemo(() => import('./components/demo/LiveDirector'), 'Live demo');
const QuickShowcaseDirector = lazyDemo(() => import('./components/demo/quick/QuickShowcaseDirector'), 'Quick AI showcase');

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const demoParam = new URLSearchParams(window.location.search).get('demo');
  // One canonical live demo. The launcher, /demo, /demo/director, and the old
  // /demo/proper alias all run the corrected LiveDirector.
  const routeDirector =
    path === '/demo' ||
    path === '/demo/director' ||
    path === '/demo/proper' ||
    demoParam === 'director' ||
    demoParam === 'proper';
  const routeQuick = path === '/demo/quick' || demoParam === 'quick';
  const [directorActive, setDirectorActive] = useState(routeDirector);
  const [quickActive, setQuickActive] = useState(routeQuick);
  const [directorAutostart, setDirectorAutostart] = useState(
    new URLSearchParams(window.location.search).get('autostart') === '1',
  );
  const [quickAutostart, setQuickAutostart] = useState(
    new URLSearchParams(window.location.search).get('autostart') === '1',
  );

  if (quickActive) {
    return (
      <DemoErrorBoundary name="Quick AI showcase">
        <Suspense fallback={demoFallback}>
          <QuickShowcaseDirector
            autostart={quickAutostart}
            onExit={() => {
              setQuickActive(false);
              setQuickAutostart(false);
              if (routeQuick) window.history.replaceState(null, '', '/');
            }}
          />
        </Suspense>
      </DemoErrorBoundary>
    );
  }

  if (directorActive) {
    return (
      <DemoErrorBoundary name="Live demo">
        <Suspense fallback={demoFallback}>
          <LiveDirector
            autostart={directorAutostart}
            onExit={() => {
              setDirectorActive(false);
              setDirectorAutostart(false);
              if (routeDirector) window.history.replaceState(null, '', '/');
            }}
          />
        </Suspense>
      </DemoErrorBoundary>
    );
  }
  return (
    <AppProvider>
      <Shell />
      <LiveDemoLauncher
        onPlay={() => {
          setDirectorAutostart(true);
          setDirectorActive(true);
        }}
      />
      <QuickDemoLauncher
        onPlay={() => {
          setQuickActive(true);
        }}
      />
    </AppProvider>
  );
}
