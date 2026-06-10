import {
  pauseDemoAudio,
  playQwenScene,
  resumeDemoAudio,
  stopQwenScene,
  unlockDemoAudio,
} from '../demoAudio';

export { pauseDemoAudio, resumeDemoAudio, stopQwenScene, unlockDemoAudio };

export type QuickSfx = 'stamp' | 'whoosh' | 'chime' | 'page-flip';

const QUICK_VOICE_BASE = '/demo/voice/quick';
const sfxCache = new Map<QuickSfx, HTMLAudioElement>();

export async function playSfx(name: QuickSfx, volume = 0.92): Promise<void> {
  const audio = sfxCache.get(name) ?? new Audio(`/demo/sfx/${name}.mp3`);
  audio.volume = volume;
  sfxCache.set(name, audio);
  audio.currentTime = 0;
  try {
    await audio.play();
  } catch {
    // Autoplay policy — silent beats still animate.
  }
}

/** Qwen 3 reference-voice WAV playback at natural speed (synced to caption duration). */
export function playQuickVoice(sceneId: string): Promise<boolean> {
  return playQwenScene(sceneId, QUICK_VOICE_BASE);
}

// --- Intro music bed (HTMLAudio so it layers under the WebAudio voice). ---
let musicEl: HTMLAudioElement | null = null;
let musicFade: number | null = null;

export async function playIntroMusic(volume = 0.58): Promise<void> {
  stopIntroMusic(true);
  const audio = new Audio('/demo/music/intro.mp3');
  audio.loop = true;
  audio.volume = volume;
  musicEl = audio;
  try {
    await audio.play();
  } catch {
    // Autoplay policy — title still animates without the bed.
  }
}

/** Smoothly duck the intro bed out (called when the first voiceover starts). */
export function fadeOutIntroMusic(ms = 1400): void {
  const audio = musicEl;
  if (!audio) return;
  if (musicFade) window.clearInterval(musicFade);
  const steps = Math.max(1, Math.round(ms / 60));
  const start = audio.volume;
  let i = 0;
  musicFade = window.setInterval(() => {
    i += 1;
    audio.volume = Math.max(0, start * (1 - i / steps));
    if (i >= steps) {
      if (musicFade) window.clearInterval(musicFade);
      musicFade = null;
      audio.pause();
      if (musicEl === audio) musicEl = null;
    }
  }, 60);
}

export function stopIntroMusic(immediate = false): void {
  if (musicFade) { window.clearInterval(musicFade); musicFade = null; }
  if (!musicEl) return;
  if (immediate) {
    musicEl.pause();
    musicEl = null;
  } else {
    fadeOutIntroMusic(600);
  }
}

export function pauseIntroMusic(): void { musicEl?.pause(); }
export function resumeIntroMusic(): void { void musicEl?.play().catch(() => {}); }

export async function verifyQuickVoice(sceneId: string): Promise<boolean> {
  try {
    const response = await fetch(`${QUICK_VOICE_BASE}/${sceneId}.wav`, { cache: 'no-store' });
    if (!response.ok) return false;
    const bytes = await response.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
    const ascii = String.fromCharCode(...header);
    return bytes.byteLength >= 44 && ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
  } catch {
    return false;
  }
}

export async function verifyQuickVoicePack(): Promise<boolean> {
  return verifyQuickVoice('qs-intro');
}
