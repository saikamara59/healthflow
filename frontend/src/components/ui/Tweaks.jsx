import { useState, useEffect } from 'react';
import { Moon, Sun } from '@phosphor-icons/react';

// The workspace uses one theme (moss). Only light/dark mode is a per-browser choice.
const STORAGE_KEY = 'hf_tweaks';
const THEME = 'moss';

function storedMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const mode = raw ? JSON.parse(raw).mode : null;
    return mode === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState(() => document.documentElement.getAttribute('data-mode') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-mode', mode);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode }));
    } catch {
      /* noop */
    }
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));
  const Glyph = mode === 'dark' ? Sun : Moon;

  return (
    <button
      className="btn icon ghost theme-toggle"
      title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggle}
      aria-label="Toggle dark mode"
    >
      <Glyph weight="duotone" size={18} />
    </button>
  );
}

export function initTweaksFromStorage() {
  document.documentElement.setAttribute('data-theme', THEME);
  document.documentElement.setAttribute('data-density', 'comfortable');
  document.documentElement.setAttribute('data-mode', storedMode());
}
