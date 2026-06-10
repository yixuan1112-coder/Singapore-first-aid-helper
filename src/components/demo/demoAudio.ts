let context: AudioContext | null = null;
let gainNode: GainNode | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let currentResolve: ((played: boolean) => void) | null = null;

const DEMO_VOLUME = 1;

function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

function outputNode(ctx: AudioContext): GainNode {
  if (!gainNode) {
    gainNode = ctx.createGain();
    gainNode.gain.value = DEMO_VOLUME;
    gainNode.connect(ctx.destination);
  }
  return gainNode;
}

/** Must run from the presenter's Play click so later Qwen WAV scenes are not
 * blocked by browser autoplay policy. */
export async function unlockDemoAudio(): Promise<void> {
  const ctx = audioContext();
  outputNode(ctx).gain.value = DEMO_VOLUME;
  await ctx.resume();
  const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = silent;
  source.connect(outputNode(ctx));
  source.start();
}

export async function playQwenScene(sceneId: string, baseUrl = '/demo/voice'): Promise<boolean> {
  stopQwenScene();
  try {
    const response = await fetch(`${baseUrl}/${sceneId}.wav`, { cache: 'no-store' });
    if (!response.ok) return false;

    const bytes = await response.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
    const ascii = String.fromCharCode(...header);
    // Vite may return its HTML fallback with HTTP 200 for a missing asset.
    // Reject anything that is not an actual RIFF/WAVE file before decoding.
    if (bytes.byteLength < 44 || !ascii.startsWith('RIFF') || ascii.slice(8, 12) !== 'WAVE') return false;

    const ctx = audioContext();
    await ctx.resume();
    const buffer = await ctx.decodeAudioData(bytes);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(outputNode(ctx));
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
    // A stale, partial, or unsupported WAV must never abort the live demo.
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
