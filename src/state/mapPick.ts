// Tiny external store for "tap the map to choose a point" — used by ops Declare
// so a declaration is placed WHERE OPS CLICKS, not at the operator's own GPS.
// MapCanvas captures the next click while a request is active; the requester
// (DeclareComposer) reads the resolved point. Kept out of AppContext so it never
// triggers a provider re-render / reload.

export interface PickPoint { lng: number; lat: number }

let _requesting = false;
let _picked: PickPoint | null = null;
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };

export const mapPick = {
  subscribe(f: () => void): () => void { subs.add(f); return () => subs.delete(f); },
  /** snapshot for useSyncExternalStore — a stable primitive that changes on emit */
  snapshot(): string { return `${_requesting ? 1 : 0}:${_picked ? `${_picked.lng},${_picked.lat}` : ''}`; },
  isRequesting(): boolean { return _requesting; },
  picked(): PickPoint | null { return _picked; },
  /** requester: begin asking for a map click */
  request(): void { _requesting = true; _picked = null; emit(); },
  /** requester: stop asking (e.g. cancelled) */
  cancel(): void { _requesting = false; emit(); },
  /** MapCanvas: a click happened while requesting */
  resolve(p: PickPoint): void { _picked = p; _requesting = false; emit(); },
  /** requester: consume the picked point once */
  take(): PickPoint | null { const p = _picked; _picked = null; emit(); return p; },
};
