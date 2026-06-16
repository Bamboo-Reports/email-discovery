export type MillionVerifierResult =
  | 'ok'
  | 'catch_all'
  | 'invalid'
  | 'unknown'
  | 'disposable'
  | 'error';

export interface MillionVerifierOutput {
  email?: string;
  quality?: 'good' | 'risky' | 'bad' | string;
  result?: MillionVerifierResult | string;
  resultcode?: number;
  subresult?: string;
  free?: boolean;
  role?: boolean;
  didyoumean?: string;
  credits?: number;
  executiontime?: number;
  error?: string;
  livemode?: boolean;
}

const DEFAULT_MILLIONVERIFIER_BASE_URL = 'https://api.millionverifier.com/api/v3';
const DEFAULT_TIMEOUT_SECONDS = 10;

function millionVerifierApiKey(): string {
  const key = process.env.MILLIONVERIFIER_API_KEY;
  if (!key) {
    throw new Error('missing MILLIONVERIFIER_API_KEY');
  }
  return key;
}

function millionVerifierBaseUrl(): string {
  return process.env.MILLIONVERIFIER_BASE_URL || DEFAULT_MILLIONVERIFIER_BASE_URL;
}

export async function checkEmailWithMillionVerifier(
  email: string,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
): Promise<MillionVerifierOutput> {
  const url = new URL(millionVerifierBaseUrl());
  url.searchParams.set('api', millionVerifierApiKey());
  url.searchParams.set('email', email);
  url.searchParams.set('timeout', String(timeoutSeconds));

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`millionverifier check failed (${res.status})`);
  }

  const data = await res.json() as MillionVerifierOutput;
  if (data.error) {
    throw new Error(data.error.toLowerCase());
  }

  return data;
}

