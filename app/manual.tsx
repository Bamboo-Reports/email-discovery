'use client';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfidenceBar } from '@/components/ConfidenceBar';

type Mode = 'find' | 'verify';

type Provider = { status: string; confidence: number } | null;

type Result = {
  email: string;
  status: 'valid' | 'invalid' | 'accept-all' | 'not found';
  confidence: number;
  rr: Provider;
  mv: Provider;
  title: string;
  at: string;
  cached?: boolean;
  cachedAt?: string;
};

type DomainSuggestion = {
  name: string;
  domain: string;
  icon?: string;
};

const MODES: { id: Mode; label: string }[] = [
  { id: 'find', label: 'discovery' },
  { id: 'verify', label: 'verification' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ManualLookup() {
  const [mode, setMode] = useState<Mode>('find');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [domain, setDomain] = useState('');
  const [domainSuggestions, setDomainSuggestions] = useState<DomainSuggestion[]>([]);
  const [email, setEmail] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const [mvChecking, setMvChecking] = useState(false);

  const cleanDomain = (d: string) =>
    d.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  useEffect(() => {
    const q = domain.trim();
    if (mode !== 'find' || q.length < 2 || q.includes('.')) {
      setDomainSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/company-domains?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setDomainSuggestions(Array.isArray(data.domains) ? data.domains : []);
      } catch {
        if (!controller.signal.aborted) setDomainSuggestions([]);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [domain, mode]);

  const canRun =
    !running &&
    (mode === 'find'
      ? firstName.trim() !== '' && lastName.trim() !== '' && domain.trim() !== ''
      : EMAIL_RE.test(email.trim()));

  async function run() {
    if (!canRun) return;
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      let data: any;
      let title: string;
      if (mode === 'find') {
        const fn = firstName.trim();
        const ln = lastName.trim();
        const dm = cleanDomain(domain);
        const res = await fetch('/api/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName: fn, lastName: ln, domain: dm }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
        title = `${fn} ${ln} · ${dm}`;
      } else {
        const em = email.trim().toLowerCase();
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: em }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
        title = em;
      }
      setResult({
        email: data.email ?? '',
        status: (data.status ?? 'not found') as Result['status'],
        confidence: data.confidence ?? 0,
        rr: data.rr ?? null,
        mv: data.mv ?? null,
        title,
        at: new Date().toLocaleTimeString(),
        cached: data.cached ?? false,
        cachedAt: data.cachedAt,
      });
    } catch (e: any) {
      setError(e?.message ?? 'lookup failed');
    } finally {
      setRunning(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && canRun) run();
  }

  async function copyEmail() {
    if (!result?.email) return;
    try {
      await navigator.clipboard.writeText(result.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function checkWithMv() {
    if (!result?.email || mvChecking) return;
    setMvChecking(true);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: result.email, mvOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
      setResult((r) => (r ? { ...r, mv: data.mv ?? null } : r));
    } catch (e: any) {
      setError(e?.message ?? 'MillionVerifier check failed');
    } finally {
      setMvChecking(false);
    }
  }

  function switchMode(m: Mode) {
    if (m === mode) return;
    setMode(m);
    setResult(null);
    setError(null);
  }

  return (
    <div className="card lookup-card">
      <div className="card-body">
        <div className="tabs">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`tab ${mode === m.id ? 'active' : ''}`}
              onClick={() => switchMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'find' ? (
          <div className="row" onKeyDown={onKeyDown}>
            <div className="field">
              <label>
                first name<span className="req">●</span>
              </label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="abhishek"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>
                last name<span className="req">●</span>
              </label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="fodikar"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>
                domain<span className="req">●</span>
              </label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="researchnxt.com"
                autoComplete="off"
              />
              {domainSuggestions.length > 0 && (
                <div className="domain-suggestions">
                  {domainSuggestions.map((item) => (
                    <button
                      key={item.domain}
                      type="button"
                      onClick={() => {
                        setDomain(item.domain);
                        setDomainSuggestions([]);
                      }}
                    >
                      {item.icon && <img src={item.icon} alt="" />}
                      <span>{item.name || item.domain}</span>
                      <strong>{item.domain}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="btn accent"
              onClick={run}
              disabled={!canRun}
            >
              {running ? (
                <>
                  <Spinner /> verifying
                </>
              ) : (
                <>find email</>
              )}
            </button>
          </div>
        ) : (
          <div
            className="row"
            style={{ gridTemplateColumns: '1fr auto' }}
            onKeyDown={onKeyDown}
          >
            <div className="field">
              <label>
                email address<span className="req">●</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="abhishek.fodikar@researchnxt.com"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              className="btn accent"
              onClick={run}
              disabled={!canRun}
            >
              {running ? (
                <>
                  <Spinner /> verifying
                </>
              ) : (
                <>verify email</>
              )}
            </button>
          </div>
        )}

        {error && <div className="err">{error}</div>}

        {result && (
          <div className="result">
              <div className="result-head">
                <h4>{result.title}</h4>
                <span className="ts">
                  {result.cached && (
                    <span
                      className="cached-badge"
                      title={
                        result.cachedAt
                          ? `Reused a verification from ${new Date(result.cachedAt).toLocaleDateString()} — no credit used`
                          : 'Reused a recent verification — no credit used'
                      }
                    >
                      cached · no credit used
                    </span>
                  )}
                  {result.at}
                </span>
              </div>

              <div className="kv">
                <strong>email</strong>
                <span className="email-val">
                  {result.email ? (
                    <>
                      {result.email}
                      <button
                        className="copy-mini"
                        onClick={copyEmail}
                        title={copied ? 'copied' : 'copy'}
                      >
                        {copied ? '✓' : '⧉'}
                      </button>
                    </>
                  ) : (
                    <span style={{ color: 'var(--ink-4)' }}>— no candidate —</span>
                  )}
                </span>
              </div>

              <div className="kv">
                <strong>{mode === 'verify' && result.status === 'accept-all' ? 'certainty' : 'status'}</strong>
                <div className="verdicts">
                  {result.rr && (
                    <div className="verdict-tile">
                      <span className="vt-label">reacher</span>
                      <span className="vt-body">
                        <StatusBadge status={result.rr.status} />
                        <ConfidenceBar value={result.rr.confidence} small />
                      </span>
                    </div>
                  )}

                  {result.mv ? (
                    <div className="verdict-tile">
                      <span className="vt-label">millionverifier</span>
                      <span className="vt-body">
                        <StatusBadge status={result.mv.status} />
                        <ConfidenceBar value={result.mv.confidence} small />
                        {result.email && (
                          <button
                            className="copy-mini mv-recheck"
                            onClick={checkWithMv}
                            disabled={mvChecking}
                            title="Re-check with MillionVerifier (uses 1 credit)"
                          >
                            {mvChecking ? <Spinner /> : '↻'}
                          </button>
                        )}
                      </span>
                    </div>
                  ) : result.rr && result.email ? (
                    <button
                      type="button"
                      className="verdict-tile verdict-cta"
                      onClick={checkWithMv}
                      disabled={mvChecking}
                      title="Verify this address with MillionVerifier (uses 1 credit)"
                    >
                      <span className="vt-label">millionverifier</span>
                      <span className="vt-cta-text">
                        {mvChecking ? (
                          <>
                            <Spinner /> checking…
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            check now
                          </>
                        )}
                      </span>
                    </button>
                  ) : null}

                  {!result.rr && !result.mv && (
                    <div className="verdict-tile">
                      <span className="vt-label">result</span>
                      <span className="vt-body">
                        <StatusBadge status={result.status} />
                        <ConfidenceBar value={result.confidence} small />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
        )}
      </div>
    </div>
  );
}
