'use client';

import { useState } from 'react';
import { RiTeamLine } from '@remixicon/react';
import { PaginatedTabs } from './PaginatedTabs';
import { UserMenu } from './UserMenu';

export type TeamPeriod = 'today' | 'week' | 'month' | 'year' | 'all';

export interface TeamCounts {
  total: number;
  valid: number;
  acceptAll: number;
  invalid: number;
  notFound: number;
  apiCalls: number;
}

export interface TeamMember {
  email: string;
  role: 'owner' | 'admin' | 'member';
  bulk: boolean;
  archived: boolean;
  hasLogin: boolean;
  isSelf: boolean;
  // pre-formatted on the server so the client never re-derives "5d ago"
  lastActive: string;
  lastActiveTitle: string;
  counts: Record<TeamPeriod, TeamCounts>;
}

const PERIODS: { id: TeamPeriod; label: string }[] = [
  { id: 'today', label: 'today' },
  { id: 'week', label: 'this week' },
  { id: 'month', label: 'this month' },
  { id: 'year', label: 'this year' },
  { id: 'all', label: 'all time' },
];

const num = (n: number) => n.toLocaleString('en-US');

/**
 * Admin team table: per-user totals for the chosen period (IST; weeks start
 * Monday), split into active / archived, with the per-user options menu.
 */
export function TeamTable({ members }: { members: TeamMember[] }) {
  const [period, setPeriod] = useState<TeamPeriod>('all');

  // busiest first for the chosen period, all-time as the tiebreak
  const sorted = [...members].sort(
    (a, b) => b.counts[period].total - a.counts[period].total || b.counts.all.total - a.counts.all.total,
  );

  const head = (
    <tr>
      <th>user</th><th className="num">attempts</th><th className="num">discovered</th>
      <th className="num">invalid</th><th className="num">not found</th><th className="num">api calls</th>
      <th>last active</th><th><span className="sr-only">options</span></th>
    </tr>
  );

  const row = (m: TeamMember) => {
    const c = m.counts[period];
    const isAdmin = m.role !== 'member';
    return (
      <tr key={m.email} className={m.archived ? 'row-archived' : ''}>
        <td>
          <span className="team-email">
            {m.email}
            {isAdmin && (
              <span className="type-tag" title={m.role === 'owner' ? 'set in ADMIN_EMAILS' : undefined}>{m.role}</span>
            )}
            {m.bulk && !isAdmin && !m.archived && <span className="type-tag">bulk</span>}
            {!m.hasLogin && <span className="type-tag" title="has lookup history but no login account">no login</span>}
          </span>
        </td>
        <td className={`num ${c.total ? '' : 'zero'}`}>{num(c.total)}</td>
        <td className={`num ${c.valid + c.acceptAll ? '' : 'zero'}`} title={`${num(c.valid)} valid · ${num(c.acceptAll)} accept-all`}>
          {num(c.valid + c.acceptAll)}
        </td>
        <td className={`num ${c.invalid ? '' : 'zero'}`}>{num(c.invalid)}</td>
        <td className={`num ${c.notFound ? '' : 'zero'}`}>{num(c.notFound)}</td>
        <td className={`num ${c.apiCalls ? '' : 'zero'}`}>{num(c.apiCalls)}</td>
        <td className="small" title={m.lastActiveTitle}>{m.lastActive}</td>
        <td className="cell-menu">
          <UserMenu
            email={m.email}
            bulkEnabled={m.bulk}
            archived={m.archived}
            role={m.role}
            isSelf={m.isSelf}
            hasLogin={m.hasLogin}
          />
        </td>
      </tr>
    );
  };

  const active = sorted.filter((m) => !m.archived);
  const archived = sorted.filter((m) => m.archived);

  return (
    <PaginatedTabs
      title={<><RiTeamLine size={16} aria-hidden="true" /> team</>}
      className="team-card"
      toolbar={
        <span className="period-switch" role="radiogroup" aria-label="period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={period === p.id}
              className={period === p.id ? 'active' : ''}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </span>
      }
      emptyText="no users in this list."
      tabs={[
        { id: 'active', label: `active · ${active.length}`, head, rows: active.map(row) },
        { id: 'archived', label: `archived · ${archived.length}`, head, rows: archived.map(row) },
      ]}
    />
  );
}
