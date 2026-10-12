'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  RiAtLine,
  RiErrorWarningFill,
  RiLockLine,
  RiLoginBoxLine,
  RiMailCheckFill,
  RiUserAddLine,
} from '@remixicon/react';
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
  const [notice, setNotice] = useState<string | null>(
    params.get('archived') ? 'your access was removed. ask an admin if you still need it.' : null,
  );

  async function submit() {
    setError(null);
    setNotice(null);
    const em = email.trim().toLowerCase();
    if (!em || !password) return;

    if (mode === 'signup' && !em.endsWith('@' + ALLOWED_DOMAIN)) {
      setError(`only @${ALLOWED_DOMAIN} addresses can sign up.`);
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
          setNotice('account created. confirm it from the email we just sent, then sign in.');
          setMode('signin');
        }
      }
    } catch (e: any) {
      // Supabase reports archived (banned) accounts as "User is banned".
      setError(/banned/i.test(e?.message ?? '')
        ? 'this account is archived. ask an admin to restore it.'
        : (e?.message ?? 'couldn’t sign you in. check your email and password.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <header className="page-head">
        <div>
          <h1 className="brand-title">
            <span className="appnav-logo lg"><RiMailCheckFill size={20} aria-hidden="true" /></span>
            email workbench
          </h1>
          <p className="page-sub">sign in with your @{ALLOWED_DOMAIN} account.</p>
        </div>
      </header>

      <div className="card">
        <div className="card-body">
          <div className="tabs">
            <button
              className={`tab ${mode === 'signin' ? 'active' : ''}`}
              onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
            >
              <RiLoginBoxLine size={16} aria-hidden="true" />
              sign in
            </button>
            <button
              className={`tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => { setMode('signup'); setError(null); setNotice(null); }}
            >
              <RiUserAddLine size={16} aria-hidden="true" />
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
              <span className="input-icon">
                <RiAtLine size={16} aria-hidden="true" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`you@${ALLOWED_DOMAIN}`}
                  autoComplete="email"
                  spellCheck={false}
                />
              </span>
            </div>
            <div className="field">
              <label>password<span className="req">●</span></label>
              <span className="input-icon">
                <RiLockLine size={16} aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                />
              </span>
            </div>
            <button className="btn accent" onClick={submit} disabled={busy || !email || !password}>
              {busy ? <><Spinner /> {mode === 'signin' ? 'signing in' : 'creating account'}</> : (mode === 'signin'
                ? <><RiLoginBoxLine size={16} aria-hidden="true" /> sign in</>
                : <><RiUserAddLine size={16} aria-hidden="true" /> create account</>)}
            </button>
          </div>

          {error && <div className="err"><RiErrorWarningFill size={18} aria-hidden="true" /><span>{error}</span></div>}
          {notice && <div className="small" style={{ marginTop: 12 }}>{notice}</div>}
        </div>
      </div>
    </div>
  );
}
