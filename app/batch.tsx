'use client';

import { useMemo, useRef, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfidenceBar } from '@/components/ConfidenceBar';
import { generatePatterns } from '@/lib/patterns';

type DomainHit =
  | { status: 'valid' | 'accept-all'; patternIndex: number; confidence: number }
  | { status: 'not found' };

const CONCURRENCY = 8;
const ROW_TIMEOUT_MS = 10_000;
const MAX_VISIBLE_ROWS = 10;

type RowState = 'pending' | 'processing' | 'done';
type InRow = { uuid: string; firstName: string; lastName: string; domain: string };
type Out = { email: string; status: 'valid' | 'accept-all' | 'not found'; confidence: number } | null;

const REQUIRED = ['uuid', 'first name', 'last name', 'domain'] as const;
const REQUIRED_LABEL = 'uuid, first name, last name, domain';

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
  return { headers, rows };
}

function pick(row: Record<string, string>, name: string): string {
  const want = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase().trim() === want) return v;
  }
  return '';
}

function toCSV(rows: InRow[], results: Out[]): string {
  const header = ['UUID', 'First Name', 'Last Name', 'Domain', 'Email', 'Status', 'Confidence'];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const body = rows.map((r, i) => {
    const out = results[i];
    return [
      r.uuid, r.firstName, r.lastName, r.domain,
      out?.email ?? '', out?.status ?? 'not found', (out?.confidence ?? 0).toFixed(2),
    ].map(esc).join(',');
  });
  return [header.join(','), ...body].join('\n');
}

export default function BatchLookup() {
  const [rows, setRows] = useState<InRow[]>([]);
  const [results, setResults] = useState<Out[]>([]);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doneCount = useMemo(() => results.filter((r) => r !== null).length, [results]);
  const validCount = useMemo(
    () => results.filter((r) => r?.status === 'valid').length,
    [results],
  );
  const acceptAllCount = useMemo(
    () => results.filter((r) => r?.status === 'accept-all').length,
    [results],
  );
  const notFoundCount = useMemo(
    () => results.filter((r) => r?.status === 'not found').length,
    [results],
  );
  const remainingCount = Math.max(rows.length - doneCount, 0);
  const pct = rows.length ? doneCount / rows.length : 0;
  const bulkSummary = useMemo(() => {
    const completed = results.filter((r): r is NonNullable<Out> => r !== null);
    const foundCount = validCount + acceptAllCount;
    const avgConfidence = foundCount
      ? completed
        .filter((r) => r.status !== 'not found')
        .reduce((sum, r) => sum + r.confidence, 0) / foundCount
      : 0;
    const uniqueDomains = new Set(
      rows.map((r) => r.domain.trim().toLowerCase()).filter(Boolean),
    ).size;
    const missingInputCount = rows.filter((r) => !r.firstName || !r.lastName || !r.domain).length;
    const chartItems = [
      { key: 'valid', label: 'valid', count: validCount },
      { key: 'accept-all', label: 'accept-all', count: acceptAllCount },
      { key: 'not-found', label: 'not found', count: notFoundCount },
    ];

    return {
      avgConfidence,
      chartItems,
      foundCount,
      foundRate: rows.length ? foundCount / rows.length : 0,
      missingInputCount,
      uniqueDomains,
    };
  }, [acceptAllCount, notFoundCount, results, rows, validCount]);
  const visibleRows = useMemo(() => {
    const picked = new Set<number>();
    const indices: number[] = [];
    const add = (i: number) => {
      if (i < 0 || i >= rows.length || picked.has(i) || indices.length >= MAX_VISIBLE_ROWS) return;
      picked.add(i);
      indices.push(i);
    };

    Array.from(activeIds).sort((a, b) => a - b).forEach(add);

    if (running) {
      for (let i = results.length - 1; i >= 0 && indices.length < MAX_VISIBLE_ROWS; i--) {
        if (results[i]) add(i);
      }
      for (let i = 0; i < rows.length && indices.length < MAX_VISIBLE_ROWS; i++) {
        if (!results[i]) add(i);
      }
    } else {
      for (let i = 0; i < rows.length && indices.length < MAX_VISIBLE_ROWS; i++) add(i);
    }

    return indices.map((index) => ({ index, row: rows[index] }));
  }, [activeIds, results, rows, running]);

  async function loadFile(file: File) {
    setError(null);
    setRows([]);
    setResults([]);
    setActiveIds(new Set());
    setImporting(true);
    await new Promise((r) => setTimeout(r, 420));
    try {
      if (!/\.csv$/i.test(file.name) && file.type && !/csv/i.test(file.type)) {
        throw new Error(`not a csv file. got "${file.name}".`);
      }
      const text = await file.text();
      const { headers, rows: parsedRows } = parseCSV(text);
      if (!headers.length) {
        throw new Error(`file is empty. required columns: ${REQUIRED_LABEL}.`);
      }
      const headerSet = new Set(headers.map((h) => h.toLowerCase().trim()));
      const missing = REQUIRED.filter((r) => !headerSet.has(r));
      if (missing.length) {
        const missingLabels = missing
          .map((m) => m.toLowerCase())
          .join(', ');
        throw new Error(
          `rejected — missing required column(s): ${missingLabels}. ` +
          `required: ${REQUIRED_LABEL}. found: ${headers.join(', ').toLowerCase() || '(none)'}.`,
        );
      }
      if (!parsedRows.length) {
        throw new Error('csv has headers but no data rows.');
      }
      const inRows: InRow[] = parsedRows.map((r) => ({
        uuid: pick(r, 'UUID'),
        firstName: pick(r, 'First Name'),
        lastName: pick(r, 'Last Name'),
        domain: pick(r, 'Domain'),
      }));
      setRows(inRows);
      setResults(Array(inRows.length).fill(null));
    } catch (e: any) {
      setError(e.message ?? 'failed to import csv');
    } finally {
      setImporting(false);
    }
  }

  async function run() {
    setRunning(true);
    setError(null);
    const next: Out[] = [...results];
    const active = new Set<number>();
    let cursor = 0;

    const markActive = (i: number, on: boolean) => {
      if (on) active.add(i); else active.delete(i);
      setActiveIds(new Set(active));
    };

    const lookupDomain = async (row: InRow): Promise<DomainHit | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ROW_TIMEOUT_MS);
      try {
        const res = await fetch('/api/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: row.firstName,
            lastName: row.lastName,
            domain: row.domain,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) return { status: 'not found' };
        const data = await res.json();
        const status = (data.status || 'not found') as 'valid' | 'accept-all' | 'not found';
        if (status === 'not found') return { status: 'not found' };
        const patterns = generatePatterns(row.firstName, row.lastName, row.domain);
        const email = data.email || '';
        const confidence = data.confidence ?? 0;
        const idx = status === 'valid' ? patterns.findIndex((p) => p.email === email) : 0;
        if (idx < 0) return null;
        return { status, patternIndex: idx, confidence };
      } catch {
        return { status: 'not found' };
      } finally {
        clearTimeout(timer);
      }
    };

    const applyHit = (i: number, row: InRow, hit: DomainHit) => {
      if (hit.status === 'not found') {
        next[i] = { email: '', status: 'not found', confidence: 0 };
      } else {
        const patterns = generatePatterns(row.firstName, row.lastName, row.domain);
        next[i] = {
          email: patterns[hit.patternIndex].email,
          status: hit.status,
          confidence: hit.confidence,
        };
      }
    };

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= rows.length) return;
        const row = rows[i];
        markActive(i, true);
        try {
          if (!row.firstName || !row.lastName || !row.domain) {
            next[i] = { email: '', status: 'not found', confidence: 0 };
            continue;
          }
          const hit = await lookupDomain(row);
          if (hit) applyHit(i, row, hit);
          else next[i] = { email: '', status: 'not found', confidence: 0 };
        } finally {
          markActive(i, false);
          setResults([...next]);
        }
      }
    };

    const n = Math.min(CONCURRENCY, rows.length);
    await Promise.all(Array.from({ length: n }, () => worker()));
    setRunning(false);
  }

  function reset() {
    setRows([]);
    setResults([]);
    setActiveIds(new Set());
    setError(null);
  }

  function download() {
    const csv = toCSV(rows, results);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'email_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card">
      <div className="card-body">
          {rows.length === 0 && !importing && (
            <div
              className={`drop ${dragging ? 'active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) loadFile(f);
              }}
              onClick={() => fileRef.current?.click()}
            >
              <div className="drop-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <strong>drop a csv here</strong>
              </div>
              <div className="small" style={{ marginTop: 10 }}>
                or click to choose · required columns:{' '}
                <kbd>uuid</kbd> <kbd>first name</kbd> <kbd>last name</kbd>{' '}
                <kbd>domain</kbd>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFile(f);
                }}
              />
            </div>
          )}

          {importing && (
            <div className="drop">
              <div className="drop-icon">+</div>
              <div>
                <strong>importing csv...</strong>
              </div>
              <div className="small" style={{ marginTop: 8 }}>parsing rows</div>
            </div>
          )}

        {error && <div className="err">{error}</div>}

          {rows.length > 0 && (
            <div>
              <div className="progress-wrap">
                <div className="progress-head">
                  <span className="left">
                    {running ? (
                      <>
                        <Spinner />
                        verifying <strong>{doneCount}</strong> of {rows.length} ·{' '}
                        <strong>{remainingCount}</strong> remaining
                      </>
                    ) : doneCount === rows.length ? (
                      <>
                        processed <strong>{doneCount}</strong> rows ·{' '}
                        <strong>{validCount}</strong> valid
                      </>
                    ) : (
                      <>
                        <strong>{rows.length}</strong> rows queued · ready to verify
                      </>
                    )}
                  </span>
                  <span className="pct">{Math.round(pct * 100).toString().padStart(2, '0')}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </div>

              <div className="toolbar">
                <button
                  className="btn primary"
                  onClick={run}
                  disabled={running || doneCount === rows.length}
                >
                  {running ? (
                    <><Spinner /> running</>
                  ) : doneCount === rows.length ? (
                    <>complete</>
                  ) : (
                    <>verify {rows.length} rows</>
                  )}
                </button>
                {doneCount > 0 && !running && (
                  <button
                    className="btn"
                    onClick={download}
                  >
                    export csv
                  </button>
                )}
                <div className="spacer" />
                <button className="btn" onClick={reset} disabled={running}>
                  reset
                </button>
              </div>

              {doneCount === rows.length && (
                <div className="bulk-summary">
                  <div className="summary-head">
                    <div>
                      <h3>bulk summary</h3>
                      <p>
                        {bulkSummary.foundCount} valid or probable emails found from {rows.length} rows
                      </p>
                    </div>
                    <strong>{Math.round(bulkSummary.foundRate * 100)}%</strong>
                  </div>

                  <div className="summary-chart" aria-label="bulk result status chart">
                    {bulkSummary.chartItems.map((item) => (
                      <span
                        key={item.key}
                        className={`summary-segment ${item.key}`}
                        style={{ width: `${rows.length ? (item.count / rows.length) * 100 : 0}%` }}
                        title={`${item.label}: ${item.count}`}
                      />
                    ))}
                  </div>

                  <div className="summary-grid">
                    <div className="summary-stat valid">
                      <span>valid</span>
                      <strong>{validCount}</strong>
                    </div>
                    <div className="summary-stat accept-all">
                      <span>accept-all</span>
                      <strong>{acceptAllCount}</strong>
                    </div>
                    <div className="summary-stat not-found">
                      <span>not found</span>
                      <strong>{notFoundCount}</strong>
                    </div>
                    <div className="summary-stat">
                      <span>avg confidence</span>
                      <strong>{Math.round(bulkSummary.avgConfidence * 100)}%</strong>
                    </div>
                    <div className="summary-stat">
                      <span>unique domains</span>
                      <strong>{bulkSummary.uniqueDomains}</strong>
                    </div>
                    <div className="summary-stat">
                      <span>missing inputs</span>
                      <strong>{bulkSummary.missingInputCount}</strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="table-status">
                <span>
                  showing <strong>{visibleRows.length}</strong> of <strong>{rows.length}</strong> rows
                </span>
                {running ? (
                  <span>active rows stay pinned while the batch runs</span>
                ) : rows.length > MAX_VISIBLE_ROWS ? (
                  <span>export includes every row</span>
                ) : null}
              </div>

              <div className="tbl-wrap compact-window">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 84 }}>uuid</th>
                      <th>name</th>
                      <th>domain</th>
                      <th>email</th>
                      <th style={{ width: 110 }}>status</th>
                      <th style={{ width: 90 }}>confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(({ row: r, index: i }) => {
                      const out = results[i];
                      const state: RowState = out
                        ? 'done'
                        : activeIds.has(i)
                          ? 'processing'
                          : 'pending';
                      return (
                        <tr
                          key={r.uuid || i}
                          className={`row-${state}`}
                        >
                          <td className="mono small">{r.uuid.slice(0, 8)}</td>
                          <td className="cell-name">
                            <span className="trunc" title={`${r.firstName} ${r.lastName}`}>
                              {r.firstName} {r.lastName}
                            </span>
                          </td>
                          <td className="mono cell-domain">
                            <span className="trunc" title={r.domain}>{r.domain}</span>
                          </td>
                          <td className="mono cell-email">
                            {out?.email ? (
                              <span
                                className="trunc"
                                title={out.email}
                              >
                                {out.email}
                              </span>
                            ) : state === 'processing' ? (
                              <Spinner />
                            ) : (
                              <span style={{ color: 'var(--ink-4)' }}>—</span>
                            )}
                          </td>
                          <td>
                            {out ? (
                              <StatusBadge status={out.status} />
                            ) : state === 'processing' ? (
                              <StatusBadge status="pending" />
                            ) : (
                              <span style={{ color: 'var(--ink-4)' }}>—</span>
                            )}
                          </td>
                          <td>
                            {out ? (
                              <ConfidenceBar value={out.confidence} small />
                            ) : (
                              <span style={{ color: 'var(--ink-4)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
