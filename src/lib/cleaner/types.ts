/**
 * Type contracts for the Nettoyeur intelligent (Smart Cleaner) module.
 *
 * A "clean item" is any file or folder that a scanner has proposed for
 * removal. Items always carry their parent `PathRef` and a fully-formed
 * `FileEntry`, so the same delete pipeline (`deleteEntries`) can act on
 * them — the cleaner deliberately reuses the validated soft-delete path
 * used by the rest of the app (moves to Trash on Android, mock removal
 * on the web preview). Nothing is ever hard-deleted.
 */
import type { FileEntry, PathRef } from "@/lib/files/types";

export type CleanCategoryKey =
  | "duplicates"
  | "large"
  | "old_downloads"
  | "empty_folders"
  | "temp"
  | "extracted_archives"
  | "apk"
  | "messaging_media";

export type CleanItem = {
  /** Stable identity — absolute path when native, PathRef-derived on web. */
  id: string;
  parent: PathRef;
  entry: FileEntry;
  /** Human explanation shown next to the item. */
  reason: string;
  /** Optional group identifier (e.g. duplicate cluster id). */
  group?: string;
};

export type CleanCategory = {
  key: CleanCategoryKey;
  label: string;
  /** One-sentence explanation shown in the category card. */
  description: string;
  items: CleanItem[];
  /** Total recoverable bytes if EVERY item were removed. */
  bytes: number;
};

export type CleanScanResult = {
  categories: Record<CleanCategoryKey, CleanCategory>;
  totalItems: number;
  totalBytes: number;
  scannedFolders: number;
  scannedFiles: number;
  done: boolean;
  cancelled: boolean;
};

export type CleanScanHandle = {
  cancel: () => void;
};
