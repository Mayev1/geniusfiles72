import type { FileEntry, PathRef } from "@/lib/files/types";
import { entryKey } from "@/lib/viewer/source";
import { getResume } from "@/lib/viewer/resume";

/**
 * Paramètres de recherche pour la route `/editeur-video`.
 *
 * Un seul constructeur pour tous les points d'entrée (menu contextuel du
 * gestionnaire, catégories, fichiers récents, lecteur vidéo) : l'éditeur
 * reçoit toujours directement le fichier, jamais un sélecteur intermédiaire.
 * `t` transporte la position de lecture en cours quand l'utilisateur vient
 * du lecteur, pour ne pas lui faire perdre son repère.
 */
export function videoEditorSearch(parent: PathRef, entry: FileEntry, atSeconds?: number) {
  return {
    root: parent.rootId,
    dir: parent.segments.join("/"),
    name: entry.name,
    t: atSeconds && Number.isFinite(atSeconds) && atSeconds > 0 ? Math.floor(atSeconds * 1000) : 0,
  };
}

/**
 * Entrée depuis le lecteur : la position réellement atteinte pendant la
 * lecture (déjà persistée par le lecteur) est reprise dans l'éditeur, pour
 * que l'utilisateur retrouve exactement l'image qu'il regardait.
 */
export function videoEditorSearchResuming(parent: PathRef, entry: FileEntry) {
  const resume = getResume(entryKey(parent, entry));
  return videoEditorSearch(parent, entry, resume?.pos);
}
