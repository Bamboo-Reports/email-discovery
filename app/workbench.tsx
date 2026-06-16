'use client';

import { useState } from 'react';
import BatchLookup from './batch';
import ManualLookup from './manual';

type Tab = 'manual' | 'bulk';

export function Workbench({ bulkEnabled }: { bulkEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>('manual');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'manual', label: 'single lookup' },
    ...(bulkEnabled ? [{ id: 'bulk' as Tab, label: 'bulk csv' }] : []),
  ];
  const showBulk = bulkEnabled && tab === 'bulk';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{showBulk ? 'bulk email finder' : 'email finder'}</h1>
          <p className="page-sub">
            {showBulk
              ? 'upload a csv of names + domains. pattern detection runs against the live mx record; results are confidence-scored and exportable.'
              : 'find an address from a name + domain, or verify an email you already have. probes run against the live mx record and the result is confidence-scored.'}
          </p>
        </div>
      </header>

      {tabs.length > 1 && (
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div>{showBulk ? <BatchLookup /> : <ManualLookup />}</div>

      <p className="foot">internal · email workbench</p>
    </div>
  );
}
