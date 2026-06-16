'use client';

import { useTransition } from 'react';
import { toggleBulk } from '@/app/admin/actions';

export function BulkToggle({ email, enabled }: { email: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="switch" title={enabled ? 'bulk enabled' : 'bulk disabled'}>
      <input
        type="checkbox"
        checked={enabled}
        disabled={pending}
        onChange={(e) => start(() => toggleBulk(email, e.target.checked))}
      />
      <span className="switch-track" />
    </label>
  );
}
