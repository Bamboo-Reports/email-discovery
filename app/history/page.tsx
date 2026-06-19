import { getMyHistory } from '@/lib/verifications';
import { getMyBulkExports } from '@/lib/bulkExports';
import { StatusBadge } from '@/components/StatusBadge';
import { PaginatedTabs } from '@/components/PaginatedTabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmt(ts: string) {
  return new Date(ts).toLocaleString();
}

export default async function HistoryPage() {
  const [rows, bulkExports] = await Promise.all([
    getMyHistory(),
    getMyBulkExports(),
  ]);

  const total = rows.length;
  const valid = rows.filter((r) => r.status === 'valid').length;
  const acceptAll = rows.filter((r) => r.status === 'accept-all').length;
  const apiCalls = rows.reduce((n, r) => n + (r.api_calls ?? 0), 0);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>your history</h1>
          <p className="page-sub">every lookup, verification, and saved bulk export.</p>
        </div>
      </header>

      <div className="stat-strip">
        <div className="stat"><div className="stat-value">{total}</div><div className="stat-label">attempts</div></div>
        <div className="stat"><div className="stat-value">{valid}</div><div className="stat-label">valid</div></div>
        <div className="stat"><div className="stat-value">{acceptAll}</div><div className="stat-label">accept-all</div></div>
        <div className="stat"><div className="stat-value">{apiCalls}</div><div className="stat-label">api calls</div></div>
      </div>

      <PaginatedTabs
        pageSize={5}
        emptyText="no lookups yet — run one from the workbench."
        tabs={[
          {
            id: 'all',
            label: 'all',
            head: (
              <tr>
                <th>when</th><th>query</th><th>email</th><th>status</th><th>conf.</th><th>src</th>
              </tr>
            ),
            rows: rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmt(r.created_at)}</td>
                <td>
                  {r.kind === 'find'
                    ? `${r.first_name ?? ''} ${r.last_name ?? ''} · ${r.domain ?? ''}`.trim()
                    : (r.email || r.domain || '—')}
                </td>
                <td className="mono">{r.email || '—'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="conf-pct">{Math.round((r.confidence ?? 0) * 100)}%</td>
                <td className="small">{r.source}</td>
              </tr>
            )),
          },
          {
            id: 'bulk-history',
            label: 'bulk history',
            head: (
              <tr>
                <th>when</th><th>file</th><th></th>
              </tr>
            ),
            rows: bulkExports.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmt(r.created_at)}</td>
                <td className="mono">{r.filename}</td>
                <td>
                  <a className="btn ghost" href={`/api/bulk-exports/${r.id}/download`}>
                    download
                  </a>
                </td>
              </tr>
            )),
          },
        ]}
      />

      <p className="foot">internal · email workbench</p>
    </div>
  );
}
