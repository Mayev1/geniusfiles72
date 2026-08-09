/**
 * Smart Cleaner scanner.
 *
 * Streams a BFS traversal over the primary internal storage root using
 * the same `listDirectory` bridge as the rest of the app (native
 * java.io.File on Android, curated mock tree on the web preview) and
 * classifies files into 8 clean-up categories. Yields to the event
 * loop every N folders so the UI stays fluid even on filesystems with
 * hundreds of thousands of entries.
 *
 * Nothing is deleted here — the scanner strictly PROPOSES items. The
 * user must review and confirm before any removal via `runCleanup`.
 *
 * Foundations for future AI/automation:
 *  - Each item carries a `reason` and optional `group`, so an AI layer
 *    can enrich or re-rank without changing the UI contract.
 *  - Categories are self-describing so scheduled cleanups can reuse
 *    the exact same output shape.
 */
import { listDirectory } from "@/lib/files/fs";
import { extOf, kindOf } from "@/lib/files/format";
import type { FileEntry, PathRef } from "@/lib/files/types";
import type {
  CleanCategory,
  CleanCategoryKey,
  CleanItem,
  CleanScanHandle,
  CleanScanResult,
} from "./types";

/* -------- Heuristics -------- */

const LARGE_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
const OLD_DOWNLOAD_DAYS = 60;
const OLD_APK_DAYS = 14;
const DUP_MIN_BYTES = 64 * 1024; // ignore trivial duplicates
const MESSAGING_MEDIA_MIN_BYTES = 512 * 1024;

const TEMP_EXTS = new Set([
  "tmp",
  "temp",
  "log",
  "cache",
  "bak",
  "old",
  "part",
  "crdownload",
  "download",
  "dmp",
  "chk",
]);

const MESSAGING_KEYS = [
  "whatsapp",
  "telegram",
  "signal",
  "messenger",
  "viber",
  "discord",
  "wechat",
];

const SKIP_NAMES = new Set(["Android", ".trashed", ".Trash", ".Trash-1000"]);

const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]);

/* -------- Helpers -------- */

const CATEGORY_META: Record<CleanCategoryKey, { label: string; description: string }> = {
  duplicates: {
    label: "Doublons",
    description:
      "Fichiers identiques repérés à plusieurs endroits. La première copie est conservée.",
  },
  large: {
    label: "Fichiers volumineux",
    description: `Fichiers de plus de ${Math.round(LARGE_FILE_BYTES / (1024 * 1024))} Mo qui pèsent lourd sur votre stockage.`,
  },
  old_downloads: {
    label: "Téléchargements anciens",
    description: `Fichiers dans « Téléchargements » qui n'ont pas bougé depuis plus de ${OLD_DOWNLOAD_DAYS} jours.`,
  },
  empty_folders: {
    label: "Dossiers vides",
    description: "Dossiers sans aucun contenu — suppression sans risque.",
  },
  temp: {
    label: "Fichiers temporaires",
    description: "Caches, fichiers .tmp / .log / .bak qui peuvent être supprimés sans risque.",
  },
  extracted_archives: {
    label: "Archives déjà extraites",
    description:
      "Archives ZIP/RAR/7Z accompagnées d'un dossier du même nom : elles sont redondantes.",
  },
  apk: {
    label: "APK inutilisés",
    description: `Installateurs .apk plus vieux de ${OLD_APK_DAYS} jours — l'app est déjà installée.`,
  },
  messaging_media: {
    label: "Médias de messagerie",
    description: "Photos, vidéos et audio téléchargés par WhatsApp, Telegram, etc.",
  },
};

function emptyCategory(key: CleanCategoryKey): CleanCategory {
  return {
    key,
    label: CATEGORY_META[key].label,
    description: CATEGORY_META[key].description,
    items: [],
    bytes: 0,
  };
}

function emptyResult(): CleanScanResult {
  return {
    categories: {
      duplicates: emptyCategory("duplicates"),
      large: emptyCategory("large"),
      old_downloads: emptyCategory("old_downloads"),
      empty_folders: emptyCategory("empty_folders"),
      temp: emptyCategory("temp"),
      extracted_archives: emptyCategory("extracted_archives"),
      apk: emptyCategory("apk"),
      messaging_media: emptyCategory("messaging_media"),
    },
    totalItems: 0,
    totalBytes: 0,
    scannedFolders: 0,
    scannedFiles: 0,
    done: false,
    cancelled: false,
  };
}

function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(\d+\)(?=\.[a-z0-9]+$|$)/i, "")
    .replace(/[-_ ]copy(?:\s*\d*)?(?=\.[a-z0-9]+$|$)/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pathHasMessagingKey(segments: string[]): boolean {
  for (const s of segments) {
    const lower = s.toLowerCase();
    for (const k of MESSAGING_KEYS) if (lower.includes(k)) return true;
  }
  return false;
}

function daysAgo(mtime?: number): number {
  if (!mtime) return 0;
  return Math.max(0, (Date.now() - mtime) / (1000 * 60 * 60 * 24));
}

function pushItem(cat: CleanCategory, item: CleanItem) {
  cat.items.push(item);
  cat.bytes += item.entry.size ?? 0;
}

function idFor(parent: PathRef, name: string): string {
  return `${parent.rootId}:/${[...parent.segments, name].join("/")}`;
}

/* -------- Scanner -------- */

export function scanCleanup(
  roots: PathRef[],
  onProgress: (partial: CleanScanResult) => void,
  onDone: (result: CleanScanResult) => void,
): CleanScanHandle {
  let cancelled = false;
  const handle: CleanScanHandle = {
    cancel: () => {
      cancelled = true;
    },
  };
  const result = emptyResult();
  // Duplicate detection state.
  const dupBuckets = new Map<string, CleanItem[]>();

  (async () => {
    const queue: PathRef[] = [...roots];
    const visited = new Set<string>();
    let step = 0;

    while (queue.length && !cancelled) {
      const p = queue.shift()!;
      const key = `${p.rootId}/${p.segments.join("/")}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const res = await listDirectory(p);
      result.scannedFolders += 1;

      if (!res.ok) {
        step += 1;
        continue;
      }

      const visibleEntries = res.entries.filter((e) => !e.name.startsWith("."));

      // Empty folder detection: skip the top-level roots themselves.
      if (p.segments.length > 0 && visibleEntries.length === 0) {
        const parentSegs = p.segments.slice(0, -1);
        const parent: PathRef = { rootId: p.rootId, segments: parentSegs };
        const name = p.segments[p.segments.length - 1];
        const entry: FileEntry = {
          name,
          path: "/" + p.segments.join("/"),
          isDirectory: true,
          mtime: undefined,
          kind: "folder",
          size: 0,
        };
        pushItem(result.categories.empty_folders, {
          id: idFor(parent, name),
          parent,
          entry,
          reason: "Dossier vide",
        });
      }

      // Track directory + archive names for the extracted-archives heuristic.
      const dirNames = new Set(
        visibleEntries.filter((e) => e.isDirectory).map((e) => e.name.toLowerCase()),
      );

      for (const e of visibleEntries) {
        if (e.isDirectory) {
          if (SKIP_NAMES.has(e.name)) continue;
          queue.push({ rootId: p.rootId, segments: [...p.segments, e.name] });
          continue;
        }
        result.scannedFiles += 1;
        const size = e.size ?? 0;
        const ext = extOf(e.name) ?? "";
        const item: CleanItem = {
          id: idFor(p, e.name),
          parent: p,
          entry: e,
          reason: "",
        };
        const parentPathLower = p.segments.map((s) => s.toLowerCase());

        // Large files.
        if (size >= LARGE_FILE_BYTES) {
          pushItem(result.categories.large, {
            ...item,
            reason: "Fichier de plus de 100 Mo",
          });
        }

        // Old downloads.
        if (
          p.rootId === "downloads" ||
          parentPathLower.some((s) => s === "download" || s === "downloads")
        ) {
          if (daysAgo(e.mtime) >= OLD_DOWNLOAD_DAYS) {
            pushItem(result.categories.old_downloads, {
              ...item,
              reason: `Non modifié depuis ${Math.round(daysAgo(e.mtime))} jours`,
            });
          }
        }

        // Temp / cache files.
        if (
          TEMP_EXTS.has(ext) ||
          e.name.endsWith("~") ||
          parentPathLower.some((s) => s === "cache" || s === ".thumbnails")
        ) {
          pushItem(result.categories.temp, {
            ...item,
            reason: `Fichier temporaire${ext ? ` .${ext}` : ""}`,
          });
        }

        // APK unused.
        if (ext === "apk" && daysAgo(e.mtime) >= OLD_APK_DAYS) {
          pushItem(result.categories.apk, {
            ...item,
            reason: `Installateur (${Math.round(daysAgo(e.mtime))} jours)`,
          });
        }

        // Messaging media.
        if (
          size >= MESSAGING_MEDIA_MIN_BYTES &&
          pathHasMessagingKey(p.segments) &&
          ["image", "video", "audio"].includes(kindOf(e.name, false))
        ) {
          pushItem(result.categories.messaging_media, {
            ...item,
            reason: "Média téléchargé par une messagerie",
          });
        }

        // Extracted archives — archive whose sibling folder shares its base name.
        if (ARCHIVE_EXTS.has(ext)) {
          const base = e.name.slice(0, -(ext.length + 1)).toLowerCase();
          if (base && dirNames.has(base)) {
            pushItem(result.categories.extracted_archives, {
              ...item,
              reason: `Dossier « ${base} » déjà présent à côté`,
            });
          }
        }

        // Duplicate bucketing (heuristic: size + normalised name).
        if (size >= DUP_MIN_BYTES) {
          const bucketKey = `${size}::${normName(e.name)}`;
          const arr = dupBuckets.get(bucketKey) ?? [];
          arr.push(item);
          dupBuckets.set(bucketKey, arr);
        }
      }

      step += 1;
      if (step % 6 === 0) {
        onProgress({
          ...result,
          categories: { ...result.categories },
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Finalise duplicates: keep clusters with 2+ entries, drop first as "keeper".
    if (!cancelled) {
      for (const [gid, arr] of dupBuckets) {
        if (arr.length < 2) continue;
        // First entry is preserved — the rest are proposed for cleanup.
        for (let i = 1; i < arr.length; i++) {
          const it = arr[i];
          pushItem(result.categories.duplicates, {
            ...it,
            group: gid,
            reason: `Copie de « ${arr[0].entry.name} »`,
          });
        }
      }
    }

    // Totals.
    let items = 0;
    let bytes = 0;
    for (const c of Object.values(result.categories)) {
      items += c.items.length;
      bytes += c.bytes;
    }
    result.totalItems = items;
    result.totalBytes = bytes;
    result.done = !cancelled;
    result.cancelled = cancelled;
    onDone(result);
  })().catch(() => {
    result.done = true;
    onDone(result);
  });

  return handle;
}
