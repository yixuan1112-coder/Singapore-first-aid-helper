export type DemoWindow = Window & {
  __kkDemo?: {
    identity: () => { userId: string; name?: string; role?: string } | null;
    topicCount: (prefix: string) => number;
    setTransportOnline: (online: boolean) => void;
    shutdown: () => void;
    quickJoin?: (name: string, role: string) => void;
    quickJoinReady?: () => boolean;
  };
  __kkAgent?: {
    replyCount: (agent: string) => number;
    lastReply: (agent: string) => string;
    busy: () => boolean;
    conditionsReady?: () => boolean;
  };
  __kkMapDemo?: {
    focusLocation: (near: { lng: number; lat: number }, zoom?: number) => void;
    showLayerSample: (
      layerId: string,
      near?: { lng: number; lat: number },
      zoomOverride?: number,
    ) => { x: number; y: number; label: string; distanceKm: number } | null;
    clearEvidence: () => void;
    placeMapPick?: (at: { lng: number; lat: number }) => void;
  };
  /** Quick showcase: Bekal uses demoBekalFast.ts instead of POST /api/ai/ask. */
  __kkDemoBekalFast?: boolean;
};

export const INCIDENT_LOCATION = { lng: 103.8644, lat: 1.3022 };

export const cleanText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

export class DemoStopped extends Error {
  constructor() {
    super('Showcase stopped');
  }
}

export function createPuppet(deps: {
  frameRef: () => HTMLIFrameElement | null;
  checkpoint: () => void;
  wait: (ms: number) => Promise<void>;
  setCursor: (next: { x: number; y: number; visible: boolean; down: boolean }) => void;
}) {
  const { frameRef, checkpoint, wait, setCursor } = deps;

  const frameDocument = (): Document => {
    const doc = frameRef()?.contentDocument;
    if (!doc) throw new Error('Embedded app is not ready');
    return doc;
  };

  const frameWindow = (): DemoWindow => {
    const win = frameRef()?.contentWindow as DemoWindow | null;
    if (!win) throw new Error('Embedded app window is not ready');
    return win;
  };

  const visible = <T extends Element>(element: T | null | undefined): T | null => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? element : null;
  };

  const waitFor = async <T,>(read: () => T | null | undefined, label: string, timeout = 12000): Promise<T> => {
    let elapsed = 0;
    while (elapsed < timeout) {
      checkpoint();
      const value = read();
      if (value) return value;
      await wait(100);
      elapsed += 100;
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  const reveal = async (element: Element) => {
    const doc = frameDocument();
    const before = element.getBoundingClientRect();
    const viewportH = doc.documentElement.clientHeight || frameWindow().innerHeight;
    const viewportW = doc.documentElement.clientWidth || frameWindow().innerWidth;
    const offscreen =
      before.top < 16 ||
      before.left < 16 ||
      before.bottom > viewportH - 16 ||
      before.right > viewportW - 16;
    if (offscreen) {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      await wait(120);
    }
  };

  const button = (text: string, exact = false): HTMLButtonElement | null => {
    const target = cleanText(text).toLowerCase();
    const buttons = Array.from(frameDocument().querySelectorAll('button'));
    return buttons
      .map((element) => visible(element))
      .find((element) => {
        if (!element || element.disabled) return false;
        const content = cleanText(element.textContent).toLowerCase();
        return exact ? content === target : content.includes(target);
      }) ?? null;
  };

  const inputByPlaceholder = (text: string): HTMLInputElement | HTMLTextAreaElement | null => {
    const target = text.toLowerCase();
    const fields = Array.from(frameDocument().querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
    return fields.map((element) => visible(element)).find((element) => element?.placeholder.toLowerCase().includes(target)) ?? null;
  };

  const moveCursor = async (element: Element) => {
    const frame = frameRef();
    if (!frame) return;
    await reveal(element);
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
    await wait(180);
  };

  const moveCursorToFramePoint = async (point: { x: number; y: number }) => {
    const frame = frameRef();
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
    await wait(280);
  };

  const framePointToScreen = (point: { x: number; y: number }) => {
    const frame = frameRef();
    if (!frame) return null;
    const frameRect = frame.getBoundingClientRect();
    const scaleX = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight > 0 ? frameRect.height / frame.offsetHeight : 1;
    return {
      x: frameRect.left + point.x * scaleX,
      y: frameRect.top + point.y * scaleY,
    };
  };

  const click = async (read: () => HTMLElement | null, label: string) => {
    const element = await waitFor(read, label);
    await moveCursor(element);
    setCursor({ x: 0, y: 0, visible: true, down: true });
    element.click();
    await wait(90);
    setCursor({ x: 0, y: 0, visible: true, down: false });
    await wait(140);
  };

  const fill = async (
    read: () => HTMLInputElement | HTMLTextAreaElement | null,
    value: string,
    label: string,
  ) => {
    const element = await waitFor(read, label);
    await moveCursor(element);
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
    await wait(100);
  };

  const ensureLayerOn = async (label: string) => {
    const target = label.toLowerCase();
    const read = () => {
      const buttons = Array.from(frameDocument().querySelectorAll<HTMLButtonElement>('button'));
      return buttons
        .map((element) => visible(element))
        .find((element) => cleanText(element?.textContent).toLowerCase().includes(target)) ?? null;
    };
    let layer = read();
    if (!layer) await click(() => button('Layers'), 'layers panel');
    layer = await waitFor(read, `map layer ${label}`);
    const alreadyOn = String(layer.className).includes('bg-surface-3');
    if (!alreadyOn) await click(() => layer, `enable ${label}`);
    else await moveCursor(layer);
  };

  const collapseLayerPanel = async () => {
    const open = cleanText(frameDocument().body.textContent).includes('Care & rescue');
    if (open) await click(() => button('Layers'), 'collapse layers');
  };

  const aiHeader = (): HTMLElement | null => {
    const names = ['AI Kaki', 'Pelita', 'Bekal', 'Pondok'];
    return Array.from(frameDocument().querySelectorAll<HTMLElement>('header'))
      .find((node) => names.some((name) => cleanText(node.textContent).includes(name))) ?? null;
  };

  const closeAiKaki = async () => {
    const header = aiHeader();
    const buttons = header ? Array.from(header.querySelectorAll<HTMLButtonElement>('button')) : [];
    const close = buttons[buttons.length - 1] ?? null;
    if (close) await click(() => close, 'AI Kaki close');
  };

  const aiBubbleCount = () => Array.from(frameDocument().querySelectorAll('span'))
    .filter((element) => {
      const cls = String((element as HTMLElement).className);
      return cls.includes('rounded-2xl') && cls.includes('px-3.5');
    }).length;

  const askAiKaki = async (
    agentName: 'Pelita' | 'Bekal' | 'Pondok',
    prompt: string,
    answerNeedle: string,
    timeoutMs: number,
  ) => {
    await click(() => button('AI Kaki'), 'AI Kaki');
    await wait(120);
    let header = aiHeader();
    let title = cleanText(header?.textContent);
    if (!title.includes(agentName)) {
      if (title && !title.includes('AI Kaki')) {
        const back = header?.querySelector<HTMLButtonElement>('button') ?? null;
        if (back) await click(() => back, 'AI Kaki back');
      }
      await click(() => button(agentName), `${agentName} picker`);
    }
    await fill(() => inputByPlaceholder(`Ask ${agentName}`), prompt, `${agentName} prompt`);
    const aiInput = await waitFor(() => inputByPlaceholder(`Ask ${agentName}`), `${agentName} input`);
    const send = aiInput.parentElement?.querySelector('button') as HTMLButtonElement | null;
    if (!send) throw new Error(`${agentName} send button not found`);
    const beforeCount = aiBubbleCount();
    await click(() => send, `${agentName} send`);
    await wait(500);
    try {
      await waitFor(
        () => {
          const text = cleanText(frameDocument().body.textContent);
          const answered = aiBubbleCount() >= beforeCount + 2;
          return answered && !text.includes(`${agentName} is checking`) && new RegExp(answerNeedle, 'i').test(text)
            ? true
            : null;
        },
        `${agentName} answer`,
        timeoutMs,
      );
    } catch {
      // Timeout — caller narrates fallback; demo keeps moving.
    }
    await closeAiKaki();
  };

  return {
    frameDocument,
    frameWindow,
    visible,
    waitFor,
    button,
    inputByPlaceholder,
    click,
    fill,
    moveCursor,
    moveCursorToFramePoint,
    framePointToScreen,
    ensureLayerOn,
    collapseLayerPanel,
    askAiKaki,
    closeAiKaki,
  };
}

export type QuickPuppet = ReturnType<typeof createPuppet>;
