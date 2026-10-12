'use client';

import { useState, type ReactNode } from 'react';
import { RiArrowLeftSLine, RiArrowRightSLine, RiInboxLine } from '@remixicon/react';

export type TableTab = {
  id: string;
  label: string;
  icon?: ReactNode;
  head: ReactNode; // a <tr> of <th>
  rows: ReactNode[]; // array of <tr>
};

// Tabbed + paginated table. Rows are pre-rendered <tr> nodes (server-built),
// so all existing cell markup/styling is preserved.
export function PaginatedTabs({
  tabs,
  pageSize = 12,
  emptyText = 'nothing here yet.',
  title,
  meta,
  toolbar,
  className,
}: {
  tabs: TableTab[];
  pageSize?: number;
  emptyText?: string;
  // optional card header: heading on the left, small note on the right
  title?: ReactNode;
  meta?: ReactNode;
  // controls shown at the right end of the tab row
  toolbar?: ReactNode;
  className?: string;
}) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const [page, setPage] = useState(0);
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  if (!tab) return null;

  const total = tab.rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages - 1);
  const start = cur * pageSize;
  const slice = tab.rows.slice(start, start + pageSize);

  return (
    <div className={className ? `card ${className}` : 'card'}>
      {title && (
        <div className="card-head">
          <h4>{title}</h4>
          {meta && <span className="small">{meta}</span>}
        </div>
      )}
      {(tabs.length > 1 || toolbar) && (
        <div className="table-bar">
          {tabs.length > 1 && (
            <div className="tabs table-switcher">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  className={`tab ${t.id === activeId ? 'active' : ''}`}
                  onClick={() => {
                    setActiveId(t.id);
                    setPage(0);
                  }}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {toolbar && <div className="table-bar-tools">{toolbar}</div>}
        </div>
      )}

      <div className="tbl-wrap tbl-scroll">
        <table>
          <thead>{tab.head}</thead>
          <tbody>{slice}</tbody>
        </table>
      </div>

      {total === 0 && (
        <div className="table-empty">
          <RiInboxLine size={26} aria-hidden="true" />
          <span>{emptyText}</span>
        </div>
      )}

      {pages > 1 && (
        <div className="pager">
          <span className="small">
            {start + 1}–{Math.min(start + pageSize, total)} of {total}
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
  );
}
