import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MousePointer2, Pause, Play, Radio, RotateCcw, ShieldCheck, Square, UserRound } from 'lucide-react';
import { pauseDemoAudio, playQwenScene, resumeDemoAudio, stopQwenScene, unlockDemoAudio } from './demoAudio';

type RoleKey = 'resident' | 'responder' | 'ops';
type Camera = RoleKey | 'all';
type Phase = 'idle' | 'preparing' | 'ready' | 'running' | 'cleaning' | 'complete' | 'failed';

type DemoWindow = Window & {
  __kkDemo?: {
    identity: () => { userId: string } | null;
    setTransportOnline: (online: boolean) => void;
    shutdown: () => void;
  };
  __kkMapDemo?: {
    showLayerSample: (layerId: string) => { x: number; y: number; label: string } | null;
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
const actors: Record<RoleKey, { name: string; roleLabel: string; voiceRef: string; icon: typeof UserRound }> = {
  resident: { name: 'Mei Ling', roleLabel: 'Resident', voiceRef: '3_warm', icon: UserRound },
  responder: { name: 'Aisha', roleLabel: 'Responder', voiceRef: '2_amateur', icon: Radio },
  ops: { name: 'Nadia', roleLabel: 'Operations', voiceRef: '4_classically_trained', icon: ShieldCheck },
};

const speakerProfiles = [
  { match: 'Mei Ling', name: 'Mei Ling', role: 'Citizen witness', voice: '3_warm', image: '/demo/personas/mei-ling.png' },
  { match: 'Aisha', name: 'Aisha', role: 'Responder', voice: '2_amateur', image: '/demo/personas/aisha.png' },
  { match: 'Nadia', name: 'Nadia', role: 'Operations lead', voice: '4_classically_trained', image: '/demo/personas/nadia.png' },
  { match: 'Pelita', name: 'Pelita', role: 'AI Kaki · conditions', voice: '7_juilliard', image: '/demo/personas/pelita.png' },
  { match: 'God Mode', name: 'God Mode', role: 'Demo seed controller', voice: '7_juilliard', image: '/demo/personas/director.png' },
  { match: 'AI Director', name: 'AI Director', role: 'Narrator', voice: '7_juilliard', image: '/demo/personas/director.png' },
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

export default function DirectorStage({ autostart, onExit }: { autostart: boolean; onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Set<RoleKey>>(new Set());
  const [camera, setCamera] = useState<Camera>('resident');
  const [speaker, setSpeaker] = useState('AI Director');
  const [caption, setCaption] = useState('A clean, live demo begins with an empty session.');
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
  const stopRequestedRef = useRef(false);
  const restartRequestedRef = useRef(false);
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

  const visible = <T extends Element>(element: T): T | null => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? element : null;
  };

  const button = (role: RoleKey, text: string, exact = false): HTMLButtonElement | null => {
    const target = cleanText(text).toLowerCase();
    const buttons = Array.from(frameDocument(role).querySelectorAll('button'));
    return buttons
      .map((element) => visible(element))
      .find((element) => {
        if (!element) return false;
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
    await wait(fast ? 60 : 420);
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
    await wait(fast ? 50 : 180);
    setCursor((current) => ({ ...current, down: false }));
    await wait(fast ? 80 : 360);
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
    await wait(fast ? 50 : 260);
  };

  const switchCamera = async (next: Camera, nextChapter: string) => {
    setCamera(next);
    setChapter(nextChapter);
    setCursor((current) => ({ ...current, visible: false }));
    await wait(fast ? 80 : 650);
  };

  const narrate = async (id: string, nextSpeaker: string, text: string) => {
    setSpeaker(nextSpeaker);
    setCaption(text);
    if (fast) {
      await wait(180);
      return;
    }

    const played = await playQwenScene(id);
    if (played) {
      checkpoint();
      return;
    }
    checkpoint();
    throw new Error(`Qwen3-TTS voice asset unavailable: ${id}.wav`);
  };

  const flashPresentationCard = async (
    eyebrow: string,
    title: string,
    headline: string,
    detail: string,
  ) => {
    const id = ++presentationCardIdRef.current;
    setPresentationCard({ id, eyebrow, title, headline, detail });
    await wait(fast ? 120 : 3000);
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
    setCaption(`${actor.name} is entering as ${actor.roleLabel}.`);
    await flashPresentationCard(
      'AI ACTING AS',
      actor.roleLabel.toUpperCase(),
      actor.name.toUpperCase(),
      `Qwen3-TTS custom English reference · ${actor.voiceRef}`,
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

  const inspectMapLayer = async (
    role: RoleKey,
    layerId: string,
    toggleLabel: string,
    spokenLabel: string,
    detail: string,
  ) => {
    setCaption(detail);
    setChapter(`${actors[role].roleLabel} map evidence · ${spokenLabel}`);
    await ensureLayerOn(role, toggleLabel);
    await collapseLayerPanel(role);
    await wait(fast ? 80 : 360);
    const sample = await waitFor(
      () => frameWindow(role).__kkMapDemo?.showLayerSample(layerId) ?? null,
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
      setFocusBox({
        id,
        x: Math.max(14, screenPoint.x - 115),
        y: Math.max(56, screenPoint.y - 115),
        w: 230,
        h: 170,
        label: `${spokenLabel}: ${sample.label}`,
      });
      await wait(fast ? 120 : 3400);
      setFocusBox((current) => current?.id === id ? null : current);
    } else {
      await wait(fast ? 120 : 3400);
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
    try {
      const voiceResponse = await fetch('/demo/voice/manifest.json', { cache: 'no-store' });
      if (!voiceResponse.ok) throw new Error('Qwen3-TTS voice assets are missing. Run npm run demo:voice.');
      const voiceManifest = await voiceResponse.json() as { scenes?: Array<{ scene: string }> };
      const voiceScenes = new Set((voiceManifest.scenes ?? []).map((scene) => scene.scene));
      const requiredVoiceScenes = [
        'god-deploy', 'god-agents', 'resident-intro', 'resident-report', 'responder-intro', 'responder-duty',
        'ops-intro',
        'resident-sos', 'propagation', 'ops-verify', 'responder-join', 'resident-relief',
        'resilience-drop', 'responder-offline', 'resident-before-reconcile', 'reconciled',
        'ops-deploy-bot', 'ops-broadcast', 'resident-safe', 'responder-resolve', 'outcome', 'cleanup',
      ];
      const missing = requiredVoiceScenes.filter((id) => !voiceScenes.has(id));
      if (missing.length > 0) throw new Error(`Qwen3-TTS voice assets are incomplete: ${missing.join(', ')}`);
      setVoiceReady(true);
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
    setSpeaker(actor.name);
    setCaption(`${actor.name} is signing in as ${actor.roleLabel}.`);
    await flashRoleCard(role);
    await click(role, () => button(role, 'Explore in demo mode'), 'demo mode button');
    await fill(role, () => inputByPlaceholder(role, 'Mei Ling'), actor.name, `${role} name`);
    await click(role, () => button(role, actor.roleLabel), `${actor.roleLabel} role`);
    await waitFor(() => visible(frameDocument(role).querySelector('button[title="Your profile"]') as HTMLButtonElement), `${role} map`);
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

  const aiHeader = (role: RoleKey): HTMLElement | null => {
    const names = ['AI Kaki', 'Pelita', 'Bekal', 'Pondok'];
    return Array.from(frameDocument(role).querySelectorAll<HTMLElement>('header'))
      .find((node) => names.some((name) => cleanText(node.textContent).includes(name))) ?? null;
  };

  const closeAiKaki = async (role: RoleKey) => {
    const header = aiHeader(role);
    const buttons = header ? Array.from(header.querySelectorAll<HTMLButtonElement>('button')) : [];
    const close = buttons[buttons.length - 1] ?? null;
    if (close) await click(role, () => close, `${role} AI Kaki close`);
  };

  const aiBubbleCount = (role: RoleKey) => Array.from(frameDocument(role).querySelectorAll('span'))
    .filter((element) => {
      const cls = String((element as HTMLElement).className);
      return cls.includes('rounded-2xl') && cls.includes('px-3.5');
    }).length;

  const askAiKaki = async (role: RoleKey, agentName: 'Pelita' | 'Bekal' | 'Pondok', prompt: string, answerNeedle: string) => {
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
        return answered && !text.includes(`${agentName} is checking`) && text.includes(answerNeedle) ? document.body : null;
      },
      `${agentName} answer`,
      90000,
    );
    setCaption(`${agentName} answered. Holding the result on screen before moving on.`);
    await wait(fast ? 120 : 4800);
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
    setPhase('complete');
  };

  const togglePause = () => {
    if (phase !== 'running') return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (next) {
      pauseDemoAudio();
      setCursor((current) => ({ ...current, down: false }));
    } else {
      resumeDemoAudio();
    }
  };

  const stopActiveNarration = () => {
    stopQwenScene();
  };

  const requestStop = (restart: boolean) => {
    if (phase !== 'running') return;
    restartRequestedRef.current = restart;
    stopRequestedRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    stopActiveNarration();
    setSpeaker('AI Director');
    setCaption(restart ? 'Restart requested. Cleaning this session before opening a new one.' : 'Termination requested. Cleaning every object created by this session.');
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
    await prepare();
  };

  const run = async () => {
    if (!sessionId || loaded.size !== 3) return;
    setPhase('running');
    setError(null);
    stopRequestedRef.current = false;
    restartRequestedRef.current = false;
    try {
      await switchCamera('resident', 'Live setup · AI Director');
      await flashPresentationCard(
        'LIVE APP CONTROL',
        'SMOKE AT EXIT B',
        'THREE MAPS',
        'Target runtime · about 5 min 45 sec',
      );
      await narrate(
        'god-deploy',
        'AI Director',
        'This is not a video. I am opening three real users on one live map, then driving reports, responders, alerts, and case state through MQTT.',
      );
      await flashPresentationCard(
        'VOICE + CAPTIONS',
        'QWEN3-TTS 0.6B BASE',
        'CUSTOM FEMALE REFERENCES',
        'Director 7_juilliard · Mei Ling 3_warm · Aisha 2_amateur · Nadia 4_classically_trained',
      );
      await seedScenario();
      await narrate(
        'god-agents',
        'God Mode',
        'God Mode has staged eight AI responder agents, three station-exit field reports, and rain pressure. They are session-tagged and disposable.',
      );

      await login('resident');
      await flashCutscene(
        'Smoke at MRT Exit B',
        'Non-graphic AI cutscene: rain, e-bike smoke, a crowded choke point, and one collapsed casualty.',
      );
      await narrate(
        'resident-intro',
        'AI Resident · Mei Ling',
        'It is pouring at the MRT exit. People are packed under the covered walkway, an e-bike is burning near the choke point, and an elderly man has gone down.',
      );
      await click('resident', () => frameDocument('resident').querySelector('button[title="Your profile"]'), 'resident profile');
      await fill('resident', () => inputByLabel('resident', 'Phone'), '9000 2810', 'resident phone');
      await fill('resident', () => inputByLabel('resident', 'Allergies'), 'No known drug allergies', 'resident allergies');
      await click('resident', () => button('resident', 'Asthma', true), 'Asthma aid-card chip');
      await click('resident', () => button('resident', 'Inhaler', true), 'Inhaler aid-card chip');
      await click('resident', () => button('resident', 'Save', true), 'save resident profile');
      await closeSheet('resident', 'Profile');

      await login('responder');
      await narrate(
        'responder-intro',
        'AI Responder · Aisha',
        'I am Aisha, a nearby community responder. I begin in lepak mode: no mission, no private details, and no false urgency until I choose to go on duty.',
      );
      await click('responder', () => frameDocument('responder').querySelector('button[title="Your profile"]'), 'responder profile');
      await click('responder', () => button('responder', 'Medical', true), 'medical proficiency');
      await click('responder', () => button('responder', 'Hazard', true), 'hazard proficiency');
      await click('responder', () => button('responder', 'Save', true), 'save responder profile');
      await closeSheet('responder', 'Profile');

      await login('ops');
      await narrate(
        'ops-intro',
        'AI Operations · Nadia',
        'I am Nadia in operations. I am not here to improvise heroics; I see reports, responders, cases, and map evidence, then decide what to publish and who to send.',
      );

      await switchCamera('resident', 'Resident · Pelita reads the map');
      await narrate(
        'resident-report',
        'AI Kaki · Pelita',
        'Before Mei Ling acts, Pelita reads the map’s live snapshot: rain, air, traffic, and dengue. It does not fetch upstream; it reads what the app already refreshed.',
      );
      await askAiKaki('resident', 'Pelita', 'How do conditions look around me now?', 'rain');
      await flashEvidenceCard('PELITA · CONDITIONS-READ', 'CACHE SNAPSHOT', 'Rain, PSI, traffic, taxis, and dengue come from the map snapshot already refreshed by the app.');

      await switchCamera('responder', 'Responder · availability and map');
      await narrate(
        'responder-duty',
        'AI Responder · Aisha',
        'I am nearby, but the system should not page me just because I exist. I go on duty and declare medical plus hazard support.',
      );
      await ensureResponderDuty(true);
      await inspectMapLayer(
        'responder',
        'aeds',
        'AED',
        'AED layer',
        'Aisha checks the AED layer first, because a collapsed casualty changes her role from bystander to AED runner or CPR support.',
      );
      await inspectMapLayer(
        'responder',
        'incidents',
        'Traffic incident',
        'traffic incident',
        'Aisha checks the traffic incident marker before moving, because smoke and blocked roads change the approach path.',
      );

      await switchCamera('ops', 'Operations · evidence before broadcast');
      await narrate(
        'ops-verify',
        'AI Operations · Nadia',
        'I will not amplify one report blindly. My map checks access, cameras, rain, AEDs, and emergency hospitals before I publish.',
      );
      await inspectMapLayer(
        'ops',
        'incidents',
        'Traffic incident',
        'LTA incident',
        'Nadia opens the LTA traffic incident marker first: it tells her whether the access road already has disruption.',
      );
      await inspectMapLayer(
        'ops',
        'cameras',
        'Traffic camera',
        'traffic camera',
        'Nadia opens a traffic camera pin next. This is evidence for access and crowd build-up, not a decoration.',
      );
      await inspectMapLayer(
        'ops',
        'rainfall',
        'Rainfall',
        'rainfall station',
        'Nadia checks rainfall because rain pushes people into the covered choke point and slows responder movement.',
      );
      await inspectMapLayer(
        'ops',
        'aeds',
        'AED',
        'AED location',
        'Nadia opens the AED layer to know which responder should be sent for a device instead of duplicating medical support.',
      );
      await inspectMapLayer(
        'ops',
        'hospitals',
        'Hospital',
        'A&E hospital',
        'Nadia opens the A&E hospital layer last, so the case has an escalation point if CPR or smoke exposure worsens.',
      );
      await click('ops', () => button('ops', 'Operations'), 'operations queue');
      await click('ops', () => button('ops', 'Smoke at MRT Exit B'), 'smoke report');
      await click('ops', () => button('ops', 'Verify → publish as incident'), 'verify report');

      await switchCamera('resident', 'Resident · urgent escalation');
      await narrate(
        'resident-sos',
        'AI Resident · Mei Ling',
        'Now it is personal. The elderly man is not responding properly, smoke is thick, and I need responders, an AED runner, and a private case room.',
      );
      await click('resident', () => button('resident', 'Need help', true), 'need help');
      await click('resident', () => button('resident', 'Medical', true), 'medical SOS');
      await fill('resident', () => inputByPlaceholder('resident', 'friend collapsed'), 'E-bike fire smoke at MRT Exit B. Elderly man collapsed and is not responding properly.', 'SOS details');
      await click('resident', () => button('resident', 'Send for help', true), 'send SOS');
      await askAiKaki(
        'resident',
        'Bekal',
        'My elderly father collapsed near the MRT exit after e-bike smoke. He is not responding properly. What can you help with right now?',
        'Raffles',
      );
      await flashEvidenceCard('BEKAL · AED + HOSPITAL SKILLS', 'MAP PINS GENERATED', 'Bekal calls AED and hospital skills, then the app renders those directives as real pins.');
      await waitFor(() => button('responder', 'Someone nearby needs help'), 'responder page');

      await switchCamera('all', 'MQTT · one truth in three clients');
      await narrate(
        'propagation',
        'AI Director',
        'The same incident now exists in three maps. Mei Ling sees her SOS. Aisha receives a matched page. Nadia sees smoke reports and the live case forming.',
      );
      await flashPresentationCard(
        'MQTT FANOUT',
        '1 REPORT → 1 INCIDENT',
        '1 SOS → PRIVATE CASE',
        'Retained topics replay into every role without retyping the story.',
      );

      await switchCamera('responder', 'Responder · accepts with map evidence');
      await narrate(
        'responder-join',
        'AI Responder · Aisha',
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
      await fill('responder', () => inputByPlaceholder('responder', 'Message the case'), 'Mei Ling, I am coming from the north exit. Keep him away from smoke if safe, start CPR if he is not breathing normally, and send someone safe toward the marked AED.', 'case chat');
      const chatInput = await waitFor(() => inputByPlaceholder('responder', 'Message the case'), 'case chat input');
      const sendChat = chatInput.parentElement?.querySelector('button') as HTMLButtonElement | null;
      if (sendChat) await click('responder', () => sendChat, 'send case chat');

      await switchCamera('resident', 'Resident · help becomes visible');
      await waitFor(() => /responders? coming/.test(cleanText(frameDocument('resident').body.textContent)) ? document.body : null, 'resident swarm markers');
      await narrate(
        'resident-relief',
        'AI Resident · Mei Ling',
        'This is the moment that matters. My map does not merely say help is coming. I can see responders moving toward me and an AED runner assigned.',
      );
      await wait(fast ? 120 : 1100);

      await switchCamera('ops', 'Operations · command the whole picture');
      await askAiKaki(
        'ops',
        'Pondok',
        'Give me the current operating picture and which responder seems fit for AED support.',
        'Wei Jian',
      );
      await flashEvidenceCard('PONDOK · OPS PICTURE', 'ROSTER + CASES + REPORTS', 'Pondok reads responders, SOS cases, and civilian reports from the live CSOT snapshot.');
      await narrate(
        'ops-deploy-bot',
        'AI Operations · Nadia',
        'Now my job is coordination. Medical goes to the collapsed person, the AED runner goes to the nearest device, and traffic access checks the road.',
      );
      await click('ops', () => button('ops', 'Emergency access road blocked'), 'access road report');
      await click('ops', () => button('ops', 'Dispatch to investigate'), 'dispatch access investigation');
      await click('ops', () => button('ops', 'Send', true), 'send investigation');
      await flashPresentationCard(
        'OPS SPLITS WORK',
        'MEDICAL · SEARCH · AED',
        'TRAFFIC ACCESS CHECK',
        'Map layers are used for decisions, not decoration.',
      );

      await narrate(
        'ops-broadcast',
        'AI Operations · Nadia',
        'The smoke and access risk are verified, so I warn people away from the station exit without exposing the private case room.',
      );
      await click('ops', () => button('ops', 'Broadcast', true), 'broadcast action');
      await click('ops', () => button('ops', 'Everyone', true), 'broadcast audience');
      await click('ops', () => button('ops', 'Emergency', true), 'broadcast urgency');
      await fill('ops', () => inputByPlaceholder('ops', 'Bishan'), 'Nicoll Highway MRT Exit B', 'broadcast area');
      await fill('ops', () => inputByPlaceholder('ops', 'Flash flood'), 'Avoid MRT Exit B smoke incident', 'broadcast message');
      await fill('ops', () => inputByPlaceholder('ops', 'What people should do'), 'Keep the covered walkway and access road clear for responders.', 'broadcast details');
      await click('ops', () => button('ops', 'Send broadcast', true), 'send broadcast');

      await switchCamera('responder', 'Resilience · useful while the link stutters');
      await narrate(
        'resilience-drop',
        'AI Director',
        'Now I break only Aisha’s route to MQTT. The app may keep working locally, but it must not pretend the broker has delivered her arrival.',
      );
      frameWindow('responder').__kkDemo?.setTransportOnline(false);
      setNetworkState('stuttering');
      await wait(fast ? 100 : 900);
      await click('responder', () => button('responder', 'On scene', true), 'offline on-scene update');
      await narrate(
        'responder-offline',
        'AI Responder · Aisha',
        'I mark myself on scene while the connection is down. My phone keeps the retained update queued instead of lying to Mei Ling.',
      );

      await switchCamera('resident', 'Resident · no false acknowledgement');
      await narrate(
        'resident-before-reconcile',
        'AI Director',
        'Mei Ling still has not received Aisha’s arrival. That restraint is important: no false acknowledgement before MQTT delivers it.',
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
        'AI Director',
        'The connection returns. MQTT flushes the queued retained update, and the resident map reconciles to someone on scene.',
      );

      await switchCamera('resident', 'Resident · trusted alert and closure');
      await click('resident', () => frameDocument('resident').querySelector('button[title="Alerts"]'), 'resident alerts');
      await waitFor(() => cleanText(frameDocument('resident').body.textContent).includes('Avoid MRT Exit B smoke incident') ? document.body : null, 'resident broadcast');
      await narrate(
        'resident-safe',
        'AI Resident · Mei Ling',
        'The alert tells everyone else what to avoid. My case room tells me who is here. The AED runner and responders are visible, so I can mark myself safe.',
      );
      await closeSheet('resident', 'Alerts');
      await click('resident', () => button('resident', "I'm safe", true), 'resident safe acknowledgement');

      await switchCamera('responder', 'Responder · dual acknowledgement');
      await narrate(
        'responder-resolve',
        'AI Responder · Aisha',
        'The resident’s safe button is not enough by itself, and my field confirmation is not enough alone. The case closes only when both facts exist.',
      );
      await click('responder', () => button('responder', 'Resolved', true), 'responder resolution');

      await switchCamera('all', 'Shared outcome');
      await narrate(
        'outcome',
        'AI Director',
        'Hospitals, AEDs, traffic, cameras, weather, responders, chat, alerts, and state changes all served one story: map evidence plus MQTT coordination.',
      );

      await switchCamera('resident', 'Clean teardown · AI Director');
      const before = await api<DemoStatus>(`/api/demo/${sessionId}/status`);
      setStatus(before);
      await narrate(
        'cleanup',
        'AI Director',
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
    void prepare();
  }, [autostart, phase]);

  useEffect(() => {
    if (!autostart || phase !== 'ready' || loaded.size !== 3 || autostartRunRef.current) return;
    autostartRunRef.current = true;
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
  const currentSpeaker = speakerProfile(speaker);

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
                  onLoad={() => setLoaded((current) => new Set(current).add(role))}
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
            <div className="text-[12px] font-black uppercase tracking-[0.35em] text-[#f1cf54]">AI CUTSCENE · QWEN STORYBOARD</div>
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
          <span className="truncate">Deterministic semantic UI actions</span>
          <span className="shrink-0">{sessionId ?? 'session not started'}</span>
          <span className="shrink-0">{status?.retainedObjects ?? 0} session objects</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${voiceReady ? 'bg-emerald-600' : 'bg-amber-500'}`} />
            Voice {voiceReady ? 'ready' : 'checking'}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${networkState === 'online' ? 'bg-emerald-600' : 'animate-pulse bg-red-600'}`} />
            MQTT {networkState === 'online' ? 'live' : 'stuttering'}
          </span>
        </div>

        <div className="flex min-h-[70px] items-center gap-4 px-4" style={{ height: 'calc(100% - 24px)' }}>
          <div className="flex w-72 shrink-0 items-center gap-3">
            <img
              src={currentSpeaker.image}
              alt=""
              className="h-14 w-14 rounded-lg border-2 border-black object-cover shadow-[3px_3px_0_#111]"
            />
            <div className="min-w-0">
              <div className="text-[8px] font-black uppercase tracking-[0.18em] text-red-700">Now speaking</div>
              <div className="truncate text-[16px] font-black uppercase leading-tight tracking-[-0.04em] text-black">{currentSpeaker.name}</div>
              <div className="truncate text-[8px] font-bold uppercase tracking-[0.12em] text-black/50">{currentSpeaker.role} · Qwen {currentSpeaker.voice}</div>
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
                onClick={() => { void unlockDemoAudio().then(prepare); }}
                className="flex h-9 items-center gap-1.5 bg-[#f1cf54] px-3 text-[9px] font-black uppercase tracking-widest"
              >
                <Play className="h-3.5 w-3.5 fill-current" /> Play live demo
              </button>
            )}
            {phase === 'ready' && (
              <button
                onClick={run}
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

      {focusBox && !presentationCard && !cutscene && (
        <div
          key={focusBox.id}
          className="pointer-events-none fixed z-[190] rounded-xl border-[3px] border-[#f1cf54] bg-[#f1cf54]/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.16),0_0_22px_rgba(241,207,84,0.9)]"
          style={{ left: focusBox.x, top: focusBox.y, width: focusBox.w, height: focusBox.h }}
        >
          <div className="absolute -top-9 left-0 max-w-[320px] rounded-t-lg border-2 border-black bg-[#f1cf54] px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-black shadow-[3px_3px_0_#111]">
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
