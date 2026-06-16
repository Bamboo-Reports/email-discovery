import { Redis } from '@upstash/redis';
import { logEvent } from './log';

/**
 * Shared, durable store of each domain's learned email format.
 *
 * Maps a domain -> the pattern spec index that produced a valid address (see
 * lib/patterns.ts). Backed by Upstash Redis so the learning is shared across the
 * whole org and survives deploys/restarts. A process-local cache sits in front
 * to avoid a network round-trip per row during bulk runs; writes go through to
 * both layers. When Upstash isn't configured, it degrades to the in-memory
 * cache only (useful for local dev and CI builds).
 */

const KEY_PREFIX = 'domainfmt:';

// Process-local write-through cache. Persists across requests within a single
// server instance (the API routes run on the nodejs runtime).
const local = new Map<string, number>();

let redis: Redis | null = null;
let redisChecked = false;

function getRedis(): Redis | null {
  if (redisChecked) return redis;
  redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
    logEvent('domainfmt', 'store-init', { backend: 'upstash' });
  } else {
    logEvent('domainfmt', 'store-init', { backend: 'memory-only' });
  }
  return redis;
}

export async function getDomainFormat(domain: string): Promise<number | undefined> {
  if (local.has(domain)) {
    const value = local.get(domain);
    logEvent('domainfmt', 'cache-hit', { layer: 'local', domain, index: value });
    return value;
  }

  const client = getRedis();
  if (!client) {
    logEvent('domainfmt', 'cache-miss', { layer: 'local', domain, backend: 'none' });
    return undefined;
  }

  try {
    const value = await client.get<number>(KEY_PREFIX + domain);
    if (typeof value === 'number') {
      local.set(domain, value);
      logEvent('domainfmt', 'cache-hit', { layer: 'upstash', domain, index: value });
      return value;
    }
    logEvent('domainfmt', 'cache-miss', { layer: 'upstash', domain });
  } catch (e) {
    // Treat store errors as "not learned yet" — we fall back to checking all
    // patterns rather than failing the lookup.
    logEvent('domainfmt', 'read-error', { domain, error: (e as Error)?.message });
  }
  return undefined;
}

export async function setDomainFormat(domain: string, index: number): Promise<void> {
  if (local.get(domain) === index) {
    logEvent('domainfmt', 'learn-skip', { domain, index, reason: 'unchanged' });
    return; // already current, skip the write
  }
  local.set(domain, index);

  const client = getRedis();
  if (!client) {
    logEvent('domainfmt', 'learn', { domain, index, persisted: false });
    return;
  }

  try {
    await client.set(KEY_PREFIX + domain, index);
    logEvent('domainfmt', 'learn', { domain, index, persisted: true });
  } catch (e) {
    // Best-effort: a failed write just means later contacts re-learn it.
    logEvent('domainfmt', 'write-error', { domain, index, error: (e as Error)?.message });
  }
}

/** Clear the process-local cache (does not touch Upstash). For tests. */
export function clearLearnedFormats(): void {
  local.clear();
}
