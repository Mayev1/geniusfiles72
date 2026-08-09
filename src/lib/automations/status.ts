/**
 * Derive the display status of an automation from the execution history
 * plus a live "running" set maintained by the engine.
 */
import { loadExecutionHistory } from "./history";
import type { Automation, DisplayStatus, ExecutionRecord } from "./types";

const running = new Set<string>();
const listeners = new Set<() => void>();

export function markRunning(id: string) {
  running.add(id);
  listeners.forEach((l) => l());
}
export function markStopped(id: string) {
  running.delete(id);
  listeners.forEach((l) => l());
}
export function isRunning(id: string) {
  return running.has(id);
}
export function subscribeRunning(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function lastRealRun(id: string, history?: ExecutionRecord[]): ExecutionRecord | undefined {
  const h = history ?? loadExecutionHistory();
  return h.find((r) => r.automationId === id && !r.simulated);
}

export function displayStatus(
  a: Automation,
  history?: ExecutionRecord[],
): { status: DisplayStatus; label: string; tone: string } {
  if (isRunning(a.id))
    return { status: "running", label: "En cours d'exécution", tone: "bg-primary/15 text-primary" };
  if (!a.enabled)
    return { status: "disabled", label: "Désactivée", tone: "bg-muted text-muted-foreground" };
  const last = lastRealRun(a.id, history);
  if (!last)
    return { status: "pending", label: "En attente", tone: "bg-amber-500/15 text-amber-500" };
  if (last.status === "ok")
    return { status: "success", label: "Réussie", tone: "bg-emerald-500/15 text-emerald-500" };
  if (last.status === "partial")
    return { status: "partial", label: "Partielle", tone: "bg-amber-500/15 text-amber-500" };
  return { status: "failed", label: "Échouée", tone: "bg-red-500/15 text-red-500" };
}
