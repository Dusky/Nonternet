import { useSyncExternalStore } from 'react';

// Choices kept on this device only (M9-D): how chat, boards and the terminal look and behave for this browser.
// Like the clock and wallpaper they are not part of the account, so they are not in the export.
export interface ChatPrefs { timestamps: boolean; joinPart: boolean }
export interface BoardPrefs { view: 'flat' | 'threaded'; reactions: boolean }
export interface TerminalPrefs { fontSize: number; reader: boolean; scrollback: number; copyOnSelect: boolean; bell: 'off' | 'flash' | 'sound' }

export const DEFAULTS = {
  chat: { timestamps: true, joinPart: true } as ChatPrefs,
  boards: { view: 'flat', reactions: true } as BoardPrefs,
  terminal: { fontSize: 16, reader: false, scrollback: 2000, copyOnSelect: false, bell: 'flash' } as TerminalPrefs,
};
type Key = keyof typeof DEFAULTS;
export const FONT_SIZES = [12, 14, 16, 18, 20, 24] as const;
export const SCROLLBACKS = [1000, 2000, 5000, 10000] as const;
export const BELLS = ['off', 'flash', 'sound'] as const;

// Whatever is stored is checked field by field; anything odd falls back to the default for that field.
export function parsePrefs<K extends Key>(key: K, raw: string | null): (typeof DEFAULTS)[K] {
  const d = DEFAULTS[key];
  let v: Record<string, unknown> = {};
  try { v = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { /* use defaults */ }
  if (typeof v !== 'object' || v === null) v = {};
  const out: Record<string, unknown> = { ...d };
  for (const [field, def] of Object.entries(d)) {
    const x = v[field];
    if (typeof def === 'boolean' && typeof x === 'boolean') out[field] = x;
    else if (field === 'view' && (x === 'flat' || x === 'threaded')) out[field] = x;
    else if (field === 'fontSize' && typeof x === 'number' && (FONT_SIZES as readonly number[]).includes(x)) out[field] = x;
    else if (field === 'scrollback' && typeof x === 'number' && (SCROLLBACKS as readonly number[]).includes(x)) out[field] = x;
    else if (field === 'bell' && typeof x === 'string' && (BELLS as readonly string[]).includes(x)) out[field] = x;
  }
  return out as unknown as (typeof DEFAULTS)[K];
}

const storageKey = (k: Key) => `ui:prefs:${k}`;
const cache = new Map<Key, { raw: string | null; value: unknown }>();

export function readPrefs<K extends Key>(key: K): (typeof DEFAULTS)[K] {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(storageKey(key)); } catch { /* blocked: defaults */ }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as (typeof DEFAULTS)[K]; // same object until it changes, as useSyncExternalStore needs
  const value = parsePrefs(key, raw);
  cache.set(key, { raw, value });
  return value;
}

export function savePrefs<K extends Key>(key: K, next: (typeof DEFAULTS)[K]): void {
  try { window.localStorage.setItem(storageKey(key), JSON.stringify(next)); } catch { /* a convenience only */ }
  window.dispatchEvent(new Event(`ui:prefs:${key}`));
}

export function usePrefs<K extends Key>(key: K): [(typeof DEFAULTS)[K], (change: Partial<(typeof DEFAULTS)[K]>) => void] {
  const value = useSyncExternalStore(
    (cb) => { window.addEventListener(`ui:prefs:${key}`, cb); window.addEventListener('storage', cb); return () => { window.removeEventListener(`ui:prefs:${key}`, cb); window.removeEventListener('storage', cb); }; },
    () => readPrefs(key), () => DEFAULTS[key]);
  return [value, (change) => savePrefs(key, { ...readPrefs(key), ...change })];
}
