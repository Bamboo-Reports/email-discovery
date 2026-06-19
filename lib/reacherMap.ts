import type { CheckResult } from './verifier';
import type { ReacherOutput } from './reacher';

// Pure mapping, no runtime imports — kept standalone so the self-check
// (lib/reacherMap.selfcheck.ts) can run under bare `node`.
export function fromReacher(out: ReacherOutput): CheckResult {
  const r = String(out.is_reachable || '').toLowerCase();
  const status =
    r === 'safe' ? 'valid'
    : r === 'invalid' ? 'invalid'
    : r === 'risky' ? 'accept-all'
    : 'not found';
  const confidence = status === 'valid' ? 0.9 : status === 'accept-all' ? 0.5 : 0;
  // 'unknown' means reacher couldn't probe (greylisted/throttled) — distinct from a
  // clean negative. Surface it so BOTH mode can fall back to MV on these.
  const inconclusive = r === 'unknown';
  return { status, confidence, creditsLeft: null, inconclusive }; // reacher has no credit concept
}
