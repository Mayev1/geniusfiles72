/**
 * Historique des transferts — persistance localStorage.
 */
import type { HistoryEntry } from "./types";

const LS_KEY = "gf.transfer.history";
const EVT = "gf:transfer-history-changed";
const MAX = 200;

function safeRead<T>(fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVT));
}

export function listHistory(): HistoryEntry[] {
  return safeRead<HistoryEntry[]>([]).sort((a, b) => b.endedAt - a.endedAt);
}

export function appendHistory(entry: HistoryEntry) {
  const all = [entry, ...safeRead<HistoryEntry[]>([]).filter((e) => e.id !== entry.id)];
  safeWrite(all.slice(0, MAX));
}

export function removeHistoryEntry(id: string) {
  const all = safeRead<HistoryEntry[]>([]).filter((e) => e.id !== id);
  safeWrite(all);
}

export function clearHistory() {
  safeWrite([]);
}

export function subscribeHistory(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}
