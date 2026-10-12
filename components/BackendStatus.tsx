'use client';

import { useEffect, useState } from 'react';
import type { BackendHealth, HealthReport } from '@/lib/health';

const POLL_MS = 60_000;

const STATE_TEXT: Record<BackendHealth['state'], string> = {
  up: 'up',
  degraded: 'degraded',
  down: 'down',
  unconfigured: 'not set up',
};

/**
 * Polls /api/health every minute and on window focus. Kept separate from the
 * list so the account button can show an alert dot while the menu is closed.
 */
export function useBackendHealth() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as HealthReport;
        if (alive) { setReport(data); setFailed(false); }
      } catch {
        if (alive) setFailed(true);
      }
    }
    load();
    const id = window.setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return { report, failed };
}

/** Worst state among the engines VERIFICATION_METHOD actually uses. */
export function overallState(report: HealthReport | null): 'up' | 'degraded' | 'down' | null {
  if (!report) return null;
  const used = report.backends.filter((b) => b.inUse);
  if (used.some((b) => b.state === 'down' || b.state === 'unconfigured')) return 'down';
  if (used.some((b) => b.state === 'degraded')) return 'degraded';
  return 'up';
}

/** One row per verification backend; unused engines are dimmed. */
export function BackendStatusList({ report, failed }: { report: HealthReport | null; failed: boolean }) {
  if (!report) {
    return <div className="backend-empty">{failed ? 'couldn’t load status' : 'checking…'}</div>;
  }

  return (
    <ul className="backend-list" aria-label="verification service status">
      {report.backends.map((b) => (
        <li key={b.id} className="backend-row" data-idle={b.inUse ? undefined : ''}>
          <span className="backend-dot" data-state={b.state} aria-hidden="true" />
          <span className="backend-name">
            {b.label}
            {!b.inUse && <span className="backend-idle"> · not in use</span>}
          </span>
          <span className="backend-detail" title={b.latencyMs !== null ? `${b.latencyMs} ms` : undefined}>
            {b.state === 'up' ? b.detail : `${STATE_TEXT[b.state]} · ${b.detail}`}
          </span>
        </li>
      ))}
      <li className="backend-checked">checked {new Date(report.checkedAt).toLocaleTimeString()}</li>
    </ul>
  );
}
