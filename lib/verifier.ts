import { checkEmailWithMillionVerifier, type MillionVerifierOutput } from './millionverifier';
import { checkEmailWithReacher } from './reacher';
import { fromReacher } from './reacherMap';
import { logEvent } from './log';

export type VerifyStatus = 'valid' | 'invalid' | 'accept-all' | 'not found';

export interface CheckResult {
  status: VerifyStatus;
  confidence: number;
  creditsLeft: number | null;
  // reacher only: true when is_reachable was 'unknown' (couldn't probe / throttled).
  inconclusive?: boolean;
}

export type Method = 'MV' | 'RR' | 'BOTH';

function method(): Method {
  const m = process.env.VERIFICATION_METHOD;
  return m === 'RR' || m === 'BOTH' ? m : 'MV';
}

export function isBothMode(): boolean {
  return method() === 'BOTH';
}

/** The primary engine is reacher whenever reacher is involved (RR or BOTH). */
export function primaryIsReacher(): boolean {
  return method() !== 'MV';
}

/**
 * In BOTH mode, MV is consulted only when RR says 'invalid' or 'not found'
 * (the latter includes reacher 'unknown'/throttled) — RR's negatives can be
 * false on a shared proxy IP. RR's 'valid' and 'accept-all' are trusted as-is.
 */
export function shouldSecondOpinion(primaryStatus: VerifyStatus): boolean {
  return method() === 'BOTH' && (primaryStatus === 'invalid' || primaryStatus === 'not found');
}

// --- MillionVerifier normalization ---

function mvResult(out: MillionVerifierOutput): string {
  return String(out.result || '').toLowerCase();
}

function fromMillionVerifier(out: MillionVerifierOutput): CheckResult {
  const r = mvResult(out);
  const status: VerifyStatus =
    r === 'ok' ? 'valid'
    : r === 'catch_all' ? 'accept-all'
    : r === 'invalid' || r === 'disposable' ? 'invalid'
    : 'not found';
  const confidence =
    r === 'ok' ? (out.quality === 'good' ? 0.95 : 0.85)
    : r === 'catch_all' ? 0.5
    : 0;
  return { status, confidence, creditsLeft: typeof out.credits === 'number' ? out.credits : null };
}

/**
 * Primary check for one email. Reacher when method is RR or BOTH, else MillionVerifier.
 * In BOTH mode this keeps the find/bulk pattern loop on RR only (no per-candidate MV spend).
 */
export async function checkPrimary(email: string): Promise<CheckResult> {
  if (primaryIsReacher()) {
    return fromReacher(await checkEmailWithReacher(email));
  }
  return fromMillionVerifier(await checkEmailWithMillionVerifier(email));
}

/** Force a MillionVerifier check, regardless of VERIFICATION_METHOD.
 *  Used by the on-demand "check with MillionVerifier" button. */
export async function checkWithMv(email: string): Promise<CheckResult> {
  return fromMillionVerifier(await checkEmailWithMillionVerifier(email));
}

/**
 * MV second opinion on the email RR resolved (BOTH mode only). Best-effort:
 * returns null when not applicable, and swallows MV failures so the primary
 * (RR) result is never lost.
 */
export async function checkSecondOpinion(
  email: string,
  primaryStatus: VerifyStatus,
): Promise<CheckResult | null> {
  if (!shouldSecondOpinion(primaryStatus)) return null;
  try {
    return fromMillionVerifier(await checkEmailWithMillionVerifier(email));
  } catch (e: any) {
    logEvent('verifier', 'second-opinion-error', { email, error: e?.message ?? 'unknown' });
    return null;
  }
}

// Exported for the self-check / tests.
export const __test = { fromMillionVerifier, fromReacher, shouldSecondOpinion };
