/** WaForge dashboard browser storage keys (legacy Quantura/WaForge keys migrated on read). */

export const API_KEY_STORAGE = 'waforge_api_key';
const LEGACY_API_KEY_KEYS = ['quantura_api_key', 'WaForge_api_key'];

export const USER_ROLE_STORAGE = 'waforge_user_role';
const LEGACY_USER_ROLE_KEYS = ['quantura_user_role', 'WaForge_user_role'];

export const LANGUAGE_STORAGE = 'waforge_language';
export const LEGACY_LANGUAGE_STORAGE = 'quantura_language';

function readSession(key: string, legacy: string[]): string | null {
  const v = sessionStorage.getItem(key);
  if (v) return v;
  for (const k of legacy) {
    const old = sessionStorage.getItem(k);
    if (old) return old;
  }
  return null;
}

function readLocal(key: string, legacy: string[]): string | null {
  const v = localStorage.getItem(key);
  if (v) return v;
  for (const k of legacy) {
    const old = localStorage.getItem(k);
    if (old) return old;
  }
  return null;
}

export function getApiKey(): string | null {
  return readSession(API_KEY_STORAGE, LEGACY_API_KEY_KEYS);
}

export function setApiKey(key: string): void {
  sessionStorage.setItem(API_KEY_STORAGE, key);
  for (const k of LEGACY_API_KEY_KEYS) sessionStorage.removeItem(k);
}

export function clearApiKey(): void {
  sessionStorage.removeItem(API_KEY_STORAGE);
  for (const k of LEGACY_API_KEY_KEYS) sessionStorage.removeItem(k);
}

export function getUserRole(): string | null {
  return readLocal(USER_ROLE_STORAGE, LEGACY_USER_ROLE_KEYS);
}

export function setUserRole(role: string): void {
  localStorage.setItem(USER_ROLE_STORAGE, role);
  for (const k of LEGACY_USER_ROLE_KEYS) localStorage.removeItem(k);
}

export function clearUserRole(): void {
  localStorage.removeItem(USER_ROLE_STORAGE);
  for (const k of LEGACY_USER_ROLE_KEYS) localStorage.removeItem(k);
}
