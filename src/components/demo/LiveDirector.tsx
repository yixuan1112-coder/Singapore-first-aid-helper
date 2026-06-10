import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MousePointer2, Pause, Play, Radio, RotateCcw, ShieldCheck, Sparkles, Square, UserRound } from 'lucide-react';
import { pauseDemoAudio, playQwenScene, resumeDemoAudio, stopQwenScene, unlockDemoAudio } from './demoAudio';

// LiveDirector — the canonical live demo stage.
// Differences: real role labels (Citizen/Responder/Ops), coherent story (Mei
// Ling is the witness, the elderly man is the casualty), no voice/persona meta
// cards, AI agents have NO human avatar (they are the app's voice), specific AI
// questions, and Qwen scene WAV playback with browser TTS fallback.

// Browser speech synthesis — speak the caption so audio always matches the text.
let _voices: SpeechSynthesisVoice[] = [];
if (typeof window !== 'undefined' && window.speechSynthesis) {
  const load = () => { _voices = window.speechSynthesis.getVoices(); };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}
function speakLine(text: string, onDone: () => void): () => void {
  if (typeof window === 'undefined' || !window.speechSynthesis) { onDone(); return () => {}; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02; u.pitch = 1; u.volume = 1;
  const en = _voices.find((v) => /en[-_]?(GB|SG|AU|US)/i.test(v.lang)) ?? _voices.find((v) => /^en/i.test(v.lang));
  if (en) u.voice = en;
  u.onend = onDone;
  u.onerror = onDone;
  window.speechSynthesis.speak(u);
  return () => window.speechSynthesis.cancel();
}

type RoleKey = 'resident' | 'responder' | 'ops';
type Camera = RoleKey | 'all';
type Phase = 'idle' | 'preparing' | 'ready' | 'running' | 'cleaning' | 'complete' | 'failed';
type CaptionKind = 'speech' | 'action';

type DemoWindow = Window & {
  __kkDemo?: {
    identity: () => { userId: string } | null;
    topicCount: (prefix: string) => number;
    setTransportOnline: (online: boolean) => void;
    shutdown: () => void;
  };
  __kkMapDemo?: {
    focusLocation: (near: { lng: number; lat: number }, zoom?: number) => void;
    showLayerSample: (
      layerId: string,
      near?: { lng: number; lat: number },
    ) => { x: number; y: number; label: string; distanceKm: number } | null;
    responderMarkerCount: () => number;
    clearEvidence: () => void;
  };
};

interface DemoStatus {
  retainedObjects: number;
  byCluster: Record<string, number>;
}

interface SeedReceipt {
  responders: number;
  reports: number;
  events: number;
}

interface SwarmReceipt {
  responders: number;
  roles: string[];
}

interface PresentationCard {
  id: number;
  eyebrow: string;
  title: string;
  headline: string;
  detail: string;
}

interface CutsceneCard {
  id: number;
  image: string;
  title: string;
  detail: string;
}

interface FocusBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL ?? '';
const INCIDENT_LOCATION = { lng: 103.8644, lat: 1.3022 };
const ACTOR_LOCATIONS: Record<RoleKey, { lng: number; lat: number }> = {
  resident: INCIDENT_LOCATION,
  responder: { lng: 103.8588, lat: 1.3074 },
  ops: { lng: 103.8198, lat: 1.3521 },
};
const actors: Record<RoleKey, { name: string; roleLabel: string; icon: typeof UserRound }> = {
  resident: { name: 'Mei Ling', roleLabel: 'Citizen', icon: UserRound },
  responder: { name: 'Aisha', roleLabel: 'Responder', icon: Radio },
  ops: { name: 'Nadia', roleLabel: 'Ops', icon: ShieldCheck },
};

// Humans get a portrait; AI agents (Pelita/Bekal/Pondok/Director) are the app's
// voice, not people — they render an AI mark, never a human face.
const speakerProfiles: Array<{ match: string; name: string; role: string; image: string | null; ai: boolean }> = [
  { match: 'Mei Ling', name: 'Mei Ling', role: 'Citizen', image: '/demo/personas/mei-ling.png', ai: false },
  { match: 'Aisha', name: 'Aisha', role: 'Responder', image: '/demo/personas/aisha.png', ai: false },
  { match: 'Nadia', name: 'Nadia', role: 'Ops', image: '/demo/personas/nadia.png', ai: false },
  { match: 'Pelita', name: 'Pelita', role: 'AI Kaki · conditions', image: null, ai: true },
  { match: 'Bekal', name: 'Bekal', role: 'AI Kaki · SOS companion', image: null, ai: true },
  { match: 'Pondok', name: 'Pondok', role: 'AI Kaki · ops lookout', image: null, ai: true },
  { match: 'Director', name: 'Director', role: 'Narrator', image: null, ai: true },
];

function speakerProfile(speaker: string) {
  return speakerProfiles.find((profile) => speaker.includes(profile.match)) ?? speakerProfiles[speakerProfiles.length - 1];
}

const rawSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

class DemoStopped extends Error {
  constructor() {
    super('Demo stopped by presenter');
  }
}

export default function LiveDirector({ autostart, onExit }: { autostart: boolean; onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Set<RoleKey>>(new Set());
  const [camera, setCamera] = useState<Camera>('resident');
  const [speaker, setSpeaker] = useState('AI Director');
  const [caption, setCaption] = useState('A clean, live demo begins with an empty session.');
  const [captionKind, setCaptionKind] = useState<CaptionKind>('action');
  const [chapter, setChapter] = useState('Ready');
  const [networkState, setNetworkState] = useState<'online' | 'stuttering'>('online');
  const [seedReceipt, setSeedReceipt] = useState<SeedReceipt | null>(null);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [auditLine, setAuditLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2, visible: false, down: false });
  const [framesVisible, setFramesVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [presentationCard, setPresentationCard] = useState<PresentationCard | null>(null);
  const [cutscene, setCutscene] = useState<CutsceneCard | null>(null);
  const [focusBox, setFocusBox] = useState<FocusBox | null>(null);
  const presentationCardIdRef = useRef(0);
  const cutsceneIdRef = useRef(0);
  const focusBoxIdRef = useRef(0);
  const frameRefs = useRef<Record<RoleKey, HTMLIFrameElement | null>>({
    resident: null,
    responder: null,
    ops: null,
  });
  const pausedRef = useRef(false);
  const cancelSpeechRef = useRef<null | (() => void)>(null);
  const stopRequestedRef = useRef(false);
  const restartRequestedRef = useRef(false);
  const runAfterPrepareRef = useRef(false);
  const autostartPreparedRef = useRef(false);
  const autostartRunRef = useRef(false);
  const fast = useMemo(() => new URLSearchParams(window.location.search).get('pace') === 'fast', []);

  const checkpoint = () => {
    if (stopRequestedRef.current) throw new DemoStopped();
  };

  const wait = async (ms: number) => {
    let remaining = ms;
    while (remaining > 0) {
      checkpoint();
      if (pausedRef.current) {
        await rawSleep(80);
        continue;
      }
      const slice = Math.min(remaining, 80);
      await rawSleep(slice);
      remaining -= slice;
    }
    checkpoint();
  };

  const frameDocument = (role: RoleKey): Document => {
    const doc = frameRefs.current[role]?.contentDocument;
    if (!doc) throw new Error(`${role} app is not ready`);
    return doc;
  };

  const frameWindow = (role: RoleKey): DemoWindow => {
    const win = frameRefs.current[role]?.contentWindow as DemoWindow | null;
    if (!win) throw new Error(`${role} app window is not ready`);
    return win;
  };

  const waitFor = async <T,>(read: () => T | null | undefined, label: string, timeout = 15000): Promise<T> => {
    let elapsed = 0;
    while (elapsed < timeout) {
      checkpoint();
      const value = read();
      if (value) return value;
      await wait(120);
      elapsed += 120;
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  const visible = <T extends Element>(element: T | null | undefined): T | null => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? element : null;
  };

  const reveal = async (role: RoleKey, element: Element) => {
    const doc = frameDocument(role);
    const before = element.getBoundingClientRect();
    const viewportH = doc.documentElement.clientHeight || frameWindow(role).innerHeight;
    const viewportW = doc.documentElement.clientWidth || frameWindow(role).innerWidth;
    const offscreen =
      before.top < 16 ||
      before.left < 16 ||
      before.bottom > viewportH - 16 ||
      before.right > viewportW - 16;
    if (offscreen) {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      await wait(fast ? 30 : 180);
    }
  };

  const button = (role: RoleKey, text: string, exact = false): HTMLButtonElement | null => {
    const target = cleanText(text).toLowerCase();
    const buttons = Array.from(frameDocument(role).querySelectorAll('button'));
    return buttons
      .map((element) => visible(element))
      .find((element) => {
        if (!element || element.disabled) return false;
        const content = cleanText(element.textContent).toLowerCase();
        return exact ? content === target : content.includes(target);
      }) ?? null;
  };

  const inputByPlaceholder = (role: RoleKey, text: string): HTMLInputElement | HTMLTextAreaElement | null => {
    const target = text.toLowerCase();
    const fields = Array.from(frameDocument(role).querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
    return fields.map((element) => visible(element)).find((element) => element?.placeholder.toLowerCase().includes(target)) ?? null;
  };

  const inputByLabel = (role: RoleKey, text: string): HTMLInputElement | HTMLTextAreaElement | null => {
    const target = text.toLowerCase();
    const labels = Array.from(frameDocument(role).querySelectorAll('label'));
    const label = labels.find((element) => cleanText(element.textContent).toLowerCase().startsWith(target));
    return label?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? null;
  };

  const moveCursor = async (role: RoleKey, element: Element) => {
    const frame = frameRefs.current[role];
    if (!frame) return;
    await reveal(role, element);
    const frameRect = frame.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    const scaleX = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight > 0 ? frameRect.height / frame.offsetHeight : 1;
    setCursor({
      x: frameRect.left + (target.left + target.width / 2) * scaleX,
      y: frameRect.top + (target.top + target.height / 2) * scaleY,
      visible: true,
      down: false,
    });
    await wait(fast ? 60 : 260);
  };

  const moveCursorToFramePoint = async (role: RoleKey, point: { x: number; y: number }) => {
    const frame = frameRefs.current[role];
    if (!frame) return;
    const frameRect = frame.getBoundingClientRect();
    const scaleX = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight > 0 ? frameRect.height / frame.offsetHeight : 1;
    setCursor({
      x: frameRect.left + point.x * scaleX,
      y: frameRect.top + point.y * scaleY,
      visible: true,
      down: false,
    });
    await wait(fast ? 60 : 420);
  };

  const framePointToScreen = (role: RoleKey, point: { x: number; y: number }) => {
    const frame = frameRefs.current[role];
    if (!frame) return null;
    const frameRect = frame.getBoundingClientRect();
    const scaleX = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight > 0 ? frameRect.height / frame.offsetHeight : 1;
    return {
      x: frameRect.left + point.x * scaleX,
      y: frameRect.top + point.y * scaleY,
    };
  };

  const click = async (role: RoleKey, read: () => HTMLElement | null, label: string) => {
    const element = await waitFor(read, label);
    await moveCursor(role, element);
    setCursor((current) => ({ ...current, down: true }));
    element.click();
    await wait(fast ? 50 : 130);
    setCursor((current) => ({ ...current, down: false }));
    await wait(fast ? 80 : 220);
  };

  const fill = async (
    role: RoleKey,
    read: () => HTMLInputElement | HTMLTextAreaElement | null,
    value: string,
    label: string,
  ) => {
    const element = await waitFor(read, label);
    await moveCursor(role, element);
    element.focus();
    const ownerWindow = element.ownerDocument.defaultView;
    if (!ownerWindow) throw new Error(`${label} has no owning window`);
    const prototype = element.tagName === 'TEXTAREA'
      ? ownerWindow.HTMLTextAreaElement.prototype
      : ownerWindow.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(fast ? 50 : 180);
  };

  const switchCamera = async (next: Camera, nextChapter: string) => {
    setCamera(next);
    setChapter(nextChapter);
    setCursor((current) => ({ ...current, visible: false }));
    await wait(fast ? 80 : 420);
  };

  // Prefer Qwen WAV scenes generated from demo/incident-281.json. If a scene
  // asset is missing, fall back to browser TTS so the live demo keeps moving.
  const narrate = async (id: string, nextSpeaker: string, text: string) => {
    setSpeaker(nextSpeaker);
    setCaption(text);
    setCaptionKind('speech');
    if (fast) { await wait(180); return; }
    let finished = false;
    let cancel = () => {};
    cancelSpeechRef.current = () => {
      stopQwenScene();
      cancel();
    };
    const qwenPlayed = await playQwenScene(id);
    checkpoint();
    if (qwenPlayed) {
      finished = true;
    } else {
      cancel = speakLine(text, () => { finished = true; });
    }
    // Cap so a missing/hung TTS engine can't stall the show; floor for reading time.
    const maxMs = Math.min(14000, Math.max(3200, text.length * 58));
    let waited = qwenPlayed ? maxMs : 0;
    while (!finished && waited < maxMs) {
      checkpoint();
      if (pausedRef.current) { await rawSleep(80); continue; }
      await rawSleep(90); waited += 90;
    }
    cancel();
    stopQwenScene();
    cancelSpeechRef.current = null;
    checkpoint();
  };

  const flashPresentationCard = async (
    eyebrow: string,
    title: string,
    headline: string,
    detail: string,
  ) => {
    const id = ++presentationCardIdRef.current;
    setPresentationCard({ id, eyebrow, title, headline, detail });
    await wait(fast ? 120 : 3600);
    setPresentationCard((current) => current?.id === id ? null : current);
    await wait(fast ? 20 : 120);
  };

  const flashEvidenceCard = async (title: string, headline: string, detail: string) => {
    await flashPresentationCard('MAP DATA USED', title, headline, detail);
  };

  const flashCutscene = async (title: string, detail: string) => {
    const id = ++cutsceneIdRef.current;
    setCutscene({ id, image: '/demo/cutscenes/mrt-ebike-fire.png', title, detail });
    await wait(fast ? 120 : 3100);
    setCutscene((current) => current?.id === id ? null : current);
    await wait(fast ? 20 : 180);
  };

  const flashRoleCard = async (role: RoleKey) => {
    const actor = actors[role];
    setSpeaker(actor.name);
    await flashPresentationCard(
      'NOW JOINING',
      actor.roleLabel.toUpperCase(),
      actor.name.toUpperCase(),
      'One real user on the live map.',
    );
  };

  const ensureLayerOn = async (role: RoleKey, label: string) => {
    const target = label.toLowerCase();
    const read = () => {
      const buttons = Array.from(frameDocument(role).querySelectorAll<HTMLButtonElement>('button'));
      return buttons
        .map((element) => visible(element))
        .find((element) => cleanText(element?.textContent).toLowerCase().includes(target)) ?? null;
    };
    let layer = read();
    if (!layer) {
      const panel = button(role, 'Layers');
      if (panel) await click(role, () => panel, `${role} layers panel`);
    }
    layer = await waitFor(read, `${role} map layer ${label}`, 12000);
    const alreadyOn = String(layer.className).includes('bg-surface-3');
    if (alreadyOn) {
      await moveCursor(role, layer);
      await wait(fast ? 30 : 170);
      return;
    }
    await click(role, () => layer, `enable ${label}`);
  };

  const layerPanelOpen = (role: RoleKey) => cleanText(frameDocument(role).body.textContent).includes('Care & rescue');

  const collapseLayerPanel = async (role: RoleKey) => {
    if (layerPanelOpen(role)) await click(role, () => button(role, 'Layers'), `${role} collapse layers`);
  };

  const ensureLayerOff = async (role: RoleKey, label: string) => {
    const target = label.toLowerCase();
    const read = () => {
      const buttons = Array.from(frameDocument(role).querySelectorAll<HTMLButtonElement>('button'));
      return buttons
        .map((element) => visible(element))
        .find((element) => cleanText(element?.textContent).toLowerCase().includes(target)) ?? null;
    };
    let layer = read();
    if (!layer) await click(role, () => button(role, 'Layers'), `${role} layers panel`);
    layer = await waitFor(read, `${role} map layer ${label}`, 12000);
    const alreadyOn = String(layer.className).includes('bg-surface-3');
    if (alreadyOn) await click(role, () => layer, `disable ${label}`);
  };

  const focusSosArea = async (role: RoleKey, sceneId: string, detail: string) => {
    setChapter(`${actors[role].roleLabel} · SOS area`);
    await collapseLayerPanel(role);
    const mapDemo = await waitFor(
      () => frameWindow(role).__kkMapDemo ?? null,
      `${role} demo map`,
      12000,
    );
    mapDemo.focusLocation(INCIDENT_LOCATION, 15.4);
    await wait(fast ? 80 : 350);
    await narrate(sceneId, 'Director', detail);
  };

  const inspectMapLayer = async (
    role: RoleKey,
    sceneId: string,
    layerId: string,
    toggleLabel: string,
    spokenLabel: string,
    detail: string,
  ) => {
    setChapter(`${actors[role].roleLabel} map evidence · ${spokenLabel}`);
    frameWindow(role).__kkMapDemo?.focusLocation(INCIDENT_LOCATION, 15.3);
    await ensureLayerOn(role, toggleLabel);
    await collapseLayerPanel(role);
    await wait(fast ? 80 : 360);
    const sample = await waitFor(
      () => frameWindow(role).__kkMapDemo?.showLayerSample(layerId, INCIDENT_LOCATION) ?? null,
      `${role} ${spokenLabel} sample`,
      12000,
    );
    await moveCursorToFramePoint(role, sample);
    setCursor((current) => ({ ...current, down: true }));
    await wait(fast ? 50 : 170);
    setCursor((current) => ({ ...current, down: false }));
    const screenPoint = framePointToScreen(role, sample);
    if (screenPoint) {
      const id = ++focusBoxIdRef.current;
      const w = 196;
      const h = 118;
      setFocusBox({
        id,
        x: Math.min(window.innerWidth - w - 14, Math.max(14, Math.round(screenPoint.x - w / 2))),
        y: Math.min(window.innerHeight - h - 124, Math.max(40, Math.round(screenPoint.y - h * 0.82))),
        w,
        h,
        label: `${spokenLabel}: ${sample.label}`,
      });
      await narrate(sceneId, 'Director', detail);
      await wait(fast ? 120 : 900);
      setFocusBox((current) => current?.id === id ? null : current);
    } else {
      await narrate(sceneId, 'Director', detail);
    }
    frameWindow(role).__kkMapDemo?.clearEvidence();
    await ensureLayerOff(role, toggleLabel);
    await collapseLayerPanel(role);
    await wait(fast ? 40 : 220);
  };

  const spawnSwarm = async () => {
    if (!sessionId) throw new Error('Demo session has not started');
    return api<SwarmReceipt>(`/api/demo/${sessionId}/swarm`, { method: 'POST' });
  };

  const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(`${BRIDGE_URL}${path}`, options);
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return response.json() as Promise<T>;
  };

  const prepare = async () => {
    stopRequestedRef.current = false;
    restartRequestedRef.current = false;
    autostartRunRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setPhase('preparing');
    setError(null);
    setAuditLine(null);
    setSeedReceipt(null);
    setStatus(null);
    setNetworkState('online');
    setVoiceReady(false);
    setCamera('resident');
    setCaption('Opening one isolated demo session. Nothing outside it will be reset.');
    setCaptionKind('action');
    try {
      // Fire-and-forget: AudioContext.resume() can hang indefinitely without a
      // user gesture (e.g. autostart from a URL), which would stall the whole
      // demo before it ever starts. Never block prepare on it.
      void unlockDemoAudio().then(() => setVoiceReady(true)).catch(() => {});
      const start = await api<{ sessionId: string }>('/api/demo/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Smoke At Exit B' }),
      });
      setSessionId(start.sessionId);
      setLoaded(new Set());
      setFramesVisible(true);
      setPhase('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('failed');
    }
  };

  const login = async (role: RoleKey) => {
    const actor = actors[role];
    await switchCamera(role, `${actor.roleLabel} identity`);
    await flashRoleCard(role);
    await narrate(
      `login-${role}`,
      'Director',
      `${actor.name} signs in as ${actor.roleLabel}. The demo waits for each screen and enabled control before moving on.`,
    );
    await click(role, () => button(role, 'Explore in demo mode'), 'demo mode button');
    await waitFor(
      () => inputByPlaceholder(role, 'Mei Ling'),
      `${role} role picker`,
    );
    await fill(role, () => inputByPlaceholder(role, 'Mei Ling'), actor.name, `${role} name`);
    await waitFor(
      () => {
        const field = inputByPlaceholder(role, 'Mei Ling');
        return field?.value === actor.name ? field : null;
      },
      `${role} name committed`,
    );
    const appRole = role === 'resident' ? 'citizen' : role;
    await click(role, () => {
      const choice = frameDocument(role).querySelector<HTMLButtonElement>(`button[data-kk-role="${appRole}"]`);
      return choice && !choice.disabled ? visible(choice) : null;
    }, `${actor.roleLabel} role enabled`);
    await waitFor(
      () => {
        const identity = frameWindow(role).__kkDemo?.identity();
        return identity?.name === actor.name && identity.role === actor.roleLabel.toLowerCase()
          ? identity
          : null;
      },
      `${role} identity minted`,
      30000,
    );
    await waitFor(
      () => visible(frameDocument(role).querySelector('button[title="Your profile"]') as HTMLButtonElement),
      `${role} map ready`,
      30000,
    );
  };

  const ensureResponderDuty = async (desired: boolean) => {
    const current = await waitFor(
      () => button('responder', 'On duty', true) ?? button('responder', 'Off duty', true),
      'responder duty state',
    );
    const isOnDuty = cleanText(current.textContent) === 'On duty';
    if (isOnDuty !== desired) {
      await click(
        'responder',
        () => button('responder', desired ? 'Off duty' : 'On duty', true),
        desired ? 'go on duty' : 'go off duty',
      );
    } else {
      await moveCursor('responder', current);
    }
    await waitFor(
      () => button('responder', desired ? 'On duty' : 'Off duty', true),
      desired ? 'confirmed on-duty state' : 'confirmed off-duty state',
    );
  };

  const closeSheet = async (role: RoleKey, heading: string) => {
    const doc = frameDocument(role);
    const header = Array.from(doc.querySelectorAll('header')).find((node) => cleanText(node.textContent).includes(heading));
    const close = header?.querySelector('button') ?? null;
    if (close) await click(role, () => close, `${heading} close`);
  };

  const chipSelected = (element: HTMLElement) => {
    const cls = String(element.className);
    return cls.includes('bg-surface-3') || cls.includes('text-text-inverse');
  };

  const ensureProfileChip = async (role: RoleKey, sceneId: string, label: string, nextCaption: string) => {
    await narrate(sceneId, 'Director', nextCaption);
    const chip = await waitFor(() => button(role, label, true), `${role} ${label} profile chip`);
    if (chipSelected(chip)) {
      await moveCursor(role, chip);
      await wait(fast ? 40 : 160);
    } else {
      await click(role, () => button(role, label, true), `${role} ${label} profile chip`);
    }
    await waitFor(
      () => {
        const next = button(role, label, true);
        return next && chipSelected(next) ? next : null;
      },
      `${role} ${label} profile chip selected`,
    );
  };

  const aiHeader = (role: RoleKey): HTMLElement | null => {
    const names = ['AI Kaki', 'Pelita', 'Bekal', 'Pondok'];
    return Array.from(frameDocument(role).querySelectorAll<HTMLElement>('header'))
      .find((node) => names.some((name) => cleanText(node.textContent).includes(name))) ?? null;
  };

  const closeAiKaki = async (role: RoleKey) => {
    setFocusBox(null);
    const header = aiHeader(role);
    const buttons = header ? Array.from(header.querySelectorAll<HTMLButtonElement>('button')) : [];
    const close = buttons[buttons.length - 1] ?? null;
    if (close) await click(role, () => close, `${role} AI Kaki close`);
  };

  const aiKakiOpen = (role: RoleKey): boolean => {
    try {
      return Array.from(frameDocument(role).querySelectorAll('div')).some((el) => {
        if (!visible(el)) return false;
        const cls = String(el.className);
        return cls.includes('fixed') && cls.includes('inset-0') && cls.includes('z-30');
      });
    } catch {
      return false;
    }
  };

  const aiBubbleCount = (role: RoleKey) => Array.from(frameDocument(role).querySelectorAll('span'))
    .filter((element) => {
      const cls = String((element as HTMLElement).className);
      return cls.includes('rounded-2xl') && cls.includes('px-3.5');
    }).length;

  const askAiKaki = async (
    role: RoleKey,
    agentName: 'Pelita' | 'Bekal' | 'Pondok',
    prompt: string,
    answerNeedle: string,
    resultSceneId: string,
    resultCaption: string,
  ) => {
    setFocusBox(null);
    await click(role, () => button(role, 'AI Kaki'), `${role} AI Kaki`);
    await wait(fast ? 40 : 220);
    let header = aiHeader(role);
    let title = cleanText(header?.textContent);
    if (!title.includes(agentName)) {
      if (title && !title.includes('AI Kaki')) {
        const back = header?.querySelector<HTMLButtonElement>('button') ?? null;
        if (back) await click(role, () => back, `${role} AI Kaki back`);
      }
      await click(role, () => button(role, agentName), `${agentName} picker`);
    }
    await fill(role, () => inputByPlaceholder(role, `Ask ${agentName}`), prompt, `${agentName} prompt`);
    const aiInput = await waitFor(() => inputByPlaceholder(role, `Ask ${agentName}`), `${agentName} input`);
    const send = aiInput.parentElement?.querySelector('button') as HTMLButtonElement | null;
    if (!send) throw new Error(`${agentName} send button not found`);
    const beforeCount = aiBubbleCount(role);
    await click(role, () => send, `${agentName} send`);
    await wait(fast ? 80 : 700);
    await waitFor(
      () => {
        const text = cleanText(frameDocument(role).body.textContent);
        const answered = aiBubbleCount(role) >= beforeCount + 2;
        return answered && !text.includes(`${agentName} is checking`) && new RegExp(answerNeedle, 'i').test(text) ? document.body : null;
      },
      `${agentName} answer`,
      90000,
    );
    await narrate(resultSceneId, 'Director', resultCaption);
    await closeAiKaki(role);
  };

  const seedScenario = async () => {
    if (!sessionId) throw new Error('Demo session has not started');
    setCursor({ x: window.innerWidth / 2, y: window.innerHeight * 0.58, visible: true, down: true });
    await wait(fast ? 70 : 220);
    setCursor((current) => ({ ...current, down: false }));
    const receipt = await api<SeedReceipt>(`/api/demo/${sessionId}/seed`, { method: 'POST' });
    setSeedReceipt(receipt);
    const nextStatus = await api<DemoStatus>(`/api/demo/${sessionId}/status`);
    setStatus(nextStatus);
    return receipt;
  };

  const shutdownActors = () => {
    (Object.keys(actors) as RoleKey[]).forEach((role) => frameWindow(role).__kkDemo?.shutdown());
  };

  const cleanup = async () => {
    if (!sessionId) return;
    setPhase('cleaning');
    setCamera('resident');
    setChapter('Clean teardown');
    setNetworkState('online');
    shutdownActors();
    await rawSleep(fast ? 120 : 650);
    setFramesVisible(false);
    const result = await api<{ removedObjects: number; residue: number; audit: string }>(
      `/api/demo/${sessionId}/cleanup`,
      { method: 'POST' },
    );
    const finalStatus = await api<DemoStatus>(`/api/demo/${sessionId}/status`);
    setStatus(finalStatus);
    if (result.residue !== 0 || finalStatus.retainedObjects !== 0) {
      throw new Error(`Cleanup left ${Math.max(result.residue, finalStatus.retainedObjects)} demo objects`);
    }
    setAuditLine(result.audit);
    setCaption(`${result.removedObjects} session objects were removed. One completion line remains.`);
    setCaptionKind('action');
    setPhase('complete');
  };

  const togglePause = () => {
    if (phase !== 'running') return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (next) {
      pauseDemoAudio();
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.pause();
      setCursor((current) => ({ ...current, down: false }));
    } else {
      resumeDemoAudio();
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.resume();
    }
  };

  const stopActiveNarration = () => {
    stopQwenScene();
    cancelSpeechRef.current?.();
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  };

  const requestStop = (restart: boolean) => {
    if (phase !== 'running') return;
    restartRequestedRef.current = restart;
    runAfterPrepareRef.current = restart;
    stopRequestedRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    stopActiveNarration();
    setSpeaker('AI Director');
    setCaption(restart ? 'Restart requested. Cleaning this session before opening a new one.' : 'Termination requested. Cleaning every object created by this session.');
    setCaptionKind('action');
  };

  const terminate = async () => {
    if (phase === 'running') {
      requestStop(false);
      return;
    }
    if (phase === 'ready') await cleanup();
  };

  const restart = async () => {
    if (phase === 'running') {
      requestStop(true);
      return;
    }
    if (phase === 'ready') await cleanup();
    runAfterPrepareRef.current = true;
    await prepare();
  };

  const run = async () => {
    if (!sessionId || loaded.size !== 3) return;
    setPhase('running');
    setError(null);
    stopRequestedRef.current = false;
    restartRequestedRef.current = false;
    try {
      await switchCamera('resident', 'Live setup · Director');
      await flashPresentationCard(
        'LIVE APP CONTROL',
        'SMOKE AT EXIT B',
        'THREE LIVE MAPS',
        'One incident across a citizen, a responder, and ops.',
      );
      await narrate(
        'god-deploy',
        'Director',
        'This is not a video. I am opening three real users on one live map, then driving reports, responders, alerts, and case state through M Q T T.',
      );

      await login('resident');
      await flashCutscene(
        'Smoke at MRT Exit B',
        'Rain, e-bike smoke, a crowded choke point — seconds before someone goes down.',
      );
      await narrate(
        'resident-intro',
        'Mei Ling',
        'It is pouring at the M R T exit. An e bike is smoking at the covered choke point and people are crowding under shelter. I am asthmatic, so first I make sure my aid card is set.',
      );
      await click('resident', () => frameDocument('resident').querySelector('button[title="Your profile"]'), 'resident profile');
      await fill('resident', () => inputByLabel('resident', 'Phone'), '9000 2810', 'resident phone');
      await fill('resident', () => inputByLabel('resident', 'Allergies'), 'No known drug allergies', 'resident allergies');
      await ensureProfileChip('resident', 'profile-meiling-asthma', 'Asthma', 'Mei Ling marks asthma so smoke guidance can use her actual aid card.');
      await ensureProfileChip('resident', 'profile-meiling-inhaler', 'Inhaler', 'She also records that she carries an inhaler. Only a responder who joins her S O S can see this.');
      await click('resident', () => button('resident', 'Save', true), 'save resident profile');
      await closeSheet('resident', 'Profile');

      await login('responder');
      await narrate(
        'responder-intro',
        'Aisha',
        'I am Aisha, a nearby community responder. I begin in lepak mode: no mission, no private details, and no false urgency until I choose to go on duty.',
      );
      await click('responder', () => frameDocument('responder').querySelector('button[title="Your profile"]'), 'responder profile');
      await ensureProfileChip('responder', 'profile-aisha-medical', 'Medical', 'Aisha marks medical support so the app can match her to a Medical S O S.');
      await ensureProfileChip('responder', 'profile-aisha-hazard', 'Hazard', 'She also marks hazard support because smoke and blocked access affect this response.');
      await click('responder', () => button('responder', 'Save', true), 'save responder profile');
      await closeSheet('responder', 'Profile');

      await login('ops');
      await narrate(
        'ops-intro',
        'Nadia',
        'I am Nadia in ops. I am not here to improvise heroics; I see reports, responders, cases, and map evidence, then decide what to publish and who to send.',
      );

      await switchCamera('resident', 'Citizen · Pelita reads the map');
      await narrate(
        'resident-report',
        'Director',
        'Pelita is an A I Kaki agent, not another human role. Mei Ling asks one conditions question, and Pelita reads the same map snapshot already refreshed by the app.',
      );
      await askAiKaki(
        'resident',
        'Pelita',
        'How is it looking around me right now near the MRT exit?',
        'rain|traffic|air|PSI|condition',
        'pelita-result',
        'Pelita has turned the cached rain, air, and traffic readings into one useful local answer. No extra upstream fetch was needed.',
      );
      await flashEvidenceCard('PELITA · CONDITIONS', 'CACHE SNAPSHOT', 'Pelita reads the same live conditions snapshot already powering the map.');

      await switchCamera('responder', 'Responder · availability and map');
      await narrate(
        'responder-duty',
        'Aisha',
        'I am nearby, but the system should not page me just because I exist. I go on duty and declare medical plus hazard support.',
      );
      await ensureResponderDuty(true);

      await switchCamera('resident', 'Citizen · urgent escalation');
      await narrate(
        'resident-sos',
        'Mei Ling',
        'Now it is an emergency. An elderly man near the smoke has collapsed and is not responding properly. I am the witness, he is the casualty, and this needs a Medical S O S.',
      );
      await click('resident', () => button('resident', 'Need help', true), 'need help');
      await click('resident', () => button('resident', 'Medical', true), 'medical SOS');
      await fill('resident', () => inputByPlaceholder('resident', 'friend collapsed'), 'Nicoll Highway MRT Exit B: e-bike smoke at the covered walkway. Elderly man collapsed; I am the witness, he is the casualty. Need AED and responders.', 'SOS details');
      await click('resident', () => button('resident', 'Send for help', true), 'send SOS');
      await focusSosArea(
        'resident',
        'focus-resident-sos',
        'The map zooms into the actual S O S at Exit B. From this point onward, every hospital, A E D, traffic, camera, and weather check is measured from this incident.',
      );
      await narrate(
        'bekal-intro',
        'Director',
        'Bekal is the S O S companion A I. It does not dispatch anyone. It calls the A E D and hospital skills, then gives Mei Ling specific guidance while responders move.',
      );
      await askAiKaki(
        'resident',
        'Bekal',
        'Elderly man collapsed after e-bike smoke at Nicoll Highway MRT Exit B. I am the witness; he is the casualty. Which AED and A&E hospital should bystanders use, and what should I do while Aisha is coming?',
        'AED|hospital|A&E|CPR|995',
        'bekal-result',
        'Bekal has returned the nearest A E D, an emergency hospital, and immediate safety guidance. Those skill results are also rendered as map pins.',
      );
      await flashEvidenceCard('BEKAL · AED + HOSPITAL SKILLS', 'MAP PINS GENERATED', 'Bekal calls the AED and hospital skills on bundled data — no upstream API — then the app renders those directives as real pins.');
      await waitFor(() => button('responder', 'Someone nearby needs help'), 'responder page');

      await seedScenario();
      await narrate(
        'god-agents',
        'Director',
        'Now I add disposable witness reports, rain pressure, and A I responder agents. They support the S O S; they are not the emergency trigger.',
      );

      await switchCamera('all', 'MQTT · one truth in three clients');
      await narrate(
        'propagation',
        'Director',
        'The same incident now exists in three maps. Mei Ling sees her S O S. Aisha receives a matched page. Nadia sees smoke reports and the live case forming.',
      );
      await flashPresentationCard(
        'MQTT FANOUT',
        '3 REPORTS → OPS CONTEXT',
        '1 SOS → PRIVATE CASE',
        'Retained topics replay into every role without retyping the story.',
      );

      await switchCamera('responder', 'Responder · accepts with map evidence');
      await focusSosArea(
        'responder',
        'focus-responder-sos',
        'Aisha opens the matched S O S area first. She checks resources and access around Exit B, not random markers elsewhere in Singapore.',
      );
      await inspectMapLayer(
        'responder',
        'map-aisha-aed',
        'aeds',
        'AED',
        'nearest AED',
        'Aisha opens the nearest A E D to the S O S, because she may need to run for the device while another responder starts C P R.',
      );
      await inspectMapLayer(
        'responder',
        'map-aisha-lta',
        'incidents',
        'Traffic incident',
        'nearest LTA incident',
        'Aisha checks the nearest L T A traffic-incident record to Exit B. Its distance from the S O S is shown before she chooses her approach.',
      );
      await narrate(
        'responder-join',
        'Aisha',
        'Before I join, I see the category and location but not private medical details. Once I commit, the case room opens and the aid card becomes useful.',
      );
      await click('responder', () => button('responder', 'Someone nearby needs help'), 'open nearby SOS');
      await click('responder', () => button('responder', 'Join & help'), 'join SOS');
      const swarm = await spawnSwarm();
      if (!swarm.responders) throw new Error('God Mode swarm did not attach responders to the SOS');
      await flashPresentationCard(
        'GOD MODE RESPONDERS',
        `${swarm.responders} BOT USERS`,
        'LIVE APPROACH MARKERS',
        'AED runner · medical lead · crowd guide · fire watch · traffic access',
      );
      await fill('responder', () => inputByPlaceholder('responder', 'Message the case'), 'Mei Ling — on my way from the north exit, about ninety seconds. Your aid card shows asthma, so keep your inhaler close in this smoke. If the elderly man is not breathing normally, start CPR and send someone safe toward the marked AED.', 'case chat');
      const chatInput = await waitFor(() => inputByPlaceholder('responder', 'Message the case'), 'case chat input');
      const sendChat = chatInput.parentElement?.querySelector('button') as HTMLButtonElement | null;
      if (sendChat) await click('responder', () => sendChat, 'send case chat');

      await switchCamera('resident', 'Citizen · help becomes visible');
      await waitFor(
        () => (frameWindow('resident').__kkMapDemo?.responderMarkerCount() ?? 0) >= swarm.responders
          ? document.body
          : null,
        'resident swarm markers',
        30000,
      );
      await focusSosArea(
        'resident',
        'focus-resident-swarm',
        'Mei Ling returns to the S O S area. The close map now shows the casualty point and responder approach markers together.',
      );
      await narrate(
        'resident-relief',
        'Mei Ling',
        'This is the moment that matters. My map does not merely say help is coming. I can see responders moving toward me and an A E D runner assigned.',
      );
      await wait(fast ? 120 : 300);

      await switchCamera('ops', 'Ops · verify before broadcast');
      await narrate(
        'ops-verify',
        'Nadia',
        'The S O S is already live. The reports are supporting context, so I verify with the map before I broadcast: access, cameras, rain, A E Ds, and emergency hospitals.',
      );
      await focusSosArea(
        'ops',
        'focus-ops-sos',
        'Nadia zooms directly to Exit B. Every public-data popup that follows is the nearest available reading or facility to this S O S.',
      );
      await inspectMapLayer(
        'ops',
        'map-ops-lta',
        'incidents',
        'Traffic incident',
        'nearest LTA incident',
        'Nadia opens the nearest L T A traffic-incident record to Exit B and checks its displayed distance from the S O S.',
      );
      await inspectMapLayer(
        'ops',
        'map-ops-camera',
        'cameras',
        'Traffic camera',
        'nearest traffic camera',
        'Nadia opens the nearest traffic camera to Exit B. The image is relevant to the incident access route, not a random island-wide camera.',
      );
      await inspectMapLayer(
        'ops',
        'map-ops-rain',
        'rainfall',
        'Rainfall',
        'nearest rainfall station',
        'Nadia checks the nearest rainfall station to the S O S because rain pushes people into the covered choke point and slows movement.',
      );
      await inspectMapLayer(
        'ops',
        'map-ops-aed',
        'aeds',
        'AED',
        'nearest AED',
        'Nadia opens the nearest A E D to Exit B to decide who should fetch it instead of duplicating medical support.',
      );
      await inspectMapLayer(
        'ops',
        'map-ops-hospital',
        'hospitals',
        'Hospital',
        'nearest A&E hospital',
        'Nadia opens the nearest emergency hospital to the S O S, giving the case a concrete escalation point if the casualty worsens.',
      );
      await click('ops', () => button('ops', 'Ops'), 'ops queue');
      await click('ops', () => button('ops', 'Smoke at MRT Exit B'), 'smoke report');
      await click('ops', () => button('ops', 'Verify → publish as incident'), 'verify report');

      await switchCamera('ops', 'Ops · command the whole picture');
      await narrate(
        'pondok-intro',
        'Director',
        'Pondok is the ops lookout A I. It reads the roster, cases, reports, and map context, suggests responder fit, and leaves the send decision to Nadia.',
      );
      await askAiKaki(
        'ops',
        'Pondok',
        'Ops picture for Exit B: active medical SOS for collapsed elderly casualty, supporting smoke and access reports, on-duty responders. Which responder fits AED support and what facts should I verify before broadcast?',
        'Aisha|Wei Jian|AED|medical|responder|SOS',
        'pondok-result',
        'Pondok has compared the live roster with the case: Aisha fits medical and hazard support, while Wei Jian fits the A E D run. Nadia still decides the deployment.',
      );
      await flashEvidenceCard('PONDOK · ROSTER + FIT', 'INFORMS, NEVER ORDERS', 'Pondok reads the on-duty roster, cases and reports from the CSOT snapshot. It gives skill fit and defers the send decision to the operator.');
      await narrate(
        'ops-deploy-bot',
        'Nadia',
        'Now my job is coordination. Medical goes to the collapsed person, the A E D runner goes to the nearest device, and traffic access checks the road.',
      );
      await narrate(
        'ops-investigation-action',
        'Director',
        'Nadia opens the blocked-access report and creates a separate investigation instead of confusing it with the medical casualty.',
      );
      await click('ops', () => button('ops', 'Emergency access road blocked'), 'access road report');
      await click('ops', () => button('ops', 'Dispatch to investigate'), 'dispatch access investigation');
      await click('ops', () => button('ops', 'Send', true), 'send investigation');
      await flashPresentationCard(
        'DISPATCH CREATED',
        'MEDICAL · SEARCH · AED',
        'TRAFFIC ACCESS CHECK',
        'The medical case and road-access investigation remain separate, but share the same live map.',
      );

      await narrate(
        'ops-broadcast',
        'Nadia',
        'The smoke and access risk are verified, so I warn people away from the station exit without exposing the private case room.',
      );
      await narrate(
        'ops-broadcast-action',
        'Director',
        'Nadia targets everyone near Exit B, marks the warning as Emergency, and writes one clear public action: keep the walkway and access road clear.',
      );
      await click('ops', () => button('ops', 'Broadcast', true), 'broadcast action');
      await click('ops', () => button('ops', 'Everyone', true), 'broadcast audience');
      await click('ops', () => button('ops', 'Emergency', true), 'broadcast urgency');
      await fill('ops', () => inputByPlaceholder('ops', 'Bishan'), 'Nicoll Highway MRT Exit B', 'broadcast area');
      await fill('ops', () => inputByPlaceholder('ops', 'Flash flood'), 'Avoid MRT Exit B smoke incident', 'broadcast message');
      await fill('ops', () => inputByPlaceholder('ops', 'What people should do'), 'Keep the covered walkway and access road clear for responders.', 'broadcast details');
      await click('ops', () => button('ops', 'Send broadcast', true), 'send broadcast');
      await flashPresentationCard(
        'PUBLIC WARNING SENT',
        'AVOID EXIT B',
        'PRIVATE CASE STAYS PRIVATE',
        'The public receives the hazard and access instruction. Medical details remain inside the S O S room.',
      );

      await switchCamera('responder', 'Resilience · useful while the link stutters');
      await narrate(
        'resilience-drop',
        'Director',
        "Now I break only Aisha's route to M Q T T. The app may keep working locally, but it must not pretend the broker has delivered her arrival.",
      );
      frameWindow('responder').__kkDemo?.setTransportOnline(false);
      setNetworkState('stuttering');
      await wait(fast ? 100 : 900);
      await click('responder', () => button('responder', 'On scene', true), 'offline on-scene update');
      await narrate(
        'responder-offline',
        'Aisha',
        'I mark myself on scene while the connection is down. My phone keeps the retained update queued instead of lying to Mei Ling.',
      );

      await switchCamera('resident', 'Citizen · no false acknowledgement');
      await narrate(
        'resident-before-reconcile',
        'Director',
        "Mei Ling still has not received Aisha's arrival. That restraint is important: no false acknowledgement before M Q T T delivers it.",
      );
      frameWindow('responder').__kkDemo?.setTransportOnline(true);
      setNetworkState('online');
      await waitFor(
        () => cleanText(frameDocument('resident').body.textContent).includes('someone is on scene') ? document.body : null,
        'queued arrival to reconcile',
        20000,
      );
      await narrate(
        'reconciled',
        'Director',
        "The connection returns. M Q T T flushes the queued retained update, and Mei Ling's map reconciles to someone on scene.",
      );

      await switchCamera('resident', 'Citizen · trusted alert and closure');
      await narrate(
        'resident-alert-action',
        'Director',
        'The ops warning has reached Mei Ling. The demo opens her alerts to show the delivered result before closing the case.',
      );
      await click('resident', () => frameDocument('resident').querySelector('button[title="Alerts"]'), 'resident alerts');
      await waitFor(() => cleanText(frameDocument('resident').body.textContent).includes('Avoid MRT Exit B smoke incident') ? document.body : null, 'resident broadcast');
      await narrate(
        'resident-safe',
        'Mei Ling',
        "The alert tells everyone else what to avoid. In my case room I can see who is here; the A E D is with the elderly man, responders have him, and I am clear of the smoke. So I tap I'm safe.",
      );
      await closeSheet('resident', 'Alerts');
      await click('resident', () => button('resident', "I'm safe", true), 'citizen safe acknowledgement');

      await switchCamera('responder', 'Responder · dual acknowledgement');
      await narrate(
        'responder-resolve',
        'Aisha',
        "The citizen's safe button is not enough by itself, and my field confirmation is not enough alone. The case closes only when both facts exist.",
      );
      await click('responder', () => button('responder', 'Resolved', true), 'responder resolution');
      await flashPresentationCard(
        'DUAL ACKNOWLEDGEMENT',
        'CITIZEN SAFE',
        'RESPONDER RESOLVED',
        'Only both acknowledgements close the live S O S.',
      );

      await switchCamera('all', 'Shared outcome');
      await narrate(
        'outcome',
        'Director',
        'Hospitals, A E Ds, traffic, cameras, weather, responders, chat, alerts, and state changes all served one story: map evidence plus M Q T T coordination.',
      );

      await switchCamera('resident', 'Clean teardown · Director');
      const before = await api<DemoStatus>(`/api/demo/${sessionId}/status`);
      setStatus(before);
      await narrate(
        'cleanup',
        'Director',
        'This performance is complete. I will remove the bots, users, reports, case messages, alerts, presence, and logs created by this session.',
      );
      await cleanup();
    } catch (caught) {
      const requestedStop = caught instanceof DemoStopped;
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!requestedStop) setError(message);
      try {
        await cleanup();
        if (restartRequestedRef.current) {
          runAfterPrepareRef.current = true;
          await prepare();
        } else if (!requestedStop) {
          setPhase('failed');
        }
      } catch (cleanupError) {
        setError(`${message}. Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        setPhase('failed');
      }
    }
  };

  useEffect(() => {
    if (!autostart || phase !== 'idle' || autostartPreparedRef.current) return;
    autostartPreparedRef.current = true;
    runAfterPrepareRef.current = true;
    void prepare();
  }, [autostart, phase]);

  useEffect(() => {
    if ((!autostart && !runAfterPrepareRef.current) || phase !== 'ready' || loaded.size !== 3 || autostartRunRef.current) return;
    autostartRunRef.current = true;
    runAfterPrepareRef.current = false;
    void run();
  }, [autostart, phase, loaded.size]);

  const frameUrl = (role: RoleKey) => {
    if (!sessionId) return 'about:blank';
    const url = new URL(window.location.origin);
    url.searchParams.set('demoSession', sessionId);
    url.searchParams.set('embedded', '1');
    url.searchParams.set('actor', role);
    url.searchParams.set('demoLng', String(ACTOR_LOCATIONS[role].lng));
    url.searchParams.set('demoLat', String(ACTOR_LOCATIONS[role].lat));
    return url.toString();
  };
  const markFrameReady = async (role: RoleKey) => {
    try {
      await waitFor(
        () => {
          const win = frameRefs.current[role]?.contentWindow as DemoWindow | null;
          const doc = frameRefs.current[role]?.contentDocument;
          if (!win?.__kkDemo || !doc || doc.readyState !== 'complete') return null;
          const loginReady = button(role, 'Explore in demo mode');
          const mapReady = visible(doc.querySelector('button[title="Your profile"]') as HTMLButtonElement);
          return loginReady || mapReady ? true : null;
        },
        `${role} embedded app ready`,
        30000,
      );
      setLoaded((current) => new Set(current).add(role));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('failed');
    }
  };
  const currentSpeaker = speakerProfile(speaker);
  const focusRole: RoleKey = camera === 'all' ? 'resident' : camera;
  const aiPanelOpen = aiKakiOpen(focusRole);

  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-[#171713] text-white"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
    >
      <div className="absolute inset-x-0 top-0 overflow-hidden bg-[#d8d4ca]" style={{ bottom: 'max(12vh, 96px)' }}>
        <div
          className="absolute left-1/2 top-0 h-screen w-screen origin-top"
          style={{ transform: 'translateX(-50%) scale(0.88)' }}
        >
          {framesVisible && sessionId ? (
            <>
          {(Object.keys(actors) as RoleKey[]).map((role, index) => {
            const all = camera === 'all';
            const active = camera === role;
            return (
              <div
                key={role}
                className="absolute top-0 h-full overflow-hidden bg-white transition-[left,width,opacity,transform] duration-500 ease-out"
                style={{
                  left: all ? `${index * 33.333}%` : 0,
                  width: all ? '33.333%' : '100%',
                  opacity: all || active ? 1 : 0,
                  pointerEvents: active ? 'auto' : 'none',
                  transform: all ? 'scale(0.985)' : 'scale(1)',
                  zIndex: active ? 3 : all ? 2 : 1,
                }}
              >
                <iframe
                  ref={(node) => { frameRefs.current[role] = node; }}
                  title={`${actors[role].roleLabel} demo client`}
                  src={frameUrl(role)}
                  onLoad={() => { void markFrameReady(role); }}
                  allow="geolocation"
                  className="h-full w-full border-0 bg-white"
                />
                {all && (
                  <div className="pointer-events-none absolute left-3 top-3 z-50 border-2 border-black bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-black shadow-[3px_3px_0_#111]">
                    AI {actors[role].roleLabel} · {actors[role].name}
                  </div>
                )}
              </div>
            );
          })}
            </>
          ) : (
            <iframe title="KampungKaki" src="/?embedded=1" className="h-full w-full border-0 bg-white" />
          )}
        </div>
      </div>

      {presentationCard && (
        <div
          key={presentationCard.id}
          className="kk-demo-title-backdrop pointer-events-none absolute inset-x-0 top-0 z-[215] flex items-center justify-center overflow-hidden bg-black/80 px-8 text-center"
          style={{ bottom: 'max(12vh, 96px)' }}
        >
          <div className="kk-demo-title-card max-w-[1180px]">
            <div className="text-[clamp(14px,1.5vw,22px)] font-black uppercase tracking-[0.35em] text-[#f1cf54]">
              {presentationCard.eyebrow}
            </div>
            <div className="mt-5 text-[clamp(58px,9vw,136px)] font-black uppercase leading-[0.82] tracking-[-0.07em] text-white">
              {presentationCard.title}
            </div>
            <div className="mt-7 text-[clamp(28px,4.2vw,64px)] font-black uppercase leading-none tracking-[-0.04em] text-white">
              {presentationCard.headline}
            </div>
            <div className="mx-auto mt-7 h-1 w-28 bg-[#e0001b]" />
            <div className="mt-5 text-[clamp(15px,1.7vw,24px)] font-bold uppercase tracking-[0.12em] text-white/75">
              {presentationCard.detail}
            </div>
          </div>
        </div>
      )}

      {cutscene && (
        <div
          key={cutscene.id}
          className="pointer-events-none absolute inset-x-0 top-0 z-[214] overflow-hidden bg-black"
          style={{ bottom: 'max(12vh, 96px)' }}
        >
          <img
            src={cutscene.image}
            alt=""
            className="h-full w-full object-cover opacity-90"
            style={{ animation: 'kkDemoShake 2.4s ease-in-out both' }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/30" />
          <div className="absolute bottom-10 left-10 max-w-3xl">
            <div className="text-[12px] font-black uppercase tracking-[0.35em] text-[#f1cf54]">AI CUTSCENE · STORYBOARD</div>
            <div className="mt-3 text-[clamp(38px,6vw,84px)] font-black uppercase leading-none tracking-[-0.06em] text-white">{cutscene.title}</div>
            <div className="mt-4 text-[clamp(14px,1.8vw,24px)] font-bold uppercase tracking-[0.08em] text-white/75">{cutscene.detail}</div>
          </div>
        </div>
      )}

      <footer
        className={`absolute inset-x-0 bottom-0 z-[220] min-h-[96px] border-t-2 border-black bg-[#f7f3e8] text-black transition-opacity duration-150 ${presentationCard || cutscene ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        style={{ height: 'max(12vh, 96px)' }}
      >
        <div className="flex h-6 items-center gap-4 overflow-hidden border-b border-black/20 px-4 text-[8px] font-black uppercase tracking-[0.12em] text-black/60">
          <span className="shrink-0 text-red-700">Live demo</span>
          <span className="truncate">Qwen custom voices + deterministic live UI actions</span>
          <span className="shrink-0">{sessionId ?? 'session not started'}</span>
          <span className="shrink-0">{status?.retainedObjects ?? 0} session objects</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${voiceReady ? 'bg-emerald-600' : 'bg-amber-500'}`} />
            Qwen voice {voiceReady ? 'ready' : 'checking'}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${networkState === 'online' ? 'bg-emerald-600' : 'animate-pulse bg-red-600'}`} />
            MQTT {networkState === 'online' ? 'live' : 'stuttering'}
          </span>
        </div>

        <div className="flex min-h-[70px] items-center gap-4 px-4" style={{ height: 'calc(100% - 24px)' }}>
          <div className="flex w-72 shrink-0 items-center gap-3">
            {currentSpeaker.ai || !currentSpeaker.image ? (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-black text-[#f1cf54] shadow-[3px_3px_0_#111]">
                <Sparkles className="h-7 w-7" />
              </div>
            ) : (
              <img
                src={currentSpeaker.image}
                alt=""
                className="h-14 w-14 rounded-lg border-2 border-black object-cover shadow-[3px_3px_0_#111]"
              />
            )}
            <div className="min-w-0">
              <div className="text-[8px] font-black uppercase tracking-[0.18em] text-red-700">
                {captionKind === 'speech' ? 'Now speaking' : 'Live action'}
              </div>
              <div className="truncate text-[16px] font-black uppercase leading-tight tracking-[-0.04em] text-black">{currentSpeaker.name}</div>
              <div className="truncate text-[8px] font-bold uppercase tracking-[0.12em] text-black/50">{currentSpeaker.role}</div>
              <div className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-[0.12em] text-black/45">{chapter}</div>
              {seedReceipt && <div className="text-[8px] text-black/45">{seedReceipt.responders} agents · {seedReceipt.reports} reports</div>}
            </div>
          </div>

          <p
            className="min-w-0 flex-1 text-[clamp(13px,1.35vw,19px)] font-semibold leading-snug"
            aria-live="polite"
            aria-label={`${speaker}: ${error ? `Demo stopped: ${error}` : auditLine ?? caption}`}
          >
            {error ? `Demo stopped: ${error}` : auditLine ?? caption}
          </p>

          <div className="flex shrink-0 items-center gap-1">
            {phase === 'idle' && (
              <button
                onClick={() => {
                  void unlockDemoAudio().then(() => {
                    try { window.speechSynthesis?.resume(); } catch { /* no tts */ }
                    runAfterPrepareRef.current = true;
                    void prepare();
                  });
                }}
                className="flex h-9 items-center gap-1.5 bg-[#f1cf54] px-3 text-[9px] font-black uppercase tracking-widest"
              >
                <Play className="h-3.5 w-3.5 fill-current" /> Play live demo
              </button>
            )}
            {phase === 'ready' && (
              <button
                onClick={() => { void unlockDemoAudio().then(() => run()); }}
                disabled={loaded.size !== 3}
                className="flex h-9 items-center gap-1.5 bg-[#f1cf54] px-3 text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {loaded.size === 3 ? 'Run' : `Roles ${loaded.size}/3`}
              </button>
            )}
            {phase === 'running' && (
              <button onClick={togglePause} className="flex h-9 items-center gap-1.5 bg-black px-3 text-[9px] font-black uppercase tracking-widest text-white">
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {paused ? 'Resume' : 'Pause'}
              </button>
            )}
            {(phase === 'ready' || phase === 'running' || phase === 'complete' || phase === 'failed') && (
              <button onClick={restart} className="flex h-9 items-center gap-1.5 border border-black px-3 text-[9px] font-black uppercase tracking-widest">
                <RotateCcw className="h-3.5 w-3.5" /> Restart
              </button>
            )}
            {(phase === 'ready' || phase === 'running') && (
              <button onClick={terminate} className="flex h-9 items-center gap-1.5 bg-red-700 px-3 text-[9px] font-black uppercase tracking-widest text-white">
                <Square className="h-3.5 w-3.5 fill-current" /> Terminate
              </button>
            )}
            {(phase === 'complete' || phase === 'failed') && (
              <button onClick={onExit} className="flex h-9 items-center gap-1.5 bg-black px-3 text-[9px] font-black uppercase tracking-widest text-white">
                <Check className="h-3.5 w-3.5" /> Return to app
              </button>
            )}
          </div>
        </div>
      </footer>

      {focusBox && !presentationCard && !cutscene && !aiPanelOpen && (
        <div
          key={focusBox.id}
          className="kk-demo-focus-pulse pointer-events-none fixed z-[190] rounded-lg border-2 border-[#f1cf54] bg-[#f1cf54]/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.14),0_0_16px_rgba(241,207,84,0.75)]"
          style={{ left: focusBox.x, top: focusBox.y, width: focusBox.w, height: focusBox.h }}
        >
          <div className="absolute -top-6 left-0 max-w-[190px] truncate rounded border border-black bg-[#f1cf54] px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-black shadow-[2px_2px_0_#111]">
            {focusBox.label}
          </div>
        </div>
      )}

      {cursor.visible && (
        <div
          className="pointer-events-none fixed z-[200] transition-[left,top] duration-300 ease-out"
          style={{ left: cursor.x, top: cursor.y, transform: `translate(-4px,-3px) scale(${cursor.down ? 0.82 : 1})` }}
        >
          <MousePointer2 className="h-7 w-7 fill-[#f1cf54] text-black drop-shadow-[2px_2px_0_rgba(255,255,255,0.9)]" strokeWidth={2.4} />
          {cursor.down && <span className="absolute -left-2 -top-2 h-11 w-11 animate-ping rounded-full border-2 border-[#f1cf54]" />}
        </div>
      )}
    </main>
  );
}
