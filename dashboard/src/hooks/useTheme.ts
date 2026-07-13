import { useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ThemePalette = 'waforge' | 'blue' | 'graphite' | 'indigo' | 'amber' | 'rose' | 'teal';

const THEME_KEY = 'waforge_theme';
const PALETTE_KEY = 'waforge_palette';
const LEGACY_THEME_KEYS = ['quantura_theme', 'WaForge_theme'];
const LEGACY_PALETTE_KEYS = ['quantura_palette', 'WaForge_palette'];

export const paletteOptions: Array<{ value: ThemePalette; label: string; color: string }> = [
  { value: 'waforge', label: 'Naukri Blue', color: '#0cadf3' },
  { value: 'blue', label: 'Royal Blue', color: '#2563eb' },
  { value: 'graphite', label: 'Graphite', color: '#64748b' },
  { value: 'indigo', label: 'Indigo', color: '#4f46e5' },
  { value: 'amber', label: 'Amber', color: '#d97706' },
  { value: 'rose', label: 'Rose', color: '#e11d48' },
  { value: 'teal', label: 'Teal', color: '#0d9488' },
];

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isPalette(value: string | null): value is ThemePalette {
  if (value === 'WaForge' || value === 'quantura') return false;
  return paletteOptions.some(option => option.value === value);
}

function readStorage(key: string, legacyKeys: string[]): string | null {
  const current = localStorage.getItem(key);
  if (current) return current;
  for (const legacy of legacyKeys) {
    const v = localStorage.getItem(legacy);
    if (v) return v;
  }
  return null;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = readStorage(THEME_KEY, LEGACY_THEME_KEYS);
    return isTheme(saved) ? saved : 'system';
  });
  const [palette, setPaletteState] = useState<ThemePalette>(() => {
    const saved = readStorage(PALETTE_KEY, LEGACY_PALETTE_KEYS);
    if (saved === 'quantura' || saved === 'WaForge') return 'waforge';
    return isPalette(saved) ? saved : 'waforge';
  });

  const applyTheme = useCallback((newTheme: Theme) => {
    const root = document.documentElement;

    if (newTheme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', newTheme);
    }
  }, []);

  const applyPalette = useCallback((newPalette: ThemePalette) => {
    document.documentElement.setAttribute('data-palette', newPalette);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme, applyTheme]);

  useEffect(() => {
    applyPalette(palette);
    localStorage.setItem(PALETTE_KEY, palette);
  }, [palette, applyPalette]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const setPalette = useCallback((newPalette: ThemePalette) => {
    setPaletteState(newPalette);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  }, []);

  const resolvedTheme =
    theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;

  return { theme, setTheme, toggleTheme, resolvedTheme, palette, setPalette, paletteOptions };
}
