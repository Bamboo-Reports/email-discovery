'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';

const ALLOWED_DOMAIN = 'researchnxt.com';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setNotice(null);
    const em = email.trim().toLowerCase();
    if (!em || !password) return;

    if (mode === 'signup' && !em.endsWith('@' + ALLOWED_DOMAIN)) {
      setError(`sign-up is restricted to @${ALLOWED_DOMAIN} addresses`);
      return;
    }

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email: em, password });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setNotice('account created — check your email to confirm, then sign in.');
          setMode('signin');
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <header className="page-head">
        <div>
          <h1>email workbench</h1>
          <p className="page-sub">sign in to find, verify, and track email lookups.</p>
        </div>
      </header>

      <div className="card">
        <div className="card-body">
          <div className="tabs">
            <button
              className={`tab ${mode === 'signin' ? 'active' : ''}`}
              onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
            >
              sign in
            </button>
            <button
              className={`tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => { setMode('signup'); setError(null); setNotice(null); }}
            >
              sign up
            </button>
          </div>

          <div
            className="row"
            style={{ gridTemplateColumns: '1fr' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
          >
            <div className="field">
              <label>email address<span className="req">●</span></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you@${ALLOWED_DOMAIN}`}
                autoComplete="email"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label>password<span className="req">●</span></label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </div>
            <button className="btn accent" onClick={submit} disabled={busy || !email || !password}>
              {busy ? <><Spinner /> {mode === 'signin' ? 'signing in' : 'creating'}</> : (mode === 'signin' ? 'sign in' : 'create account')}
            </button>
          </div>

          {error && <div className="err">{error}</div>}
          {notice && <div className="small" style={{ marginTop: 12 }}>{notice}</div>}
        </div>
      </div>

      <p className="foot">internal · email workbench</p>
    </div>
  );
}
