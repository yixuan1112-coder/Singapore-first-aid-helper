// External store for Bekal's map directives (best-fit hospitals, AEDs, hazards).
// Bekal writes the marks it surfaced; MapCanvas renders them as pins. Kept out
// of AppContext so an AI reply never triggers a provider reload.

export interface BekalMark {
  kind: string;       // hospital | aed | hazard | …
  label: string;
  lng: number;
  lat: number;
  km?: number;
  best?: boolean;
}

let _marks: BekalMark[] = [];
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };

export const bekalDirectives = {
  subscribe(f: () => void): () => void { subs.add(f); return () => subs.delete(f); },
  snapshot(): string { return _marks.map((m) => `${m.kind}:${m.lng.toFixed(4)},${m.lat.toFixed(4)}`).join('|'); },
  get(): BekalMark[] { return _marks; },
  set(marks: BekalMark[]): void { _marks = Array.isArray(marks) ? marks : []; emit(); },
  clear(): void { _marks = []; emit(); },
};
