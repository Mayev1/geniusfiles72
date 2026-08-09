/**
 * Libellés « fichiers / dossiers / éléments ».
 *
 * Une opération portant sur deux dossiers ne doit jamais annoncer « 2
 * fichiers » : on distingue les trois cas (que des fichiers, que des
 * dossiers, mélange).
 */
import type { FileEntry } from "./types";

export type CountUnit = "fichier" | "dossier" | "élément";

export function unitFor(entries: readonly { isDirectory?: boolean }[]): CountUnit {
  if (entries.length === 0) return "élément";
  const dirs = entries.filter((e) => e.isDirectory).length;
  if (dirs === 0) return "fichier";
  if (dirs === entries.length) return "dossier";
  return "élément";
}

/** « 18 fichiers », « 2 dossiers », « 12 éléments », « 1 dossier ». */
export function describeEntries(entries: readonly FileEntry[]): string {
  const unit = unitFor(entries);
  const n = entries.length;
  return `${n} ${unit}${n > 1 ? "s" : ""}`;
}
