'use client';

import { useState } from 'react';
import BatchLookup from './batch';
import ManualLookup from './manual';

type Tab = 'manual' | 'bulk';

export function Workbench({ bulkEnabled }: { bulkEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>('manual');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'manual', label: 'single' },
    ...(bulkEnabled ? [{ id: 'bulk' as Tab, label: 'bulk' }] : []),
  ];
  const showBulk = bulkEnabled && tab === 'bulk';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{showBulk ? 'bulk' : 'single'}</h1>
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
