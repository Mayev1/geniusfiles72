/**
 * Sélecteur de fichiers historique.
 *
 * Ce composant est un simple adaptateur vers {@link ExplorerPicker}, le
 * MODE SÉLECTION de GeniusFiles : accueil, stockages, catégories,
 * dossiers, fichiers récents, recherche, tri, vue liste/grille et
 * sélection multiple persistante.
 *
 * L'API publique est inchangée, donc tous les appelants (outils PDF,
 * automatisations, coffre-fort) profitent du nouveau parcours sans
 * modification.
 */
import { ExplorerPicker, type PickAccept } from "@/components/files/ExplorerPicker";
import type { FileEntry } from "@/lib/files/types";

export function FileSourcePicker({
  open,
  title,
  extensions,
  multi,
  accept,
  apps,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** Extensions minuscules sans point, ex. ["pdf"]. */
  extensions: string[];
  multi: boolean;
  /** Types acceptés par la fonctionnalité appelante (défaut : fichiers). */
  accept?: PickAccept;
  /** Autorise la sélection d'applications installées. */
  apps?: boolean;
  onCancel: () => void;
  onConfirm: (paths: string[], entries: FileEntry[]) => void;
}) {
  return (
    <ExplorerPicker
      open={open}
      title={title}
      extensions={extensions}
      multi={multi}
      accept={accept}
      apps={apps}
      onCancel={onCancel}
      onConfirm={(paths, entries) => onConfirm(paths, entries)}
    />
  );
}
