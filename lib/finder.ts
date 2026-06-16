import { checkEmailWithMillionVerifier, type MillionVerifierOutput } from './millionverifier';
import { generatePatterns, generatePatternsPreferring } from './patterns';
import { getDomainFormat, setDomainFormat } from './domainFormatStore';
import { logEvent } from './log';

export { clearLearnedFormats } from './domainFormatStore';

export type Status = 'valid' | 'accept-all' | 'not found';
export type VerifyStatus = 'valid' | 'invalid' | 'accept-all' | 'not found';

export interface FindResult {
  email: string;
  status: Status;
  confidence: number;
  mx?: string | null;
  patternIndex?: number | null;
  apiCalls: number;
  creditsLeft?: number | null;
}

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  confidence: number;
  mx?: string | null;
  apiCalls: number;
  creditsLeft?: number | null;
}

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

function resultValue(result: MillionVerifierOutput): string {
  return String(result.result || '').toLowerCase();
}

function verifyStatusFor(result: MillionVerifierOutput): VerifyStatus {
  switch (resultValue(result)) {
    case 'ok':
      return 'valid';
    case 'catch_all':
      return 'accept-all';
    case 'invalid':
    case 'disposable':
      return 'invalid';
    default:
      return 'not found';
  }
}

function confidenceFor(result: MillionVerifierOutput): number {
  switch (resultValue(result)) {
    case 'ok':
      return result.quality === 'good' ? 0.95 : 0.85;
    case 'catch_all':
      return 0.5;
    default:
      return 0;
  }
}

/**
 * Find a likely email by generating local name/domain patterns and checking
 * each candidate through MillionVerifier's Single API.
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

  // Each MillionVerifier verification consumes one credit, so creditsUsed equals
  // apiCalls. creditsLeft is the balance reported by the most recent response.
  let apiCalls = 0;
  let creditsLeft: number | undefined;
  for (const p of patterns) {
    const result = await checkEmailWithMillionVerifier(p.email);
    apiCalls++;
    if (typeof result.credits === 'number') creditsLeft = result.credits;
    const status = verifyStatusFor(result);

    if (status === 'valid') {
      await setDomainFormat(d, p.index);
      logEvent('finder', 'lookup-done', {
        domain: d,
        status: 'valid',
        email: p.email,
        patternIndex: p.index,
        usedLearned: p.index === learned,
        apiCalls,
        creditsUsed: apiCalls,
        apiCallsSaved: patterns.length - apiCalls,
        creditsLeft: creditsLeft ?? 'n/a',
      });
      return {
        email: p.email,
        status: 'valid',
        confidence: p.score,
        mx: null,
        patternIndex: p.index,
        apiCalls,
        creditsLeft,
      };
    }

    if (status === 'accept-all') {
      logEvent('finder', 'lookup-done', {
        domain: d,
        status: 'accept-all',
        email: top.email,
        apiCalls,
        creditsUsed: apiCalls,
        creditsLeft: creditsLeft ?? 'n/a',
      });
      return {
        email: top.email,
        status: 'accept-all',
        confidence: +(top.score * confidenceFor(result)).toFixed(2),
        mx: null,
        patternIndex: top.index,
        apiCalls,
        creditsLeft,
      };
    }
  }

  logEvent('finder', 'lookup-done', {
    domain: d,
    status: 'not found',
    apiCalls,
    creditsUsed: apiCalls,
    creditsLeft: creditsLeft ?? 'n/a',
  });

  return { email: '', status: 'not found', confidence: 0, mx: null, patternIndex: null, apiCalls, creditsLeft };
}

/**
 * Verify a known email address using MillionVerifier's Single API.
 *
 * status:
 *   valid      - MillionVerifier result is ok
 *   invalid    - MillionVerifier result is invalid or disposable
 *   accept-all - MillionVerifier result is catch_all
 *   not found  - malformed address or unknown/inconclusive result
 */
export async function verifyEmail(emailRaw: string): Promise<VerifyResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { email: emailRaw.trim(), status: 'not found', confidence: 0, mx: null, apiCalls: 0, creditsLeft: null };
  }

  const result = await checkEmailWithMillionVerifier(email);
  const status = verifyStatusFor(result);

  logEvent('finder', 'verify-done', {
    email,
    status,
    apiCalls: 1,
    creditsLeft: result.credits ?? 'n/a',
  });

  return {
    email,
    status,
    confidence: confidenceFor(result),
    mx: null,
    apiCalls: 1,
    creditsLeft: typeof result.credits === 'number' ? result.credits : null,
  };
}

