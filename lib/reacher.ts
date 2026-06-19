import { logEvent } from './log';

/**
 * Reacher (check-if-email-exists) self-hosted backend client.
 *
 * The reacher backend runs on a VPS where outbound SMTP works (through a SOCKS5
 * proxy). Proxy / from-email / hello-name are configured server-side on that
 * container via RCH__* env vars, so we only send { to_email } plus the shared
 * secret header. We never spawn the CLI here — this app runs on Vercel
 * (serverless), which can't hold open SMTP connections.
 */

export type ReacherReachable = 'safe' | 'invalid' | 'risky' | 'unknown';

export interface ReacherOutput {
  input?: string;
  is_reachable?: ReacherReachable | string;
  mx?: unknown;
  smtp?: unknown;
  syntax?: unknown;
  misc?: unknown;
}

function reacherBackendUrl(): string {
  const url = process.env.REACHER_BACKEND_URL;
  if (!url) throw new Error('missing REACHER_BACKEND_URL');
  return url.replace(/\/$/, '');
}

export async function checkEmailWithReacher(email: string): Promise<ReacherOutput> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.REACHER_SECRET) headers['x-reacher-secret'] = process.env.REACHER_SECRET;

  const res = await fetch(`${reacherBackendUrl()}/v0/check_email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to_email: email }),
  });
  if (!res.ok) {
    throw new Error(`reacher check failed (${res.status})`);
  }

  const data = await res.json() as ReacherOutput;
  logEvent('reacher', 'verify', { email, isReachable: data.is_reachable });
  return data;
}
