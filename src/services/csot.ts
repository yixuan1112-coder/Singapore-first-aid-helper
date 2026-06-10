// The core layer. Everything reads and writes through here.
//
// Transport is MQTT-over-WebSockets to Mosquitto; Redis (behind the bridge) is
// the durable mirror. The design goal is that a STUTTERING connection keeps
// working at this layer:
//
//   • Persistent session (clean:false) + QoS 1  → publishes made while offline
//     are queued by the client and flushed, in order, at-least-once on
//     reconnect. Idempotent topic ids make redelivery safe.
//   • Retained messages                          → on (re)connect the broker
//     immediately replays the current value of every subscribed topic. No
//     polling, no thundering herd.
//   • Optimistic local apply                     → a write updates local state
//     instantly, so the UI never blocks on the network; the broker is the
//     reconciler once the link returns.
//   • LWT presence                               → if you drop, the broker
//     publishes your "offline" will within the keepalive window.
//
// Topic plan (docs/ARCHITECTURE.md §4): csot/<cluster>/<type>/<id>, plus
// csot/presence/<role>/<userId>.

import mqtt, { type MqttClient } from 'mqtt';

const MQTT_URL = import.meta.env.VITE_MQTT_URL ?? 'ws://localhost:9001';
// Default to the app origin. Vite proxies these bridge routes in development,
// so the live app and Director use one public site instead of exposing :8787.
const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL ?? '';
const DEMO_SESSION_ID = typeof window === 'undefined'
  ? null
  : new URLSearchParams(window.location.search).get('demoSession');

export type Cluster =
  | 'intake' | 'incidents' | 'operations' | 'network' | 'intel' | 'presentation';

export interface Identity {
  userId: string;
  session: string;
  name: string;
  role: string;
}

export type Status = 'connecting' | 'online' | 'degraded';

type Listener = () => void;

function topicsForIdentity(id: Identity): string[] {
  // Permission scoping happens HERE, at the transport — not just in the UI — so
  // a citizen's browser never even receives another citizen's private signals.
  //   • ops        → the whole tree.
  //   • responder  → incidents + operations + ALL sos (they accept SOS), but NOT
  //                  raw citizen reports (those are ops-only until verified).
  //   • citizen    → incidents/network/intel + ONLY their own sos & reports +
  //                  case chat. Owner id in the topic path enforces the privacy.
  // Owned-by-me topics: my private aid card + my role's notification/log feed.
  // The aid card is NEVER broadly subscribed — even ops only gets it via the
  // snapshot attached to an SOS, not by browsing the directory.
  const own = [
    `csot/network/aidcard/${id.userId}`,
    `csot/presentation/notification/${id.role}/#`,
    `csot/presentation/log/${id.role}/#`,
  ];
  // Shared, non-sensitive: incidents, the public user directory (name+role, no
  // aid card), intel, presence.
  const shared = ['csot/incidents/#', 'csot/network/user/#', 'csot/intel/#', 'csot/presence/#'];

  if (id.role === 'ops') {
    // Ops oversees everything, including every private case room.
    return [...own, ...shared, 'csot/intake/#', 'csot/operations/#', 'csot/case/#'];
  }
  if (id.role === 'responder') {
    // Responders DISCOVER SOS via the public signal (intake/sos), but a case
    // room (csot/case/<id>) is private — they only receive it after they JOIN,
    // via a dynamic subscription. Not subscribed broadly here.
    return [...own, ...shared, 'csot/operations/#', 'csot/intake/sos/#'];
  }
  // citizen — only their own SOS/report signal; their own case room is added
  // dynamically when they raise an SOS. No blanket chat subscription anymore.
  return [
    ...own,
    ...shared,
    `csot/intake/sos/${id.userId}/#`,
    `csot/intake/report/${id.userId}/#`,
  ];
}

class Csot {
  identity: Identity | null = null;
  status: Status = 'connecting';
  version = 0; // bumped on every change so React can re-snapshot
  /** True when the last join reused a saved demo account (vs minting fresh).
   *  Callers use it to AVOID clobbering retained profile/skills with defaults. */
  restored = false;

  private client: MqttClient | null = null;
  private store = new Map<string, unknown>(); // topic -> latest object
  private listeners = new Set<Listener>();
  // Per-case subscriptions added at runtime (e.g. when you raise or join an
  // SOS). Kept here so they survive a reconnect — re-applied in connect().
  private dynamicSubs = new Set<string>();
  private demoTransportPaused = false;
  private demoPublishQueue = new Map<string, string>();

  private decorate<T>(value: T): T {
    if (!DEMO_SESSION_ID || !value || typeof value !== 'object' || Array.isArray(value)) return value;
    return { ...value, demoSessionId: DEMO_SESSION_ID } as T;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // Demo accounts persist locally: the same name+role always maps to the same
  // identity, so logging out and back in restores everything that lives under
  // that userId (profile, aid card, skills, your SOS/reports — all retained in
  // the broker). Without this, every login minted a fresh user and lost it all.
  private acctKey(name: string, role: string): string {
    const scope = DEMO_SESSION_ID ? `${DEMO_SESSION_ID}:` : '';
    return `kk-demo-acct:${scope}${role}:${name.trim().toLowerCase()}`;
  }
  private loadAccount(name: string, role: string): Identity | null {
    try {
      const raw = localStorage.getItem(this.acctKey(name, role));
      const id = raw ? (JSON.parse(raw) as Identity) : null;
      return id && id.userId ? id : null;
    } catch { return null; }
  }
  private saveAccount(id: Identity): void {
    try { localStorage.setItem(this.acctKey(id.name, id.role), JSON.stringify(id)); } catch { /* ignore */ }
  }

  /** Reuse the saved demo identity for this name+role, or mint a fresh one from
   *  the bridge; then connect the core transport. */
  async join(name: string, role: string): Promise<Identity> {
    const saved = this.loadAccount(name, role);
    if (saved) {
      this.restored = true;
      this.identity = saved;
      this.connect(saved);
      return saved;
    }
    this.restored = false;
    const res = await fetch(`${BRIDGE_URL}/api/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, role, demoSessionId: DEMO_SESSION_ID }),
    });
    if (!res.ok) throw new Error(`join failed: HTTP ${res.status}`);
    const id = (await res.json()) as Identity;
    this.identity = id;
    this.saveAccount(id);
    this.connect(id);
    return id;
  }

  private connect(id: Identity): void {
    this.client?.end(true);
    this.status = 'connecting';
    this.emit();

    const presenceTopic = `csot/presence/${id.role}/${id.userId}`;
    const presence = (online: boolean) =>
      JSON.stringify(this.decorate({ userId: id.userId, role: id.role, name: id.name, online, at: Date.now() }));

    const client = mqtt.connect(MQTT_URL, {
      clientId: `kk-${id.userId}`,
      clean: false, // keep the session so queued QoS-1 writes survive a stutter
      reconnectPeriod: 1500, // keep retrying while the link flaps
      connectTimeout: 8000,
      keepalive: 20,
      will: { topic: presenceTopic, payload: presence(false), qos: 1, retain: true },
    });

    client.on('connect', () => {
      this.status = 'online';
      for (const t of topicsForIdentity(id)) client.subscribe(t, { qos: 1 });
      for (const t of this.dynamicSubs) client.subscribe(t, { qos: 1 }); // re-apply case rooms
      client.publish(presenceTopic, presence(true), { qos: 1, retain: true });
      if (!this.demoTransportPaused && this.demoPublishQueue.size > 0) {
        for (const [topic, payload] of this.demoPublishQueue) {
          client.publish(topic, payload, { qos: 1, retain: true });
        }
        this.demoPublishQueue.clear();
      }
      this.emit();
    });
    client.on('reconnect', () => { this.status = 'connecting'; this.emit(); });
    client.on('offline', () => { this.status = 'degraded'; this.emit(); });
    client.on('close', () => { if (this.status === 'online') { this.status = 'degraded'; this.emit(); } });
    client.on('error', () => { this.status = 'degraded'; this.emit(); });
    client.on('message', (topic, payload) => {
      if (!payload || payload.length === 0) this.store.delete(topic); // tombstone
      else {
        try { this.store.set(topic, JSON.parse(payload.toString())); } catch { /* skip */ }
      }
      this.emit();
    });

    this.client = client;
  }

  // ── private case rooms: arbitrary-topic pub/sub for csot/case/<id>/# ───────
  // These bypass the cluster/type/id shape so a room can hold members + chat
  // under one prefix that only its participants subscribe to.

  subscribeTopic(topic: string): void {
    this.dynamicSubs.add(topic);
    this.client?.subscribe(topic, { qos: 1 });
  }

  unsubscribeTopic(topic: string): void {
    this.dynamicSubs.delete(topic);
    this.client?.unsubscribe(topic);
    const prefix = topic.replace(/#$/, '');
    for (const k of [...this.store.keys()]) if (k.startsWith(prefix)) this.store.delete(k);
    this.emit();
  }

  publishTopic(topic: string, obj: unknown): void {
    const decorated = this.decorate(obj);
    this.store.set(topic, decorated);
    this.emit();
    this.publishRetained(topic, JSON.stringify(decorated));
  }

  removeTopic(topic: string): void {
    this.store.delete(topic);
    this.emit();
    this.publishRetained(topic, '');
  }

  collectionByPrefix<T = unknown>(prefix: string): T[] {
    const out: T[] = [];
    for (const [t, v] of this.store) if (t.startsWith(prefix)) out.push(v as T);
    return out;
  }

  leave(): void {
    const id = this.identity;
    if (id && this.client) {
      // clean offline marker, then disconnect
      this.client.publish(
        `csot/presence/${id.role}/${id.userId}`,
        JSON.stringify({ userId: id.userId, role: id.role, name: id.name, online: false, at: Date.now() }),
        { qos: 1, retain: true },
      );
    }
    this.client?.end();
    this.client = null;
    this.identity = null;
    this.store.clear();
    this.dynamicSubs.clear();
    this.demoPublishQueue.clear();
    this.demoTransportPaused = false;
    this.status = 'connecting';
    this.emit();
  }

  /** Optimistic write: apply locally now, publish (queued if offline) retained. */
  put(cluster: Cluster, type: string, id: string, obj: unknown): void {
    const topic = `csot/${cluster}/${type}/${id}`;
    const decorated = this.decorate(obj);
    this.store.set(topic, decorated);
    this.emit();
    this.publishRetained(topic, JSON.stringify(decorated));
  }

  remove(cluster: Cluster, type: string, id: string): void {
    const topic = `csot/${cluster}/${type}/${id}`;
    this.store.delete(topic);
    this.emit();
    this.publishRetained(topic, ''); // empty retained = delete
  }

  collection<T = unknown>(cluster: Cluster, type: string): T[] {
    const prefix = `csot/${cluster}/${type}/`;
    const out: T[] = [];
    for (const [t, v] of this.store) if (t.startsWith(prefix)) out.push(v as T);
    return out;
  }

  /** Read one exact object by its full key (used for precise role-copy edits). */
  get<T = unknown>(cluster: Cluster, type: string, id: string): T | undefined {
    return this.store.get(`csot/${cluster}/${type}/${id}`) as T | undefined;
  }

  presence<T = unknown>(): T[] {
    const out: T[] = [];
    for (const [t, v] of this.store) if (t.startsWith('csot/presence/')) out.push(v as T);
    return out;
  }

  private publishRetained(topic: string, payload: string): void {
    if (DEMO_SESSION_ID && this.demoTransportPaused) {
      // Retain only the latest write per idempotent CSOT topic. This is the
      // application-level outbox used by the live resilience demonstration.
      this.demoPublishQueue.set(topic, payload);
      return;
    }
    this.client?.publish(topic, payload, { qos: 1, retain: true });
  }

  /** Demo-only transport control. Destroying the socket while keeping the MQTT
   * client alive exercises its offline QoS queue; reconnect flushes queued
   * writes to the broker. It is intentionally unavailable outside a tagged
   * demo session. */
  setDemoTransportOnline(online: boolean): void {
    if (!DEMO_SESSION_ID || !this.client) return;
    const options = this.client.options as typeof this.client.options & { reconnectPeriod: number };
    if (!online) {
      this.demoTransportPaused = true;
      options.reconnectPeriod = 0;
      this.status = 'degraded';
      this.client.stream?.destroy();
      this.emit();
      return;
    }
    this.demoTransportPaused = false;
    options.reconnectPeriod = 1500;
    this.status = 'connecting';
    this.emit();
    this.client.reconnect();
  }

  demoShutdown(): void {
    if (!DEMO_SESSION_ID) return;
    this.leave();
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.includes(DEMO_SESSION_ID)) localStorage.removeItem(key);
      }
    } catch {
      // Best-effort cleanup; the server remains the source of truth.
    }
  }
}

export const csot = new Csot();

let demoQuickJoinImpl: ((name: string, role: string) => void) | null = null;

/** Showcase director calls this via iframe window.__kkDemo.quickJoin. */
export function registerDemoQuickJoin(fn: ((name: string, role: string) => void) | null) {
  demoQuickJoinImpl = fn;
}

export function demoQuickJoinReady() {
  return demoQuickJoinImpl !== null;
}

declare global {
  interface Window {
    __kkDemo?: {
      identity: () => Identity | null;
      topicCount: (prefix: string) => number;
      setTransportOnline: (online: boolean) => void;
      shutdown: () => void;
      /** Embedded showcase: sign in without puppeting the Join UI. */
      quickJoin?: (name: string, role: string) => void;
      quickJoinReady?: () => boolean;
    };
  }
}

if (typeof window !== 'undefined' && DEMO_SESSION_ID) {
  window.__kkDemo = {
    identity: () => csot.identity,
    topicCount: (prefix) => csot.collectionByPrefix(prefix).length,
    setTransportOnline: (online) => csot.setDemoTransportOnline(online),
    shutdown: () => csot.demoShutdown(),
    quickJoin: (name, role) => {
      if (!demoQuickJoinImpl) throw new Error('Demo client still starting — try again in a moment.');
      demoQuickJoinImpl(name, role);
    },
    quickJoinReady: () => demoQuickJoinReady(),
  };
}
