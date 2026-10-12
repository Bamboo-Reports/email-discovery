import { getMyHistory } from '@/lib/verifications';
import { getMyBulkExports } from '@/lib/bulkExports';
import {
  RiCheckboxCircleLine,
  RiDownload2Line,
  RiErrorWarningLine,
  RiFileList3Line,
  RiFlashlightLine,
  RiHistoryLine,
  RiStackLine,
} from '@remixicon/react';
import { StatusBadge } from '@/components/StatusBadge';
import { PaginatedTabs } from '@/components/PaginatedTabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
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
          <p className="page-sub">your lookups and saved bulk exports.</p>
        </div>
      </header>

      <div className="stat-strip">
        <div className="stat"><RiFileList3Line className="stat-icon" size={18} aria-hidden="true" /><div className="stat-value">{total}</div><div className="stat-label">attempts</div></div>
        <div className="stat"><RiCheckboxCircleLine className="stat-icon valid" size={18} aria-hidden="true" /><div className="stat-value">{valid}</div><div className="stat-label">valid</div></div>
        <div className="stat"><RiErrorWarningLine className="stat-icon accept-all" size={18} aria-hidden="true" /><div className="stat-value">{acceptAll}</div><div className="stat-label">accept-all</div></div>
        <div className="stat"><RiFlashlightLine className="stat-icon" size={18} aria-hidden="true" /><div className="stat-value">{apiCalls}</div><div className="stat-label">api calls</div></div>
      </div>

      <PaginatedTabs
        pageSize={5}
        emptyText="no lookups yet. run one from the workbench."
        tabs={[
          {
            id: 'all',
            label: 'lookups',
            icon: <RiHistoryLine size={16} aria-hidden="true" />,
            head: (
              <tr>
                <th>when</th><th>searched for</th><th>email</th><th>status</th><th>confidence</th>
              </tr>
            ),
            rows: rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmt(r.created_at)}</td>
                <td>
                  {/* a verification's input is the email itself, already in the next column */}
                  {r.kind === 'find'
                    ? `${r.first_name ?? ''} ${r.last_name ?? ''} · ${r.domain ?? ''}`.trim()
                    : <span className="type-tag">verification</span>}
                  {r.source === 'bulk' && <> <span className="type-tag">bulk</span></>}
                </td>
                <td className="mono">{r.email || '—'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{Math.round((r.confidence ?? 0) * 100)}%</td>
              </tr>
            )),
          },
          {
            id: 'bulk-history',
            label: 'bulk exports',
            icon: <RiStackLine size={16} aria-hidden="true" />,
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
                    <RiDownload2Line size={16} aria-hidden="true" /> download
                  </a>
                </td>
              </tr>
            )),
          },
        ]}
      />
    </div>
  );
}
