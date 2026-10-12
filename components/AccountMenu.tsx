'use client';

import { useEffect, useRef, useState } from 'react';
import {
  RiArrowDownSLine,
  RiLogoutBoxRLine,
  RiPaletteLine,
  RiServerLine,
  RiShieldUserLine,
  RiStackLine,
} from '@remixicon/react';
import { ThemeToggle } from './ThemeToggle';
import { BackendStatusList, overallState, useBackendHealth } from './BackendStatus';

/**
 * "My account" dropdown: account info, theme switch, backend status, sign out.
 * The avatar carries an alert dot when an in-use backend is degraded or down.
 */
export function AccountMenu({
  email,
  isAdmin,
  bulkEnabled,
}: {
  email: string;
  isAdmin: boolean;
  bulkEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { report, failed } = useBackendHealth();
  const health = overallState(report);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = email.charAt(0).toUpperCase();
  const alert = health === 'down' || health === 'degraded';

  return (
    <div className="account" ref={rootRef}>
      <button
        type="button"
        className="account-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={() => setOpen((o) => !o)}
        title={alert ? 'my account · a verification service has a problem' : 'my account'}
      >
        <span className="account-avatar">
          {initial}
          {alert && <span className="account-alert" data-state={health} aria-hidden="true" />}
        </span>
        <span className="account-btn-label">my account</span>
        <RiArrowDownSLine size={16} aria-hidden="true" className="account-chevron" />
      </button>

      {open && (
        <div className="account-panel" id="account-panel">
          <div className="account-head">
            <span className="account-avatar lg">{initial}</span>
            <div className="account-id">
              <strong title={email}>{email}</strong>
              <div className="account-tags">
                <span className="account-tag">
                  <RiShieldUserLine size={12} aria-hidden="true" />
                  {isAdmin ? 'admin' : 'member'}
                </span>
                <span className={`account-tag ${bulkEnabled ? 'on' : ''}`}>
                  <RiStackLine size={12} aria-hidden="true" />
                  {bulkEnabled ? 'bulk access' : 'no bulk access'}
                </span>
              </div>
            </div>
          </div>

          <div className="account-section">
            <div className="account-section-title">
              <RiPaletteLine size={14} aria-hidden="true" /> appearance
            </div>
            <ThemeToggle />
          </div>

          <div className="account-section">
            <div className="account-section-title">
              <RiServerLine size={14} aria-hidden="true" /> verification services
            </div>
            <BackendStatusList report={report} failed={failed} />
          </div>

          <form action="/auth/signout" method="post" className="account-signout">
            <button type="submit" className="btn ghost">
              <RiLogoutBoxRLine size={16} aria-hidden="true" /> sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
