// Audio for the proper (from-scratch) live demo. Identical surface to demoAudio,
// but reads MY Qwen voices from /demo/voice-proper/ so it never touches Codex's
// /demo/voice/ assets. Fully detachable: delete this + voice-proper/ and the
// proper demo simply falls back to browser TTS.

let context: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let currentResolve: ((played: boolean) => void) | null = null;

function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

/** Run from the presenter's Play click so later WAV scenes aren't blocked by the
 *  browser autoplay policy. */
export async function unlockDemoAudio(): Promise<void> {
  const ctx = audioContext();
  await ctx.resume();
  const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = silent;
  source.connect(ctx.destination);
  source.start();
}

export async function playQwenScene(sceneId: string): Promise<boolean> {
  stopQwenScene();
  try {
    const response = await fetch(`/demo/voice-proper/${sceneId}.wav`, { cache: 'no-store' });
    if (!response.ok) return false;

    const bytes = await response.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
    const ascii = String.fromCharCode(...header);
    // Vite returns index.html with HTTP 200 when a scene asset is missing.
    // Reject non-WAV responses before Web Audio tries to decode them.
    if (bytes.byteLength < 44 || !ascii.startsWith('RIFF') || ascii.slice(8, 12) !== 'WAVE') return false;

    const ctx = audioContext();
    await ctx.resume();
    const buffer = await ctx.decodeAudioData(bytes);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    currentSource = source;

    return new Promise<boolean>((resolve) => {
      currentResolve = resolve;
      source.onended = () => {
        if (currentSource === source) currentSource = null;
        if (currentResolve === resolve) currentResolve = null;
        resolve(true);
      };
      source.start();
    });
  } catch {
    // A stale, partial, or unsupported asset must never abort the performance.
    // Returning false makes LiveDirector use browser speech synthesis instead.
    stopQwenScene();
    return false;
  }
}

export function pauseDemoAudio(): void {
  void context?.suspend();
}

export function resumeDemoAudio(): void {
  void context?.resume();
}

export function stopQwenScene(): void {
  if (currentSource) {
    currentSource.onended = null;
    try {
      currentSource.stop();
    } catch {
      // The source may already have ended.
    }
    currentSource = null;
  }
  currentResolve?.(false);
  currentResolve = null;
}
