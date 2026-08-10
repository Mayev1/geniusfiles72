/**
 * Coffre-fort — sélection des fichiers ET dossiers à déplacer dans le
 * coffre.
 *
 * Adaptateur sur {@link ExplorerPicker} : l'utilisateur reste dans le
 * MODE SÉLECTION de GeniusFiles (stockages, catégories, dossiers,
 * récents, recherche, tri) au lieu d'un mini-explorateur isolé.
 */
import { ExplorerPicker } from "@/components/files/ExplorerPicker";
import type { PublicSource } from "@/lib/vault/types";

export function VaultAddPicker({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (sources: PublicSource[]) => void;
}) {
  return (
    <ExplorerPicker
      open={open}
      title="Ajouter au coffre-fort"
      extensions={[]}
      multi
      accept="both"
      onCancel={onCancel}
      onConfirm={(_paths, _entries, details) => {
        const sources: PublicSource[] = [];
        for (const d of details) {
          if (!d.parent) continue;
          sources.push({
            parent: d.parent,
            name: d.entry.name,
            isDirectory: d.entry.isDirectory,
            size: d.entry.size ?? 0,
          });
        }
        onConfirm(sources);
      }}
    />
  );
}
