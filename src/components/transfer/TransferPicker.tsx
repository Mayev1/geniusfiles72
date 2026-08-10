/**
 * Sélection d'éléments à envoyer (module Transfert).
 *
 * Aucune interface propre : la sélection se fait dans l'interface
 * officielle de GeniusFiles (voir {@link FileSourcePicker}), fichiers et
 * dossiers confondus.
 */
import { FileSourcePicker } from "@/components/files/FileSourcePicker";
import type { FileEntry } from "@/lib/files/types";

export type PickedItem = {
  entry: FileEntry;
  /** Chemin absolu. */
  absolutePath: string;
  /** Chemin relatif conservé pour la destination. */
  relPath: string;
};

export function TransferPicker({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (items: PickedItem[]) => void;
}) {
  return (
    <FileSourcePicker
      open={open}
      extensions={[]}
      multi
      accept="both"
      onCancel={onCancel}
      onConfirm={(_paths, _entries, details) => {
        onConfirm(
          details.map((d) => ({
            entry: d.entry,
            absolutePath: d.absolutePath,
            relPath: d.entry.name,
          })),
        );
      }}
    />
  );
}
