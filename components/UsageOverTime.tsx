'use client';

import { useState } from 'react';
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBarChartBoxLine,
  RiCalendar2Line,
  RiCalendarLine,
  RiCalendarScheduleLine,
  RiCalendarTodoLine,
  type RemixiconComponentType,
} from '@remixicon/react';
import type { PeriodGrain, PeriodStats, PeriodStatsByGrain } from '@/lib/verifications';

const GRAINS: { id: PeriodGrain; label: string; noun: string; Icon: RemixiconComponentType }[] = [
  { id: 'day', label: 'daily', noun: 'day', Icon: RiCalendarTodoLine },
  { id: 'week', label: 'weekly', noun: 'week', Icon: RiCalendarScheduleLine },
  { id: 'month', label: 'monthly', noun: 'month', Icon: RiCalendarLine },
  { id: 'year', label: 'yearly', noun: 'year', Icon: RiCalendar2Line },
];

const PLOT_H = 180;
const PAGE_SIZE = 5;

/** Period start (YYYY-MM-DD) → label for the grain. Dates are calendar days, so format in UTC. */
function periodLabel(key: string, grain: PeriodGrain, long = false): string {
  const d = new Date(`${key}T00:00:00Z`);
  const fmt = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  if (grain === 'year') return String(d.getUTCFullYear());
  if (grain === 'month') return fmt({ month: 'short', year: 'numeric' });
  if (grain === 'week') return (long ? 'week of ' : '') + fmt({ day: 'numeric', month: 'short' });
  return fmt(long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const TICK_COUNT = 4;

/** Tick step of 1 / 2 / 5 × 10^k so every tick is a clean number (0, 1K, 2K…). */
function niceStep(max: number): number {
  const raw = Math.max(max, 1) / TICK_COUNT;
  const pow = 10 ** Math.floor(Math.log10(raw));
  // counts are whole numbers, so never step below 1
  return Math.max(1, [1, 2, 5, 10].find((s) => s * pow >= raw)! * pow);
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

/**
 * Org-wide attempts per day / week / month / year. Column chart (oldest → newest)
 * with a per-column tooltip, plus the full breakdown as a table.
 */
export function UsageOverTime({ data }: { data: PeriodStatsByGrain }) {
  const [grain, setGrain] = useState<PeriodGrain>('day');
  const [hover, setHover] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const meta = GRAINS.find((g) => g.id === grain)!;
  const rows = data[grain]; // newest first
  const series = [...rows].reverse(); // oldest → newest for the chart
  const step = niceStep(Math.max(0, ...series.map((r) => r.total)));
  const max = step * TICK_COUNT;
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => i * step);
  // Thin out x labels so they never collide: at most ~8 across the axis.
  const labelEvery = Math.max(1, Math.ceil(series.length / 8));
  const active: PeriodStats | null = hover !== null ? series[hover] : null;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const pageRows = rows.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE);

  return (
    <div className="card usage-card">
      <div className="card-head">
        <h4><RiBarChartBoxLine size={16} aria-hidden="true" /> usage over time</h4>
      </div>
      <div className="card-body">
        <div className="tabs">
          {GRAINS.map((g) => (
            <button
              key={g.id}
              className={`tab ${grain === g.id ? 'active' : ''}`}
              onClick={() => { setGrain(g.id); setHover(null); setPage(0); }}
            >
              <g.Icon size={16} />
              {g.label}
            </button>
          ))}
        </div>

        <div className="usage-title">
          attempts per {meta.noun}
          <span className="small"> · last {rows.length} {meta.noun}{rows.length === 1 ? '' : 's'}</span>
        </div>

        <div className="usage-chart" onMouseLeave={() => setHover(null)}>
          <div className="usage-yaxis" style={{ height: PLOT_H }} aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>{compact(t)}</span>
            ))}
          </div>

          <div className="usage-plot-wrap">
            <div className="usage-plot" style={{ height: PLOT_H }}>
              {ticks.map((t) => (
                <span key={t} className="usage-grid" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden="true" />
              ))}
              {series.map((r, i) => (
                <div
                  key={r.periodStart}
                  className={`usage-col ${hover === i ? 'hover' : ''}`}
                  tabIndex={0}
                  aria-label={`${periodLabel(r.periodStart, grain, true)}: ${r.total} attempts, ${r.valid + r.acceptAll} discovered`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <span
                    className="usage-bar"
                    style={{ height: r.total ? `max(2px, ${(r.total / max) * 100}%)` : 0 }}
                  />
                </div>
              ))}

              {active && hover !== null && (
                <div
                  className="usage-tip"
                  style={{
                    left: `${((hover + 0.5) / series.length) * 100}%`,
                    transform: `translateX(${hover / series.length > 0.66 ? '-100%' : hover / series.length < 0.33 ? '0' : '-50%'})`,
                  }}
                  role="status"
                >
                  <strong>{periodLabel(active.periodStart, grain, true)}</strong>
                  <dl>
                    <dt>attempts</dt><dd>{active.total.toLocaleString()}</dd>
                    <dt>valid</dt><dd>{active.valid.toLocaleString()}</dd>
                    <dt>accept-all</dt><dd>{active.acceptAll.toLocaleString()}</dd>
                    <dt>invalid</dt><dd>{active.invalid.toLocaleString()}</dd>
                    <dt>not found</dt><dd>{active.notFound.toLocaleString()}</dd>
                    <dt>discovered</dt><dd>{pct(active.valid + active.acceptAll, active.total)}</dd>
                    <dt>api calls</dt><dd>{active.apiCalls.toLocaleString()}</dd>
                    <dt>active users</dt><dd>{active.activeUsers}</dd>
                  </dl>
                </div>
              )}
            </div>

            <div className="usage-xaxis" aria-hidden="true">
              {series.map((r, i) => (
                <span key={r.periodStart}>
                  {(series.length - 1 - i) % labelEvery === 0 ? periodLabel(r.periodStart, grain) : ''}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="tbl-wrap tbl-scroll usage-table">
          <table>
            <thead>
              <tr>
                <th>{meta.noun}</th><th>attempts</th><th>valid</th><th>accept-all</th><th>invalid</th>
                <th>not found</th><th>discovered</th><th>api calls</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.periodStart} className={r.total ? '' : 'usage-empty-row'}>
                  <td className="small">{periodLabel(r.periodStart, grain, true)}</td>
                  <td>{r.total.toLocaleString()}</td>
                  <td>{r.valid.toLocaleString()}</td>
                  <td>{r.acceptAll.toLocaleString()}</td>
                  <td>{r.invalid.toLocaleString()}</td>
                  <td>{r.notFound.toLocaleString()}</td>
                  <td>{pct(r.valid + r.acceptAll, r.total)}</td>
                  <td>{r.apiCalls.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="table-empty">no activity yet.</div>}

        {pages > 1 && (
          <div className="pager usage-pager">
            <span className="small">
              {cur * PAGE_SIZE + 1}–{Math.min((cur + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <div className="pager-btns">
              <button className="btn ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
                <RiArrowLeftSLine size={16} aria-hidden="true" /> prev
              </button>
              <span className="small">
                page {cur + 1} / {pages}
              </span>
              <button className="btn ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
                next <RiArrowRightSLine size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
