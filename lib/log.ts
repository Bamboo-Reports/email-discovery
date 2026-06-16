/**
 * Tiny gated logger for the email engine. Server-side only.
 *
 * Enabled by default outside production; force on/off with EMAIL_ENGINE_LOG:
 *   EMAIL_ENGINE_LOG=1    -> always log (e.g. to debug in production)
 *   EMAIL_ENGINE_LOG=off  -> never log
 */
const setting = process.env.EMAIL_ENGINE_LOG;
const enabled = setting === '1' || (setting !== 'off' && process.env.NODE_ENV !== 'production');

export function logEvent(scope: string, event: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const parts = data
    ? Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    : [];
  // eslint-disable-next-line no-console
  console.log(`[${scope}] ${event}${parts.length ? ' ' + parts.join(' ') : ''}`);
}
