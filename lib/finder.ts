import { checkPrimary, checkSecondOpinion, checkWithMv, primaryIsReacher, isBothMode, type CheckResult } from './verifier';
import { generatePatterns, generatePatternsPreferring } from './patterns';
import { getDomainFormat, setDomainFormat } from './domainFormatStore';
import { logEvent } from './log';

export { clearLearnedFormats } from './domainFormatStore';

export type Status = 'valid' | 'accept-all' | 'not found';
export type VerifyStatus = 'valid' | 'invalid' | 'accept-all' | 'not found';

/** One provider's verdict, surfaced alongside the headline (see BOTH mode). */
export interface ProviderResult {
  status: VerifyStatus;
  confidence: number;
}

export interface FindResult {
  email: string;
  status: Status;
  confidence: number;
  mx?: string | null;
  patternIndex?: number | null;
  apiCalls: number;
  creditsLeft?: number | null;
  rr?: ProviderResult | null;
  mv?: ProviderResult | null;
  /** Result served from a recent stored discovery — no verifier calls, no credits. */
  cached?: boolean;
  /** created_at of the stored discovery the cached result came from. */
  cachedAt?: string;
}

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  confidence: number;
  mx?: string | null;
  apiCalls: number;
  creditsLeft?: number | null;
  rr?: ProviderResult | null;
  mv?: ProviderResult | null;
  /** Result served from a recent stored verification — no verifier call, no credit. */
  cached?: boolean;
  /** created_at of the stored verification the cached result came from. */
  cachedAt?: string;
}

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

const sub = (c: CheckResult): ProviderResult => ({ status: c.status, confidence: c.confidence });

/**
 * Label the primary + optional second-opinion sub-results as rr / mv.
 * The primary is reacher whenever reacher is involved (RR/BOTH mode); in MV-only
 * mode the primary is MV and there is never a second opinion.
 */
function labelProviders(
  primary: CheckResult,
  second: CheckResult | null,
): { rr: ProviderResult | null; mv: ProviderResult | null } {
  if (primaryIsReacher()) {
    return { rr: sub(primary), mv: second ? sub(second) : null };
  }
  return { rr: null, mv: sub(primary) };
}

/**
 * Find a likely email by generating local name/domain patterns and checking
 * each candidate through the configured verification backend (lib/verifier).
 *
 * Optimization: once a domain's format is learned (a contact resolved valid via
 * a given pattern), later contacts on that domain check that pattern first and
 * return on the first hit — cutting MillionVerifier calls. The learned format
 * is stored durably and shared org-wide via lib/domainFormatStore.
 */
export async function findEmail(first: string, last: string, domain: string): Promise<FindResult> {
  const d = domain.trim().toLowerCase();
  const learned = await getDomainFormat(d);
  const patterns =
    learned !== undefined
      ? generatePatternsPreferring(first, last, d, learned)
      : generatePatterns(first, last, d);
  const top = patterns[0];

  logEvent('finder', 'lookup-start', {
    domain: d,
    contact: `${first} ${last}`.trim(),
    learnedFormat: learned ?? 'none',
    candidates: patterns.length,
  });

  // Each verification consumes one credit (MillionVerifier), so creditsUsed equals
  // apiCalls. creditsLeft is the balance reported by the most recent response
  // (null for reacher, which has no credit concept).
  // The find's overall reacher verdict when nothing resolves is "not found".
  const rrNotFound: CheckResult = { status: 'not found', confidence: 0, creditsLeft: null };
  let apiCalls = 0;
  let creditsLeft: number | undefined;
  for (const p of patterns) {
    const result = await checkPrimary(p.email);
    apiCalls++;
    if (typeof result.creditsLeft === 'number') creditsLeft = result.creditsLeft;
    const status = result.status;

    // RR confidently confirmed the address — trust it, no MV credit spent.
    if (status === 'valid') {
      await setDomainFormat(d, p.index);
      const { rr, mv } = labelProviders(result, null);
      logEvent('finder', 'lookup-done', {
        domain: d, status: 'valid', email: p.email, patternIndex: p.index,
        usedLearned: p.index === learned, apiCalls, creditsUsed: apiCalls,
        apiCallsSaved: patterns.length - apiCalls, creditsLeft: creditsLeft ?? 'n/a',
      });
      return { email: p.email, status: 'valid', confidence: p.score, mx: null, patternIndex: p.index, apiCalls, creditsLeft, rr, mv };
    }

    // Catch-all domain — trusted as RR's final answer, no MV credit spent.
    if (status === 'accept-all') {
      const { rr, mv } = labelProviders(result, null);
      logEvent('finder', 'lookup-done', {
        domain: d, status: 'accept-all', email: top.email, apiCalls, creditsUsed: apiCalls,
        creditsLeft: creditsLeft ?? 'n/a',
      });
      return {
        email: top.email, status: 'accept-all',
        confidence: +(top.score * result.confidence).toFixed(2),
        mx: null, patternIndex: top.index, apiCalls, creditsLeft, rr, mv,
      };
    }

    // The learned (preferred) pattern came back negative from reacher — but we have
    // high confidence in the learned format, so reacher is likely wrong (throttled /
    // probe-blocked). Stop hammering the other 10 patterns and let the MV sweep settle
    // it (the sweep checks the learned pattern first). Big speed win on these domains.
    if ((result.inconclusive || result.status === 'invalid') && learned !== undefined && p.index === learned) break;
  }

  // Reacher couldn't confirm anything (all invalid/unknown). In BOTH mode, reacher's
  // negatives can be false (throttling / probe-blocking servers), so hand the WHOLE
  // pattern set to MV — preferring the learned pattern first — until it confirms one.
  if (isBothMode()) {
    let lastMv: CheckResult | null = null;
    for (const p of patterns) {
      let mvSub: CheckResult;
      try {
        mvSub = await checkWithMv(p.email);
      } catch (e: any) {
        logEvent('finder', 'mv-sweep-error', { email: p.email, error: e?.message ?? 'unknown' });
        break;
      }
      apiCalls++;
      if (typeof mvSub.creditsLeft === 'number') creditsLeft = mvSub.creditsLeft;
      lastMv = mvSub;

      if (mvSub.status === 'valid') {
        await setDomainFormat(d, p.index);
        const { rr, mv } = labelProviders(rrNotFound, mvSub);
        logEvent('finder', 'lookup-done', {
          domain: d, status: 'valid', email: p.email, patternIndex: p.index,
          apiCalls, creditsUsed: apiCalls, creditsLeft: creditsLeft ?? 'n/a', recoveredByMv: true,
        });
        return { email: p.email, status: 'valid', confidence: p.score, mx: null, patternIndex: p.index, apiCalls, creditsLeft, rr, mv };
      }

      if (mvSub.status === 'accept-all') {
        const { rr, mv } = labelProviders(rrNotFound, mvSub);
        logEvent('finder', 'lookup-done', {
          domain: d, status: 'accept-all', email: top.email, patternIndex: top.index,
          apiCalls, creditsUsed: apiCalls, creditsLeft: creditsLeft ?? 'n/a', recoveredByMv: true,
        });
        return {
          email: top.email, status: 'accept-all',
          confidence: +(top.score * mvSub.confidence).toFixed(2),
          mx: null, patternIndex: top.index, apiCalls, creditsLeft, rr, mv,
        };
      }
    }

    const { rr, mv } = labelProviders(rrNotFound, lastMv);
    logEvent('finder', 'lookup-done', {
      domain: d, status: 'not found', apiCalls, creditsUsed: apiCalls,
      creditsLeft: creditsLeft ?? 'n/a', mvSwept: true,
    });
    return { email: '', status: 'not found', confidence: 0, mx: null, patternIndex: null, apiCalls, creditsLeft, rr, mv };
  }

  logEvent('finder', 'lookup-done', {
    domain: d, status: 'not found', apiCalls, creditsUsed: apiCalls, creditsLeft: creditsLeft ?? 'n/a',
  });

  const { rr, mv } = labelProviders(rrNotFound, null);
  return { email: '', status: 'not found', confidence: 0, mx: null, patternIndex: null, apiCalls, creditsLeft, rr, mv };
}

/**
 * Verify a known email address through the configured backend (lib/verifier).
 *
 * status:
 *   valid      - backend says the address is deliverable
 *   invalid    - backend says invalid or disposable
 *   accept-all - domain is catch-all / risky
 *   not found  - malformed address or unknown/inconclusive result
 */
export async function verifyEmail(emailRaw: string): Promise<VerifyResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { email: emailRaw.trim(), status: 'not found', confidence: 0, mx: null, apiCalls: 0, creditsLeft: null, rr: null, mv: null };
  }

  const primary = await checkPrimary(email);
  const second = await checkSecondOpinion(email, primary.status);
  const { rr, mv } = labelProviders(primary, second);

  let apiCalls = 1;
  let creditsLeft = primary.creditsLeft;
  if (second) {
    apiCalls++;
    creditsLeft = second.creditsLeft;
  }

  // RR is trusted only on 'valid'. For any other RR verdict, MV's answer wins when
  // it's definitive (it ran precisely because RR wasn't a confident valid).
  const headline =
    primary.status === 'valid' || !second || second.status === 'not found'
      ? primary
      : second;

  logEvent('finder', 'verify-done', {
    email,
    status: headline.status,
    rrStatus: primary.status,
    mvSecondOpinion: mv?.status ?? 'none',
    recoveredByMv: headline === second,
    apiCalls,
    creditsLeft: creditsLeft ?? 'n/a',
  });

  return {
    email,
    status: headline.status,
    confidence: headline.confidence,
    mx: null,
    apiCalls,
    creditsLeft,
    rr,
    mv,
  };
}

/**
 * Force a MillionVerifier check on a known email — backs the on-demand
 * "check with MillionVerifier" button. Reports the MV verdict as the mv field
 * (rr is null since reacher isn't involved here).
 */
export async function verifyWithMv(emailRaw: string): Promise<VerifyResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { email: emailRaw.trim(), status: 'not found', confidence: 0, mx: null, apiCalls: 0, creditsLeft: null, rr: null, mv: null };
  }

  const r = await checkWithMv(email);
  logEvent('finder', 'verify-mv', { email, status: r.status, creditsLeft: r.creditsLeft ?? 'n/a' });

  return {
    email,
    status: r.status,
    confidence: r.confidence,
    mx: null,
    apiCalls: 1,
    creditsLeft: r.creditsLeft,
    rr: null,
    mv: { status: r.status, confidence: r.confidence },
  };
}

