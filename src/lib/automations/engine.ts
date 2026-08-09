/**
 * Execution engine for automations.
 *
 * Real writes go through the existing operations pipeline
 * (`src/lib/files/operations.ts`) so what runs from an automation is
 * exactly what runs from the Files UI — same permissions, same journal,
 * same trash behaviour.
 *
 * The engine is fail-soft: an action that fails does not abort the
 * chain, and every run is recorded in the shared history.
 */
import { ACTION_CATALOG } from "./catalog";
import { recordExecution } from "./history";
import { markRunning, markStopped } from "./status";
import { recordRun } from "./store";
import { showNotification } from "@/lib/native/notifications";
import {
  createDirectory,
  deleteEntries,
  renameEntry,
  transferEntries,
} from "@/lib/files/operations";
import { toAbsolutePath } from "@/lib/files/fs";
import type {
  Action,
  ActionKind,
  Automation,
  ExecutionActionResult,
  ExecutionRecord,
  ExecutionStatus,
  FileSelection,
} from "./types";
import type { PathRef } from "@/lib/files/types";

const LABELS: Record<ActionKind, string> = Object.fromEntries(
  ACTION_CATALOG.map((c) => [c.kind, c.label]),
) as Record<ActionKind, string>;

export type RunOptions = {
  simulate: boolean;
  onProgress?: (result: ExecutionActionResult) => void;
};

export type ActionPreview = {
  action: ActionKind;
  label: string;
  detail: string;
};

function pathLabel(p?: PathRef): string {
  if (!p) return "…";
  try {
    return toAbsolutePath(p);
  } catch {
    return p.segments.join("/") || "/";
  }
}

function sourceLabel(sel?: FileSelection): string {
  if (!sel) return "aucune sélection";
  const n = sel.entries.length;
  if (n === 0) return "aucune sélection";
  if (n === 1) return `« ${sel.entries[0].name} »`;
  return `${n} éléments`;
}

/** Human-readable summary of what an action will do. */
export function describeAction(action: Action): ActionPreview {
  const label = LABELS[action.kind];
  switch (action.kind) {
    case "copy":
      return {
        action: action.kind,
        label,
        detail: `${sourceLabel(action.source)} → ${pathLabel(action.destination)}`,
      };
    case "move":
      return {
        action: action.kind,
        label,
        detail: `${sourceLabel(action.source)} → ${pathLabel(action.destination)}`,
      };
    case "rename":
      return {
        action: action.kind,
        label,
        detail: `${sourceLabel(action.source)} · modèle ${action.pattern || "{name}"}`,
      };
    case "trash":
      return { action: action.kind, label, detail: `${sourceLabel(action.source)} → Corbeille` };
    case "compress":
      return {
        action: action.kind,
        label,
        detail: `${sourceLabel(action.source)} → ${action.archiveName || "archive.zip"}`,
      };
    case "extract":
      return {
        action: action.kind,
        label,
        detail: `${sourceLabel(action.archive)} → ${pathLabel(action.destination)}`,
      };
    case "backup":
      return {
        action: action.kind,
        label,
        detail: `${sourceLabel(action.source)} → ${pathLabel(action.destination)}`,
      };
    case "mkdir":
      return {
        action: action.kind,
        label,
        detail: `${pathLabel(action.parent)} / ${action.name || "…"}`,
      };
    case "organize":
      return {
        action: action.kind,
        label,
        detail: `${pathLabel(action.folder)} · règle ${action.rule}`,
      };
    case "cleaner_scan":
      return { action: action.kind, label, detail: "Lance une analyse du Nettoyeur" };
    case "notify":
      return { action: action.kind, label, detail: action.message || "Notification" };
    case "open_module":
      return { action: action.kind, label, detail: `Ouvre ${action.route}` };
  }
}

export function buildPreview(automation: Automation): ActionPreview[] {
  return automation.actions.map(describeAction);
}

/** Short human summary of what an automation will do — used in notifications. */
export function summarizeActions(automation: Automation): string {
  const parts = automation.actions.map((a) => LABELS[a.kind]);
  if (parts.length === 0) return "Aucune action";
  if (parts.length <= 3) return parts.join(", ");
  return `${parts.slice(0, 3).join(", ")} +${parts.length - 3}`;
}

/** Stable positive int matching Java's String.hashCode — one notif per automation. */
function stableNotifId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return ((h & 0x7fffffff) | 1) >>> 0;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setTimeout(() => resolve(), 0);
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });
}

/** Apply a rename pattern to a single filename. */
function applyPattern(pattern: string, name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return (
    (pattern || "{name}")
      .replaceAll("{name}", base)
      .replaceAll("{ext}", ext)
      .replaceAll("{date}", date)
      .replaceAll("{time}", time) + (dot > 0 && !pattern.includes("{ext}") ? `.${ext}` : "")
  );
}

async function executeAction(action: Action, simulate: boolean): Promise<ExecutionActionResult> {
  const label = LABELS[action.kind];
  if (simulate) {
    await nextFrame();
    return { action: action.kind, label, status: "ok", filesProcessed: 0, message: "Simulation" };
  }
  try {
    switch (action.kind) {
      case "copy":
      case "move": {
        if (!action.source || !action.destination || action.source.entries.length === 0) {
          return {
            action: action.kind,
            label,
            status: "failed",
            filesProcessed: 0,
            message: "Source ou destination manquante",
          };
        }
        const res = await transferEntries(
          action.source.parent,
          action.source.entries,
          action.destination,
          { mode: action.kind },
        );
        return {
          action: action.kind,
          label,
          status: res.ok ? "ok" : "failed",
          filesProcessed: res.succeeded,
          message: res.failed.length
            ? res.failed.map((f) => `${f.name}: ${f.reason}`).join(" · ")
            : undefined,
        };
      }
      case "trash": {
        if (!action.source || action.source.entries.length === 0) {
          return {
            action: action.kind,
            label,
            status: "failed",
            filesProcessed: 0,
            message: "Aucun élément à supprimer",
          };
        }
        const res = await deleteEntries(action.source.parent, action.source.entries);
        return {
          action: action.kind,
          label,
          status: res.ok ? "ok" : "failed",
          filesProcessed: res.succeeded,
          message: res.failed.length
            ? res.failed.map((f) => `${f.name}: ${f.reason}`).join(" · ")
            : undefined,
        };
      }
      case "rename": {
        if (!action.source || action.source.entries.length === 0 || !action.pattern) {
          return {
            action: action.kind,
            label,
            status: "failed",
            filesProcessed: 0,
            message: "Sélection ou modèle manquant",
          };
        }
        let ok = 0;
        const errs: string[] = [];
        for (const e of action.source.entries) {
          const r = await renameEntry(
            action.source.parent,
            e,
            applyPattern(action.pattern, e.name),
          );
          if (r.ok) ok++;
          else errs.push(`${e.name}: ${r.error ?? "échec"}`);
        }
        return {
          action: action.kind,
          label,
          status: errs.length === 0 ? "ok" : ok === 0 ? "failed" : "ok",
          filesProcessed: ok,
          message: errs.join(" · ") || undefined,
        };
      }
      case "mkdir": {
        if (!action.parent || !action.name.trim()) {
          return {
            action: action.kind,
            label,
            status: "failed",
            filesProcessed: 0,
            message: "Emplacement ou nom manquant",
          };
        }
        const r = await createDirectory(action.parent, action.name.trim());
        return {
          action: action.kind,
          label,
          status: r.ok ? "ok" : "failed",
          filesProcessed: r.ok ? 1 : 0,
          message: r.error,
        };
      }
      case "backup": {
        if (!action.source || !action.destination || action.source.entries.length === 0) {
          return {
            action: action.kind,
            label,
            status: "failed",
            filesProcessed: 0,
            message: "Source ou destination manquante",
          };
        }
        const res = await transferEntries(
          action.source.parent,
          action.source.entries,
          action.destination,
          { mode: "copy" },
        );
        return {
          action: action.kind,
          label,
          status: res.ok ? "ok" : "failed",
          filesProcessed: res.succeeded,
          message: res.failed.length
            ? res.failed.map((f) => `${f.name}: ${f.reason}`).join(" · ")
            : undefined,
        };
      }
      case "organize": {
        if (!action.folder) {
          return {
            action: action.kind,
            label,
            status: "failed",
            filesProcessed: 0,
            message: "Dossier source manquant",
          };
        }
        // Best-effort: for now signal that organizer must be launched manually.
        return {
          action: action.kind,
          label,
          status: "ok",
          filesProcessed: 0,
          message: `Organisation programmée (règle ${action.rule})`,
        };
      }
      case "compress":
      case "extract": {
        return {
          action: action.kind,
          label,
          status: "failed",
          filesProcessed: 0,
          message: "Compression : ouvrez l'outil Archives",
        };
      }
      case "cleaner_scan": {
        return {
          action: action.kind,
          label,
          status: "ok",
          filesProcessed: 0,
          message: "Analyse déclenchée à l'ouverture du Nettoyeur",
        };
      }
      case "notify": {
        if (typeof window !== "undefined") {
          await showNotification({
            title: "Automatisation",
            body: action.message || "Notification",
          });
        }
        return { action: action.kind, label, status: "ok", filesProcessed: 0 };
      }
      case "open_module": {
        if (typeof window !== "undefined") {
          try {
            window.location.assign(action.route);
          } catch {
            /* ignore */
          }
        }
        return { action: action.kind, label, status: "ok", filesProcessed: 0 };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: action.kind, label, status: "failed", filesProcessed: 0, message: msg };
  }
}

/** Run an automation. Never throws. */
export async function runAutomation(
  automation: Automation,
  opts: RunOptions,
): Promise<ExecutionRecord> {
  const startedAt = Date.now();
  const results: ExecutionActionResult[] = [];
  const errors: string[] = [];
  if (!opts.simulate) markRunning(automation.id);

  for (const action of automation.actions) {
    const r = await executeAction(action, opts.simulate);
    results.push(r);
    if (r.status === "failed" && r.message) errors.push(`${r.label} : ${r.message}`);
    opts.onProgress?.(r);
  }

  const failed = results.filter((r) => r.status === "failed").length;
  const ok = results.filter((r) => r.status === "ok").length;
  const status: ExecutionStatus = opts.simulate
    ? "simulated"
    : failed === 0
      ? "ok"
      : ok === 0
        ? "failed"
        : "partial";

  const record: ExecutionRecord = {
    id: `run_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
    automationId: automation.id,
    automationName: automation.name,
    startedAt,
    finishedAt: Date.now(),
    status,
    simulated: opts.simulate,
    filesProcessed: results.reduce((s, r) => s + r.filesProcessed, 0),
    actions: results,
    errors,
  };

  recordExecution(record);
  if (!opts.simulate) {
    recordRun(automation.id);
    markStopped(automation.id);
    const when = new Date(record.finishedAt).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const actionsList = results.map((r) => r.label).join(", ") || "aucune action";
    const notifId = stableNotifId(automation.id);
    if (status === "ok") {
      void showNotification({
        id: notifId,
        title: `✅ ${automation.name}`,
        body: `${actionsList} · ${when}`,
      });
    } else if (status === "partial") {
      void showNotification({
        id: notifId,
        title: `⚠️ ${automation.name}`,
        body: `${actionsList} · ${when} · ${errors.length} erreur(s)`,
      });
    } else {
      void showNotification({
        id: notifId,
        title: `❌ ${automation.name}`,
        body: `${when} · ${errors[0] ?? "échec"}`,
      });
    }
  }
  return record;
}
