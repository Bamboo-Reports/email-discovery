'use client';

import { useState } from 'react';
import BatchLookup from './batch';
import ManualLookup from './manual';

type Tab = 'manual' | 'bulk';

const TABS: { id: Tab; label: string }[] = [
  { id: 'manual', label: 'single lookup' },
  { id: 'bulk', label: 'bulk csv' },
];

export default function Page() {
  const [tab, setTab] = useState<Tab>('manual');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{tab === 'manual' ? 'email finder' : 'bulk email finder'}</h1>
          <p className="page-sub">
            {tab === 'manual'
              ? 'find an address from a name + domain, or verify an email you already have. probes run against the live mx record and the result is confidence-scored.'
              : 'upload a csv of names + domains. pattern detection runs against the live mx record; results are confidence-scored and exportable.'}
          </p>
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>{tab === 'manual' ? <ManualLookup /> : <BatchLookup />}</div>

      <p className="foot">internal · email workbench</p>
    </div>
  );
}
