import { loadSnapshot, serializeSnapshot } from '../state/simStore';

const STORAGE_KEY = 'agentsims:save:v1';

export function hasSavedGame(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function saveToLocalStorage(): void {
  const snapshot = serializeSnapshot();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function loadFromLocalStorage(): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const snapshot = JSON.parse(raw);
    loadSnapshot(snapshot);
  } catch (err) {
    console.warn('Failed to load save:', err);
  }
}
