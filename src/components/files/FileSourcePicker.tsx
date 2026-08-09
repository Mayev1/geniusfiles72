/**
 * Sélecteur de fichiers historique.
 *
 * L'ancien mini-menu a été supprimé : ce composant est désormais un
 * simple adaptateur vers {@link ExplorerPicker}, le véritable explorateur
 * GeniusFiles plein écran (catégories indexées, navigation dossiers,
 * recherche, grille/liste, aperçu, sélection multiple).
 *
 * L'API publique est inchangée, donc tous les appelants (outils PDF,
 * automatisations, coffre-fort) profitent du nouveau parcours sans
 * modification.
 */
import { ExplorerPicker } from "@/components/files/ExplorerPicker";
import type { FileEntry } from "@/lib/files/types";

export function FileSourcePicker({
  open,
  title,
  extensions,
  multi,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** Extensions minuscules sans point, ex. ["pdf"]. */
  extensions: string[];
  multi: boolean;
  onCancel: () => void;
  onConfirm: (paths: string[], entries: FileEntry[]) => void;
}) {
  return (
    <ExplorerPicker
      open={open}
      title={title}
      extensions={extensions}
      multi={multi}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
