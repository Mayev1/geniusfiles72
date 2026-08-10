/**
 * Sélecteur du module Transfert.
 *
 * Adaptateur sur {@link ExplorerPicker} (MODE SÉLECTION de GeniusFiles) :
 * fichiers, dossiers ET applications installées peuvent être envoyés.
 * Pour une application, l'élément transféré est son APK réel
 * (`sourceDir`), lu par le moteur de transfert comme n'importe quel
 * fichier.
 */
import { ExplorerPicker } from "@/components/files/ExplorerPicker";
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
    <ExplorerPicker
      open={open}
      title="Choisir des éléments à envoyer"
      extensions={[]}
      multi
      accept="both"
      apps
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
