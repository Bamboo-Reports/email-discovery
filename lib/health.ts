import { verificationMethod } from './verifier';
import { logEvent } from './log';

/**
 * Lightweight up/down probes for the verification backends, shown in the nav
 * so users can tell when an engine is down. Neither probe spends a credit:
 * reacher's GET /version only proves the container answers (it does not test
 * the SOCKS5 → port 25 path), and MV's GET /credits is free.
 */

export type BackendId = 'reacher' | 'millionverifier';
export type BackendState = 'up' | 'degraded' | 'down' | 'unconfigured';

export interface BackendHealth {
  id: BackendId;
  label: string;
  state: BackendState;
  // whether VERIFICATION_METHOD routes checks to this engine
  inUse: boolean;
  latencyMs: number | null;
  detail: string;
}

export interface HealthReport {
  checkedAt: string;
  backends: BackendHealth[];
}

const TIMEOUT_MS = 8000;
const CACHE_MS = 30_000;

function errorDetail(e: any): string {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `no response within ${TIMEOUT_MS / 1000}s`;
  return e?.message ?? 'unknown error';
}

async function probeReacher(inUse: boolean): Promise<BackendHealth> {
  const base = { id: 'reacher' as const, label: 'reacher', inUse };
  const url = process.env.REACHER_BACKEND_URL;
  if (!url) return { ...base, state: 'unconfigured', latencyMs: null, detail: 'missing REACHER_BACKEND_URL' };

  const started = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/version`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ...base, state: 'down', latencyMs, detail: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({})) as { version?: string };
    return { ...base, state: 'up', latencyMs, detail: data.version ? `v${data.version}` : 'responding' };
  } catch (e: any) {
    return { ...base, state: 'down', latencyMs: null, detail: errorDetail(e) };
  }
}

async function probeMillionVerifier(inUse: boolean): Promise<BackendHealth> {
  const base = { id: 'millionverifier' as const, label: 'millionverifier', inUse };
  const key = process.env.MILLIONVERIFIER_API_KEY;
  if (!key) return { ...base, state: 'unconfigured', latencyMs: null, detail: 'missing MILLIONVERIFIER_API_KEY' };

  const url = new URL(`${process.env.MILLIONVERIFIER_BASE_URL || 'https://api.millionverifier.com/api/v3'}/credits`);
  url.searchParams.set('api', key);

  const started = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ...base, state: 'down', latencyMs, detail: `HTTP ${res.status}` };
    const data = await res.json() as { credits?: number; error?: string };
    if (data.error) return { ...base, state: 'down', latencyMs, detail: data.error.toLowerCase() };
    const credits = typeof data.credits === 'number' ? data.credits : null;
    if (credits !== null && credits <= 0) {
      return { ...base, state: 'degraded', latencyMs, detail: `out of credits (${credits} left)` };
    }
    return {
      ...base,
      state: 'up',
      latencyMs,
      detail: credits === null ? 'responding' : `${credits.toLocaleString('en-US')} credits left`,
    };
  } catch (e: any) {
    return { ...base, state: 'down', latencyMs: null, detail: errorDetail(e) };
  }
}

async function runProbes(): Promise<HealthReport> {
  const m = verificationMethod();
  const backends = await Promise.all([
    probeReacher(m !== 'MV'),
    probeMillionVerifier(m !== 'RR'),
  ]);
  for (const b of backends) {
    if (b.state === 'down' || b.state === 'degraded') {
      logEvent('health', b.state, { backend: b.id, detail: b.detail });
    }
  }
  return { checkedAt: new Date().toISOString(), backends };
}

// Per-instance cache so many open tabs polling don't each hit the backends.
let cached: { at: number; report: Promise<HealthReport> } | null = null;

export function getBackendHealth(): Promise<HealthReport> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), report: runProbes() };
  }
  return cached.report;
}
