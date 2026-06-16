import { checkEmailWithMillionVerifier, type MillionVerifierOutput } from './millionverifier';
import { generatePatterns } from './patterns';

export type Status = 'valid' | 'accept-all' | 'not found';
export type VerifyStatus = 'valid' | 'invalid' | 'accept-all' | 'not found';

export interface FindResult {
  email: string;
  status: Status;
  confidence: number;
  mx?: string | null;
}

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  confidence: number;
  mx?: string | null;
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
 */
export async function findEmail(first: string, last: string, domain: string): Promise<FindResult> {
  const patterns = generatePatterns(first, last, domain.trim().toLowerCase());
  const top = patterns[0];

  for (const p of patterns) {
    const result = await checkEmailWithMillionVerifier(p.email);
    const status = verifyStatusFor(result);

    if (status === 'valid') {
      return { email: p.email, status: 'valid', confidence: p.score, mx: null };
    }

    if (status === 'accept-all') {
      return {
        email: top.email,
        status: 'accept-all',
        confidence: +(top.score * confidenceFor(result)).toFixed(2),
        mx: null,
      };
    }
  }

  return { email: '', status: 'not found', confidence: 0, mx: null };
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
    return { email: emailRaw.trim(), status: 'not found', confidence: 0, mx: null };
  }

  const result = await checkEmailWithMillionVerifier(email);
  const status = verifyStatusFor(result);

  return {
    email,
    status,
    confidence: confidenceFor(result),
    mx: null,
  };
}

