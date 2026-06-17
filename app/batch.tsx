'use client';

import { useMemo, useRef, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfidenceBar } from '@/components/ConfidenceBar';
import { generatePatterns } from '@/lib/patterns';

type Provider = { status: string; confidence: number } | null;

type DomainHit =
  | { status: 'valid' | 'accept-all'; patternIndex: number; confidence: number; rr: Provider; mv: Provider }
  | { status: 'not found'; rr: Provider; mv: Provider };

// Reacher probes real SMTP through one proxy IP; parallel lookups get the IP
// throttled by Google/Microsoft (false invalids/unknowns). Serialize to 1.
const CONCURRENCY = 1;
// A reacher-fail domain can do ~11 SMTP probes + a full MV sweep, so a single row
// can run ~45s+. Keep the client timeout well above that or rows get aborted and
// wrongly shown as "not found" while the server is still resolving them.
const ROW_TIMEOUT_MS = 120_000;
const MAX_VISIBLE_ROWS = 10;
const PREVIEW_ROWS = 6;

type RowState = 'pending' | 'processing' | 'done';
type InRow = { uuid: string; firstName: string; lastName: string; domain: string };
type Out = { email: string; status: 'valid' | 'accept-all' | 'not found'; confidence: number; rr: Provider; mv: Provider } | null;

type Parsed = { headers: string[]; rows: Record<string, string>[] };
type Mapping = { uuid: string; firstName: string; lastName: string; domain: string };

const FIELD_DEFS: { key: keyof Mapping; label: string; required: boolean; aliases: string[] }[] = [
  { key: 'uuid', label: 'uuid', required: false, aliases: ['uuid', 'id', 'uid', 'recordid'] },
  { key: 'firstName', label: 'first name', required: true, aliases: ['firstname', 'first', 'fname', 'givenname'] },
  { key: 'lastName', label: 'last name', required: true, aliases: ['lastname', 'last', 'lname', 'surname', 'familyname'] },
  { key: 'domain', label: 'domain', required: true, aliases: ['domain', 'website', 'companydomain', 'url', 'site', 'company'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Parse .csv / .xlsx / .xls into headers + row objects (SheetJS handles all three).
// Loaded lazily so the ~400KB parser stays out of the initial page bundle.
async function parseFile(file: File): Promise<Parsed> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
  if (!aoa.length) return { headers: [], rows: [] };
  const headers = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
  const rows = aoa.slice(1).map((r) => {
    const cols = r as unknown[];
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = String(cols[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows };
}

// Best-effort auto-match of columns to fields by (normalized) header name.
function guessMapping(headers: string[]): Mapping {
  const used = new Set<string>();
  const pickFor = (aliases: string[]): string => {
    for (const a of aliases) {
      const hit = headers.find((h) => !used.has(h) && norm(h) === a);
      if (hit) { used.add(hit); return hit; }
    }
    for (const a of aliases) {
      const hit = headers.find((h) => !used.has(h) && norm(h).includes(a));
      if (hit) { used.add(hit); return hit; }
    }
    return '';
  };
  const m = { uuid: '', firstName: '', lastName: '', domain: '' } as Mapping;
  for (const f of FIELD_DEFS) m[f.key] = pickFor(f.aliases);
  return m;
}

function toCSV(rows: InRow[], results: Out[]): string {
  const header = [
    'UUID', 'First Name', 'Last Name', 'Domain', 'Email', 'Status', 'Confidence',
    'RR Status', 'RR Confidence', 'MV Status', 'MV Confidence',
  ];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const conf = (p: Provider) => (p ? p.confidence.toFixed(2) : '');
  const body = rows.map((r, i) => {
    const out = results[i];
    return [
      r.uuid, r.firstName, r.lastName, r.domain,
      out?.email ?? '', out?.status ?? 'not found', (out?.confidence ?? 0).toFixed(2),
      out?.rr?.status ?? '', conf(out?.rr ?? null), out?.mv?.status ?? '', conf(out?.mv ?? null),
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
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ uuid: '', firstName: '', lastName: '', domain: '' });
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
    setParsed(null);
    setImporting(true);
    await new Promise((r) => setTimeout(r, 300));
    try {
      if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
        throw new Error(`unsupported file "${file.name}". upload a .csv or .xlsx file.`);
      }
      const p = await parseFile(file);
      if (!p.headers.length) throw new Error('file is empty or has no header row.');
      if (!p.rows.length) throw new Error('file has headers but no data rows.');
      setParsed(p);
      setMapping(guessMapping(p.headers));
    } catch (e: any) {
      setError(e.message ?? 'failed to read file');
    } finally {
      setImporting(false);
    }
  }

  // Apply the column mapping, then sort by domain so same-domain lookups run
  // back-to-back — maximizes learned-format/catch-all reuse and eases throttling.
  function confirmMapping() {
    if (!parsed) return;
    const missing = FIELD_DEFS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
    if (missing.length) {
      setError(`map these column(s) first: ${missing.join(', ')}`);
      return;
    }
    setError(null);
    const get = (row: Record<string, string>, key: keyof Mapping) =>
      mapping[key] ? (row[mapping[key]] ?? '').trim() : '';
    const inRows: InRow[] = parsed.rows.map((row, i) => ({
      uuid: get(row, 'uuid') || `row-${i + 1}`,
      firstName: get(row, 'firstName'),
      lastName: get(row, 'lastName'),
      domain: get(row, 'domain'),
    }));
    inRows.sort((a, b) => a.domain.toLowerCase().localeCompare(b.domain.toLowerCase()));
    setRows(inRows);
    setResults(Array(inRows.length).fill(null));
    setParsed(null);
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
            source: 'bulk',
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) return { status: 'not found', rr: null, mv: null };
        const data = await res.json();
        const status = (data.status || 'not found') as 'valid' | 'accept-all' | 'not found';
        if (status === 'not found') return { status: 'not found', rr: data.rr ?? null, mv: data.mv ?? null };
        const patterns = generatePatterns(row.firstName, row.lastName, row.domain);
        const email = data.email || '';
        const confidence = data.confidence ?? 0;
        const idx = status === 'valid' ? patterns.findIndex((p) => p.email === email) : 0;
        if (idx < 0) return null;
        return { status, patternIndex: idx, confidence, rr: data.rr ?? null, mv: data.mv ?? null };
      } catch {
        return { status: 'not found', rr: null, mv: null };
      } finally {
        clearTimeout(timer);
      }
    };

    const applyHit = (i: number, row: InRow, hit: DomainHit) => {
      if (hit.status === 'not found') {
        next[i] = { email: '', status: 'not found', confidence: 0, rr: hit.rr, mv: hit.mv };
      } else {
        const patterns = generatePatterns(row.firstName, row.lastName, row.domain);
        next[i] = {
          email: patterns[hit.patternIndex].email,
          status: hit.status,
          confidence: hit.confidence,
          rr: hit.rr,
          mv: hit.mv,
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
            next[i] = { email: '', status: 'not found', confidence: 0, rr: null, mv: null };
            continue;
          }
          const hit = await lookupDomain(row);
          if (hit) applyHit(i, row, hit);
          else next[i] = { email: '', status: 'not found', confidence: 0, rr: null, mv: null };
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
    setParsed(null);
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
          {!parsed && rows.length === 0 && !importing && (
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
                <strong>drop a CSV or Excel file here</strong>
              </div>
              <div className="small" style={{ marginTop: 10 }}>
                or click to choose · <kbd>.csv</kbd> <kbd>.xlsx</kbd> · you&apos;ll map the
                columns next
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
              <div className="drop-icon">
                <Spinner />
              </div>
              <div>
                <strong>reading file…</strong>
              </div>
              <div className="small" style={{ marginTop: 8 }}>parsing rows</div>
            </div>
          )}

        {error && <div className="err">{error}</div>}

          {parsed && rows.length === 0 && (
            <div className="map-panel">
              <div className="map-head">
                <div>
                  <h3>map your columns</h3>
                  <p>
                    matched <strong>{parsed.rows.length}</strong> rows · pick which column feeds
                    each field, then verify
                  </p>
                </div>
                <span className="map-filecount">{parsed.headers.length} columns</span>
              </div>

              <div className="map-grid">
                {FIELD_DEFS.map((f) => (
                  <div className="field" key={f.key}>
                    <label>
                      {f.label}
                      {f.required ? <span className="req">●</span> : <span className="opt"> optional</span>}
                    </label>
                    <select
                      value={mapping[f.key]}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    >
                      <option value="">— not mapped —</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="map-preview-label">
                preview · first {Math.min(PREVIEW_ROWS, parsed.rows.length)} rows
              </div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      {parsed.headers.map((h) => {
                        const mapped = FIELD_DEFS.find((f) => mapping[f.key] === h);
                        return (
                          <th key={h} className={mapped ? 'col-mapped' : ''}>
                            {h}
                            {mapped && <span className="col-tag">{mapped.label}</span>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                      <tr key={i}>
                        {parsed.headers.map((h) => (
                          <td key={h} className="mono small">
                            <span className="trunc" title={r[h]}>{r[h] || '—'}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="toolbar">
                <button className="btn primary" onClick={confirmMapping}>
                  verify {parsed.rows.length} rows
                </button>
                <div className="small" style={{ color: 'var(--ink-4)' }}>
                  rows are sorted by domain automatically
                </div>
                <div className="spacer" />
                <button className="btn" onClick={reset}>cancel</button>
              </div>
            </div>
          )}

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
                      <th style={{ width: 110 }}>mv</th>
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
                            {out?.mv ? (
                              <StatusBadge status={out.mv.status} />
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
