import type { LibraryScope } from 'shared';

const STORAGE_KEY = 'recipe-maker.library-scope';

// Per-browser memory of the My/All switch. Storage can be missing or throw
// (private mode, blocked site data), so every access falls back to "mine".
export function loadLibraryScope(): LibraryScope {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'all' ? 'all' : 'mine';
  } catch {
    return 'mine';
  }
}

export function storeLibraryScope(scope: LibraryScope): void {
  try {
    localStorage.setItem(STORAGE_KEY, scope);
  } catch {
    // Not remembered; the switch still works for this visit.
  }
}
