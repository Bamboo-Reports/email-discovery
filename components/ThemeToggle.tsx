'use client';

import { useEffect, useState } from 'react';
import { RiMoonLine, RiSunLine } from '@remixicon/react';

type Theme = 'light' | 'dark';

function preferredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light / dark segmented switch (lives in the account menu). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const next = preferredTheme();
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem('theme', next);
  }

  return (
    <div className="theme-switch" role="radiogroup" aria-label="theme">
      <button
        type="button"
        role="radio"
        aria-checked={theme === 'light'}
        className={theme === 'light' ? 'active' : ''}
        onClick={() => choose('light')}
      >
        <RiSunLine size={15} aria-hidden="true" /> light
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={theme === 'dark'}
        className={theme === 'dark' ? 'active' : ''}
        onClick={() => choose('dark')}
      >
        <RiMoonLine size={15} aria-hidden="true" /> dark
      </button>
    </div>
  );
}
