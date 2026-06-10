export type ProviderId = 'datagov' | 'datamall' | 'onemap' | 'openrouter';

type ProviderPolicy = {
  label: string;
  windowMs: number;
  maxCalls: number;
  minIntervalMs: number;
};

type ProviderHit = {
  at: number;
  reason: string;
};

const POLICIES: Record<ProviderId, ProviderPolicy> = {
  datagov: { label: 'Data.gov.sg', windowMs: 60 * 60_000, maxCalls: 20, minIntervalMs: 30_000 },
  datamall: { label: 'LTA DataMall', windowMs: 60 * 60_000, maxCalls: 10, minIntervalMs: 60_000 },
  onemap: { label: 'OneMap', windowMs: 60 * 60_000, maxCalls: 20, minIntervalMs: 30_000 },
  openrouter: { label: 'OpenRouter', windowMs: 60 * 60_000, maxCalls: 10, minIntervalMs: 10_000 },
};

const memoryHits: Partial<Record<ProviderId, ProviderHit[]>> = {};

export class ProviderRateLimitError extends Error {
  provider: ProviderId;
  retryAfterMs: number;
  userMessage: string;

  constructor(provider: ProviderId, retryAfterMs: number, reason: string) {
    const policy = POLICIES[provider];
    const seconds = Math.ceil(retryAfterMs / 1000);
    const message = `${policy.label} rate limit triggered for "${reason}". Retrying is blocked for about ${seconds}s to protect the API quota.`;
    super(message);
    this.name = 'ProviderRateLimitError';
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
    this.userMessage = message;
  }
}

export function getProviderPolicy(provider: ProviderId): ProviderPolicy {
  return POLICIES[provider];
}

export function guardProviderCall(provider: ProviderId, reason: string, now = Date.now()) {
  const policy = POLICIES[provider];
  const hits = readHits(provider).filter((hit) => now - hit.at < policy.windowMs);
  const previous = hits.at(-1);
  if (previous) {
    const sincePrevious = now - previous.at;
    if (sincePrevious < policy.minIntervalMs) {
      throw new ProviderRateLimitError(provider, policy.minIntervalMs - sincePrevious, reason);
    }
  }
  if (hits.length >= policy.maxCalls) {
    const oldest = hits[0];
    throw new ProviderRateLimitError(provider, policy.windowMs - (now - oldest.at), reason);
  }
  hits.push({ at: now, reason });
  writeHits(provider, hits);
}

export function getProviderQuotaState(provider: ProviderId, now = Date.now()) {
  const policy = POLICIES[provider];
  const hits = readHits(provider).filter((hit) => now - hit.at < policy.windowMs);
  const previous = hits.at(-1);
  const retryAfterMs = previous ? Math.max(0, policy.minIntervalMs - (now - previous.at)) : 0;
  return {
    provider,
    label: policy.label,
    callsInWindow: hits.length,
    maxCalls: policy.maxCalls,
    retryAfterMs,
    windowMs: policy.windowMs,
  };
}

function readHits(provider: ProviderId): ProviderHit[] {
  if (typeof window === 'undefined') return memoryHits[provider] ?? [];
  try {
    const raw = window.localStorage.getItem(storageKey(provider));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return memoryHits[provider] ?? [];
  }
}

function writeHits(provider: ProviderId, hits: ProviderHit[]) {
  memoryHits[provider] = hits;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(provider), JSON.stringify(hits));
  } catch {
    // Memory fallback is already updated.
  }
}

function storageKey(provider: ProviderId) {
  return `kampung-kaki:provider-quota:${provider}`;
}
