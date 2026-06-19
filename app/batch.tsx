'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { generatePatterns } from '@/lib/patterns';

type Provider = { status: string; confidence: number } | null;
type BulkMode = 'discovery' | 'verification';
type BulkStatus = 'valid' | 'invalid' | 'accept-all' | 'not found';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

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
const PREVIEW_ROWS = 6;

type InRow = { uuid: string; firstName: string; lastName: string; domain: string; email: string };
type Out = { email: string; status: BulkStatus; confidence: number; rr: Provider; mv: Provider } | null;

type Parsed = { headers: string[]; rows: Record<string, string>[] };
type Mapping = { uuid: string; firstName: string; lastName: string; domain: string; email: string };

const BULK_MODES: { id: BulkMode; label: string }[] = [
  { id: 'discovery', label: 'discovery' },
  { id: 'verification', label: 'verification' },
];

const FIELD_DEFS: Record<BulkMode, { key: keyof Mapping; label: string; required: boolean; aliases: string[] }[]> = {
  discovery: [
    { key: 'uuid', label: 'uuid', required: false, aliases: ['uuid', 'id', 'uid', 'recordid'] },
    { key: 'firstName', label: 'first name', required: true, aliases: ['firstname', 'first', 'fname', 'givenname'] },
    { key: 'lastName', label: 'last name', required: true, aliases: ['lastname', 'last', 'lname', 'surname', 'familyname'] },
    { key: 'domain', label: 'domain', required: true, aliases: ['domain', 'website', 'companydomain', 'url', 'site', 'company'] },
  ],
  verification: [
    { key: 'uuid', label: 'uuid', required: true, aliases: ['uuid', 'id', 'uid', 'recordid'] },
    { key: 'email', label: 'email', required: true, aliases: ['email', 'emailaddress', 'mail', 'workemail'] },
  ],
};

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
function emptyMapping(): Mapping {
  return { uuid: '', firstName: '', lastName: '', domain: '', email: '' };
}

function guessMapping(headers: string[], mode: BulkMode): Mapping {
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
  const m = emptyMapping();
  for (const f of FIELD_DEFS[mode]) m[f.key] = pickFor(f.aliases);
  return m;
}

function toCSV(mode: BulkMode, rows: InRow[], results: Out[]): string {
  const header = mode === 'discovery'
    ? [
      'UUID', 'First Name', 'Last Name', 'Domain', 'Email', 'Status', 'Confidence',
      'RR Status', 'RR Confidence', 'MV Status', 'MV Confidence',
    ]
    : ['UUID', 'Email', 'Status', 'Confidence', 'RR Status', 'RR Confidence', 'MV Status', 'MV Confidence'];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const conf = (p: Provider) => (p ? p.confidence.toFixed(2) : '');
  const body = rows.map((r, i) => {
    const out = results[i];
    const values = mode === 'discovery'
      ? [
        r.uuid, r.firstName, r.lastName, r.domain,
        out?.email ?? '', out?.status ?? 'not found', (out?.confidence ?? 0).toFixed(2),
        out?.rr?.status ?? '', conf(out?.rr ?? null), out?.mv?.status ?? '', conf(out?.mv ?? null),
      ]
      : [
        r.uuid, r.email, out?.status ?? 'not found', (out?.confidence ?? 0).toFixed(2),
        out?.rr?.status ?? '', conf(out?.rr ?? null), out?.mv?.status ?? '', conf(out?.mv ?? null),
      ];
    return values.map(esc).join(',');
  });
  return [header.join(','), ...body].join('\n');
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'calculating';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default function BatchLookup() {
  const [mode, setMode] = useState<BulkMode>('discovery');
  const [rows, setRows] = useState<InRow[]>([]);
  const [results, setResults] = useState<Out[]>([]);
  const [running, setRunning] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runStartedDone, setRunStartedDone] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [importing, setImporting] = useState(false);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRunKey, setSavedRunKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping());
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
  const invalidCount = useMemo(
    () => results.filter((r) => r?.status === 'invalid').length,
    [results],
  );
  const remainingCount = Math.max(rows.length - doneCount, 0);
  const pct = rows.length ? doneCount / rows.length : 0;
  const bulkSummary = useMemo(() => {
    const completed = results.filter((r): r is NonNullable<Out> => r !== null);
    const successCount = validCount + acceptAllCount;
    const avgConfidence = completed.length
      ? completed
        .reduce((sum, r) => sum + r.confidence, 0) / completed.length
      : 0;
    const uniqueDomains = new Set(
      rows.map((r) => r.domain.trim().toLowerCase()).filter(Boolean),
    ).size;
    const missingInputCount = rows.filter((r) => (
      mode === 'discovery'
        ? !r.firstName || !r.lastName || !r.domain
        : !r.email
    )).length;
    const chartItems = [
      { key: 'valid', label: 'valid', count: validCount },
      { key: 'accept-all', label: 'accept-all', count: acceptAllCount },
      { key: 'invalid', label: 'invalid', count: invalidCount },
      { key: 'not-found', label: 'not found', count: notFoundCount },
    ];

    return {
      avgConfidence,
      chartItems,
      successCount,
      successRate: rows.length ? successCount / rows.length : 0,
      missingInputCount,
      uniqueDomains,
    };
  }, [acceptAllCount, invalidCount, mode, notFoundCount, results, rows, validCount]);
  const runStats = useMemo(() => {
    const elapsedMs = running && runStartedAt ? now - runStartedAt : 0;
    const completedThisRun = Math.max(doneCount - runStartedDone, 0);
    const avgMsPerRow = completedThisRun ? elapsedMs / completedThisRun : 0;
    const etaMs = completedThisRun ? remainingCount * avgMsPerRow : Number.NaN;
    const rowsPerMinute = avgMsPerRow ? 60_000 / avgMsPerRow : 0;
    return {
      elapsed: formatDuration(elapsedMs),
      eta: Number.isFinite(etaMs) ? formatDuration(etaMs) : 'calculating',
      rowsPerMinute,
    };
  }, [doneCount, remainingCount, runStartedAt, runStartedDone, running, now]);
  const completedRunKey = useMemo(() => {
    if (running || !rows.length || doneCount !== rows.length) return null;
    return [
      mode,
      runStartedAt ?? 'manual',
      rows.length,
      validCount,
      acceptAllCount,
      invalidCount,
      notFoundCount,
    ].join(':');
  }, [acceptAllCount, doneCount, invalidCount, mode, notFoundCount, rows.length, running, runStartedAt, validCount]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!completedRunKey || savedRunKey === completedRunKey || saveState !== 'idle') return;
    void saveCompletedExport(completedRunKey);
  }, [completedRunKey, saveState, savedRunKey]);

  async function saveCompletedExport(runKey: string) {
    const csv = toCSV(mode, rows, results);
    const filename = mode === 'discovery' ? 'email_discovery_results.csv' : 'email_verification_results.csv';
    setSaveState('saving');
    setSaveError(null);
    try {
      const res = await fetch('/api/bulk-exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          filename,
          csv,
          counts: {
            rowCount: rows.length,
            validCount,
            acceptAllCount,
            invalidCount,
            notFoundCount,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
      setSaveState('saved');
      setSavedRunKey(runKey);
    } catch (e: any) {
      setSaveState('error');
      setSaveError(e?.message ?? 'failed to save export');
    }
  }

  async function loadFile(file: File) {
    setError(null);
    setSaveState('idle');
    setSaveError(null);
    setSavedRunKey(null);
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
      setMapping(guessMapping(p.headers, mode));
    } catch (e: any) {
      setError(e.message ?? 'failed to read file');
    } finally {
      setImporting(false);
    }
  }

  // Apply the column mapping. Discovery rows are sorted by domain so same-domain
  // lookups run back-to-back, maximizing learned-format/catch-all reuse.
  function confirmMapping() {
    if (!parsed) return;
    const fieldDefs = FIELD_DEFS[mode];
    const missing = fieldDefs.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
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
      email: get(row, 'email').toLowerCase(),
    }));
    if (mode === 'discovery') {
      inRows.sort((a, b) => a.domain.toLowerCase().localeCompare(b.domain.toLowerCase()));
    }
    setRows(inRows);
    setResults(Array(inRows.length).fill(null));
    setParsed(null);
    setSaveState('idle');
    setSaveError(null);
    setSavedRunKey(null);
  }

  function switchMode(nextMode: BulkMode) {
    if (nextMode === mode || running) return;
    setMode(nextMode);
    setRows([]);
    setResults([]);
    setActiveIds(new Set());
    setParsed(null);
    setMapping(emptyMapping());
    setError(null);
    setSaveState('idle');
    setSaveError(null);
    setSavedRunKey(null);
    setDragging(false);
  }

  async function run() {
    setRunStartedAt(Date.now());
    setRunStartedDone(doneCount);
    setNow(Date.now());
    setSaveState('idle');
    setSaveError(null);
    setSavedRunKey(null);
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

    const verifyEmail = async (row: InRow): Promise<Out> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ROW_TIMEOUT_MS);
      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: row.email,
            source: 'bulk',
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) return { email: row.email, status: 'not found', confidence: 0, rr: null, mv: null };
        const data = await res.json();
        return {
          email: data.email || row.email,
          status: (data.status || 'not found') as BulkStatus,
          confidence: data.confidence ?? 0,
          rr: data.rr ?? null,
          mv: data.mv ?? null,
        };
      } catch {
        return { email: row.email, status: 'not found', confidence: 0, rr: null, mv: null };
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
          if (mode === 'verification') {
            if (!row.email) {
              next[i] = { email: '', status: 'not found', confidence: 0, rr: null, mv: null };
              continue;
            }
            next[i] = await verifyEmail(row);
            continue;
          }
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
    setNow(Date.now());
    setRunning(false);
  }

  function reset() {
    setRows([]);
    setResults([]);
    setActiveIds(new Set());
    setError(null);
    setParsed(null);
    setMapping(emptyMapping());
    setSaveState('idle');
    setSaveError(null);
    setSavedRunKey(null);
  }

  function download() {
    const csv = toCSV(mode, rows, results);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mode === 'discovery' ? 'email_discovery_results.csv' : 'email_verification_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const fieldDefs = FIELD_DEFS[mode];

  return (
    <div className="card">
      <div className="card-body">
          <div className="tabs">
            {BULK_MODES.map((m) => (
              <button
                key={m.id}
                className={`tab ${mode === m.id ? 'active' : ''}`}
                onClick={() => switchMode(m.id)}
                disabled={running}
              >
                {m.label}
              </button>
            ))}
          </div>

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
                {mode === 'discovery' ? 'map name and domain columns' : 'map uuid and email columns'} ·{' '}
                <kbd>.csv</kbd> <kbd>.xlsx</kbd>
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
                {fieldDefs.map((f) => (
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
                        const mapped = fieldDefs.find((f) => mapping[f.key] === h);
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
                  {mode === 'discovery'
                    ? 'rows are sorted by domain automatically'
                    : 'verification checks Reacher first, then MillionVerifier when needed'}
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
                {running && (
                  <div className="progress-meta">
                    <span><strong>{runStats.elapsed}</strong> elapsed</span>
                    <span><strong>{runStats.eta}</strong> ETA</span>
                    <span><strong>{doneCount}</strong> completed</span>
                    <span><strong>{remainingCount}</strong> remaining</span>
                    <span><strong>{activeIds.size || 1}</strong> active</span>
                    <span>
                      <strong>
                        {runStats.rowsPerMinute ? runStats.rowsPerMinute.toFixed(1) : '—'}
                      </strong>{' '}
                      rows/min
                    </span>
                  </div>
                )}
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
                {doneCount === rows.length && !running && (
                  <div className="small export-save-status">
                    {saveState === 'saving' ? (
                      <><Spinner /> saving export</>
                    ) : saveState === 'saved' ? (
                      <>saved to bulk history</>
                    ) : saveState === 'error' ? (
                      <>
                        export save failed
                        {completedRunKey && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => saveCompletedExport(completedRunKey)}
                          >
                            retry
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>
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
                        {mode === 'discovery'
                          ? `${bulkSummary.successCount} valid or probable emails found from ${rows.length} rows`
                          : `${bulkSummary.successCount} valid or accept-all emails from ${rows.length} rows`}
                      </p>
                    </div>
                    <strong>{Math.round(bulkSummary.successRate * 100)}%</strong>
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
                    <div className="summary-stat invalid">
                      <span>invalid</span>
                      <strong>{invalidCount}</strong>
                    </div>
                    <div className="summary-stat">
                      <span>avg confidence</span>
                      <strong>{Math.round(bulkSummary.avgConfidence * 100)}%</strong>
                    </div>
                    {mode === 'discovery' && (
                      <div className="summary-stat">
                        <span>unique domains</span>
                        <strong>{bulkSummary.uniqueDomains}</strong>
                      </div>
                    )}
                    <div className="summary-stat">
                      <span>missing inputs</span>
                      <strong>{bulkSummary.missingInputCount}</strong>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
      </div>
    </div>
  );
}
