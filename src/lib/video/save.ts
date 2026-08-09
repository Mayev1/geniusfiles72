/**
 * Enregistrement d'un export vidéo.
 *
 * Deux politiques explicites, comme pour les photos : créer un nouveau
 * fichier à côté de l'original (choix par défaut, jamais destructif), ou
 * remplacer l'original après confirmation. Dans les deux cas, l'encodage
 * se fait d'abord ailleurs : l'original n'est touché qu'une fois le
 * résultat complet.
 */
import type { FileEntry, PathRef } from "@/lib/files/types";
import { toAbsolutePath } from "@/lib/files/fs";
import type { VideoEdit } from "@/lib/video/edit";
import { startVideoExport, type ExportHandle } from "./export";

export type SaveMode = "new" | "replace";

export function trimmedName(original: string): string {
  const dot = original.lastIndexOf(".");
  const base = dot > 0 ? original.slice(0, dot) : original;
  return `${base}-modifie.mp4`;
}

export function replacementName(original: string): string {
  const dot = original.lastIndexOf(".");
  const base = dot > 0 ? original.slice(0, dot) : original;
  const ext = dot > 0 ? original.slice(dot + 1).toLowerCase() : "";
  // Le moteur écrit du MP4 : remplacer un MKV par du MP4 changerait
  // l'extension, ce qui serait mensonger. On garde alors un nouveau nom.
  return ext === "mp4" || ext === "m4v" ? original : `${base}.mp4`;
}

export function saveVideoExport(options: {
  parent: PathRef;
  entry: FileEntry;
  /** Montage : portions conservées, concaténées dans cet ordre. */
  segments: Array<{ startMs: number; endMs: number }>;
  exact: boolean;
  /** Transformations image et son (étapes 5 et 6). */
  edit?: VideoEdit;
  mode: SaveMode;
  onProgress?: (p: number) => void;
}): ExportHandle {
  const { parent, entry, segments, exact, edit, mode, onProgress } = options;
  const dir = toAbsolutePath(parent);
  const name = mode === "replace" ? replacementName(entry.name) : trimmedName(entry.name);
  return startVideoExport(
    {
      path: `${dir}/${entry.name}`,
      outputDir: dir,
      outputName: name,
      segments,
      // Un montage en plusieurs morceaux ne peut pas être raccordé sans
      // réencodage : on le demande explicitement plutôt que d'échouer.
      exact: exact || segments.length > 1,
      overwrite: mode === "replace",
      edit,
    },
    onProgress,
  );
}
