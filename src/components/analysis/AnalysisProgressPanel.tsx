/**
 * Panneau de progression des analyses — intégré à la page Outils.
 *
 * Rend rien lorsque la file est vide (aucun bruit visuel). Sinon affiche
 * un résumé compact avec pause/reprise/annulation, en s'appuyant sur le
 * moteur d'arrière-plan (`subscribeQueue`).
 */
import { useEffect, useState } from "react";
import { Pause, Play, X, Sparkles } from "lucide-react";
import {
  subscribeQueue,
  pauseQueue,
  resumeQueue,
  cancelAll,
  clearFinished,
} from "@/lib/analysis/queue";
import type { QueueSnapshot } from "@/lib/analysis/types";
import { countLabel, formatCount } from "@/lib/copy";

export function AnalysisProgressPanel() {
  const [snap, setSnap] = useState<QueueSnapshot | null>(null);

  useEffect(() => subscribeQueue(setSnap), []);

  if (!snap) return null;
  const active = snap.queued + snap.running;
  const finished = snap.done + snap.skipped + snap.failed + snap.cancelled;
  if (active === 0 && finished === 0) return null;

  const total = active + finished;
  const pct = total === 0 ? 0 : Math.round((finished / total) * 100);

  return (
    <div className="card-surface mt-2 flex flex-col gap-2 p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Analyse intelligente</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {active > 0
              ? snap.currentLabel
                ? `Analyse de « ${snap.currentLabel} »… (${countLabel(active, "fichier")} restant${active > 1 ? "s" : ""})`
                : `Analyse de ${countLabel(active, "fichier")} en attente…`
              : `${countLabel(finished, "fichier")} analysé${finished > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {active > 0 &&
            (snap.paused ? (
              <button
                type="button"
                aria-label="Reprendre"
                onClick={resumeQueue}
                className="rounded-lg bg-secondary p-1.5 text-foreground hover:bg-accent"
              >
                <Play className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Suspendre"
                onClick={pauseQueue}
                className="rounded-lg bg-secondary p-1.5 text-foreground hover:bg-accent"
              >
                <Pause className="h-4 w-4" />
              </button>
            ))}
          {active > 0 && (
            <button
              type="button"
              aria-label="Annuler"
              onClick={cancelAll}
              className="rounded-lg bg-secondary p-1.5 text-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {active === 0 && finished > 0 && (
            <button
              type="button"
              onClick={clearFinished}
              className="rounded-lg bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              Effacer
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{formatCount(snap.running)} en cours</span>
        <span>{formatCount(snap.queued)} en attente</span>
        <span>{formatCount(snap.done)} analysés</span>
        {snap.skipped > 0 && <span>{formatCount(snap.skipped)} déjà connus</span>}
        {snap.failed > 0 && (
          <span className="text-destructive">{formatCount(snap.failed)} en échec</span>
        )}
        {snap.paused && <span className="text-primary">Suspendu</span>}
      </div>
    </div>
  );
}
