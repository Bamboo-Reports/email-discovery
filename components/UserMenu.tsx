'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  RiArchiveLine,
  RiInboxUnarchiveLine,
  RiMoreFill,
  RiShieldUserLine,
  RiStackLine,
} from '@remixicon/react';
import { archiveUserAction, restoreUserAction, setAdminAction, toggleBulk } from '@/app/admin/actions';
import { Spinner } from './Spinner';

/**
 * Per-user "more options" menu in the admin team table: admin role, bulk
 * access and archive / restore. Owners (ADMIN_EMAILS) are read-only here. The panel is position: fixed so the table's scroll
 * container can't clip it.
 */
export function UserMenu({
  email,
  bulkEnabled,
  archived,
  role,
  isSelf,
  hasLogin,
}: {
  email: string;
  bulkEnabled: boolean;
  archived: boolean;
  role: 'owner' | 'admin' | 'member';
  isSelf: boolean;
  hasLogin: boolean;
}) {
  const isAdmin = role !== 'member';
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setConfirming(false); };
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); btnRef.current?.focus(); }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
    setConfirming(false);
    setError(null);
  }

  function run(action: () => Promise<void>, after?: () => void) {
    setError(null);
    start(async () => {
      try {
        await action();
        after?.();
      } catch (e: any) {
        setError(e?.message ?? 'failed');
      }
    });
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`user-menu-btn ${open ? 'open' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`options for ${email}`}
        onClick={toggle}
      >
        <RiMoreFill size={18} aria-hidden="true" />
      </button>

      {open && (
        <div ref={panelRef} className="user-menu" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label={`options for ${email}`}>
          <div className="user-menu-head">
            <strong title={email}>{email}</strong>
            <span>{archived ? 'archived' : role}{isSelf ? ' · you' : ''}</span>
          </div>

          <label className={`user-menu-row ${role === 'owner' || archived || !hasLogin || (isSelf && isAdmin) ? 'disabled' : ''}`}>
            <RiShieldUserLine size={16} aria-hidden="true" />
            <span className="user-menu-text">
              admin access
              <small>
                {role === 'owner' ? 'owner · set in ADMIN_EMAILS'
                  : archived ? 'restore the user first'
                  : !hasLogin ? 'no login account for this email'
                  : isSelf && isAdmin ? 'you can’t remove your own access'
                  : 'can see this page and manage users'}
              </small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={isAdmin}
                disabled={role === 'owner' || archived || !hasLogin || (isSelf && isAdmin) || pending}
                onChange={(e) => {
                  const next = e.target.checked;
                  run(() => setAdminAction(email, next));
                }}
              />
              <span className="switch-track" />
            </span>
          </label>

          <label className={`user-menu-row ${isAdmin || archived ? 'disabled' : ''}`}>
            <RiStackLine size={16} aria-hidden="true" />
            <span className="user-menu-text">
              bulk access
              <small>{isAdmin ? 'always on for admins' : archived ? 'restore the user first' : 'can upload csv and excel files'}</small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={isAdmin || bulkEnabled}
                disabled={isAdmin || archived || pending}
                onChange={(e) => {
                  const next = e.target.checked;
                  run(() => toggleBulk(email, next));
                }}
              />
              <span className="switch-track" />
            </span>
          </label>

          <div className="user-menu-sep" />

          {isAdmin || !hasLogin ? (
            <div className="user-menu-row disabled">
              <RiArchiveLine size={16} aria-hidden="true" />
              <span className="user-menu-text">
                archive user
                <small>{role === 'owner' ? 'owners can’t be archived' : isAdmin ? 'remove admin access first' : 'no login account for this email'}</small>
              </span>
            </div>
          ) : archived ? (
            <button type="button" className="user-menu-row" disabled={pending} onClick={() => run(() => restoreUserAction(email), () => setOpen(false))}>
              <RiInboxUnarchiveLine size={16} aria-hidden="true" />
              <span className="user-menu-text">
                restore access
                <small>lets them sign in again</small>
              </span>
              {pending && <Spinner />}
            </button>
          ) : confirming ? (
            <div className="user-menu-confirm">
              <span>stop this user from signing in? their history stays, and you can restore them any time.</span>
              <div>
                <button type="button" className="btn ghost" onClick={() => setConfirming(false)} disabled={pending}>cancel</button>
                <button type="button" className="btn danger" onClick={() => run(() => archiveUserAction(email), () => setOpen(false))} disabled={pending}>
                  {pending ? <Spinner /> : <RiArchiveLine size={15} aria-hidden="true" />} archive
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="user-menu-row danger" onClick={() => setConfirming(true)}>
              <RiArchiveLine size={16} aria-hidden="true" />
              <span className="user-menu-text">
                archive user
                <small>stops sign-in · keeps their history</small>
              </span>
            </button>
          )}

          {error && <div className="user-menu-error" role="alert">{error}</div>}
        </div>
      )}
    </>
  );
}
