/**
 * Cleaner deletion pipeline.
 *
 * Groups selected `CleanItem`s by parent PathRef and delegates to the
 * shared `deleteEntries` helper, which performs a SOFT delete (move to
 * Trash on Android via the native plugin, mock removal on the web).
 *
 * Emits progress after each batch and fires a global
 * `gf:storage-changed` event so the dashboard / storage stats refresh
 * immediately after the cleanup completes.
 */
import { deleteEntries } from "@/lib/files/operations";
import type { PathRef } from "@/lib/files/types";
import type { CleanItem } from "./types";
import { beginJob, finishJob, updateJob } from "@/lib/jobs/journal";

export type CleanupProgress = {
  processed: number;
  total: number;
  bytes: number;
  totalBytes: number;
  currentName?: string;
};

export type CleanupResult = {
  removed: number;
  failed: number;
  reclaimedBytes: number;
};

function keyOf(p: PathRef): string {
  return `${p.rootId}::${p.segments.join("/")}`;
}

export async function runCleanup(
  items: CleanItem[],
  onProgress?: (p: CleanupProgress) => void,
): Promise<CleanupResult> {
  const totalBytes = items.reduce((sum, i) => sum + (i.entry.size ?? 0), 0);
  const total = items.length;

  // Group by parent so each native call minimises IPC round-trips.
  const groups = new Map<string, { parent: PathRef; items: CleanItem[] }>();
  for (const it of items) {
    const k = keyOf(it.parent);
    const g = groups.get(k) ?? { parent: it.parent, items: [] };
    g.items.push(it);
    groups.set(k, g);
  }

  // Journal — enables resume if the process is killed mid-cleanup.
  const jobId = beginJob({
    kind: "clean",
    title: `${total} élément${total > 1 ? "s" : ""}`,
    total,
    totalBytes,
    payload: { items },
  });

  let processed = 0;
  let bytes = 0;
  let removed = 0;
  let failed = 0;

  try {
    for (const g of groups.values()) {
      const entries = g.items.map((i) => i.entry);
      const groupBytes = g.items.reduce((s, i) => s + (i.entry.size ?? 0), 0);
      onProgress?.({
        processed,
        total,
        bytes,
        totalBytes,
        currentName: entries[0]?.name,
      });
      const res = await deleteEntries(g.parent, entries);
      removed += res.succeeded ?? 0;
      failed += res.failed?.length ?? 0;
      processed += entries.length;
      bytes += groupBytes;
      updateJob(jobId, { completed: processed, bytes, totalBytes });
      onProgress?.({ processed, total, bytes, totalBytes });
    }
    finishJob(jobId, "done");
  } catch (err) {
    finishJob(jobId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }

  // Notify listeners (dashboard, storage stats) that the filesystem changed.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("gf:storage-changed"));
    } catch {
      /* ignore */
    }
  }

  return { removed, failed, reclaimedBytes: bytes };
}
