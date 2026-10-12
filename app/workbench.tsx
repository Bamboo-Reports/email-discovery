'use client';

import { useState } from 'react';
import { RiStackLine, RiUserSearchLine, type RemixiconComponentType } from '@remixicon/react';
import BatchLookup from './batch';
import ManualLookup from './manual';

type Tab = 'manual' | 'bulk';

export function Workbench({ bulkEnabled }: { bulkEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>('manual');

  const tabs: { id: Tab; label: string; Icon: RemixiconComponentType }[] = [
    { id: 'manual', label: 'single', Icon: RiUserSearchLine },
    ...(bulkEnabled ? [{ id: 'bulk' as Tab, label: 'bulk', Icon: RiStackLine }] : []),
  ];
  const showBulk = bulkEnabled && tab === 'bulk';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{showBulk ? 'bulk lookup' : 'single lookup'}</h1>
        </div>
        {tabs.length > 1 && (
          <div className="tabs page-head-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <t.Icon size={16} />
              {t.label}
            </button>
          ))}
          </div>
        )}
      </header>

      <div>{showBulk ? <BatchLookup /> : <ManualLookup />}</div>
    </div>
  );
}
