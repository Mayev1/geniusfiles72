/**
 * Formats réellement éditables.
 *
 * L'export repose sur le pipeline natif Android (MediaExtractor →
 * MediaCodec → MediaMuxer). Ce pipeline ne sait démuxer que certains
 * conteneurs : tout le reste doit être refusé *clairement* plutôt que de
 * laisser croire à un montage possible qui échouerait à l'export.
 */
import { extOf } from "@/lib/files/format";
import type { FileEntry } from "@/lib/files/types";
import { isAndroidNative } from "@/lib/native/geniusfiles-native";

/** Conteneurs pris en charge par MediaExtractor / MediaMuxer. */
const EDITABLE_EXTS = new Set(["mp4", "m4v", "mov", "3gp", "3g2", "mkv", "webm", "ts"]);

export function isEditableVideo(entry: FileEntry): boolean {
  if (entry.isDirectory) return false;
  if (entry.kind !== "video") return false;
  return EDITABLE_EXTS.has(extOf(entry.name) ?? "");
}

export type EditabilityReport =
  | { editable: true }
  | { editable: false; reason: string; hint?: string };

export function inspectEditability(entry: FileEntry): EditabilityReport {
  if (entry.kind !== "video") {
    return { editable: false, reason: "Ce fichier n'est pas une vidéo." };
  }
  if (!EDITABLE_EXTS.has(extOf(entry.name) ?? "")) {
    return {
      editable: false,
      reason: `Le format « ${(extOf(entry.name) ?? "inconnu").toUpperCase()} » ne peut pas être réencodé sur cet appareil.`,
      hint: "Les formats MP4, MOV, MKV, WEBM, 3GP et TS sont pris en charge.",
    };
  }
  return { editable: true };
}

/**
 * L'export réel n'existe que dans l'application Android : le navigateur
 * n'a pas de codec matériel accessible. Hors Android, l'éditeur reste
 * consultable mais l'export est explicitement indisponible — jamais simulé.
 */
export function canExportHere(): boolean {
  return isAndroidNative();
}
