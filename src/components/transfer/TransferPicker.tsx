/**
 * Sélecteur de fichiers dédié au module Transfert.
 *
 * — Multi-sélection de fichiers ET de dossiers.
 * — Navigation dans les mêmes racines de stockage que le gestionnaire.
 * — Un bouton « Valider » unique confirme la sélection.
 *
 * Aucune donnée de démonstration : les entrées sont lues via `listDirectory`
 * (natif Android ou preview web). Rien n'est simulé.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Folder, HardDrive, Loader2 } from "lucide-react";
import { BottomSheet, PrimaryButton } from "@/components/files/BottomSheet";
import { FileIcon } from "@/components/files/FileIcon";
import { formatSize } from "@/lib/files/format";
import { listDirectory, toAbsolutePath } from "@/lib/files/fs";
import { useRoots } from "@/lib/fs/useRoots";
import type { FileEntry, PathRef, StorageRoot } from "@/lib/files/types";

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
  const [path, setPath] = useState<PathRef | null>(null);
  const { available: roots } = useRoots();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Record<string, PickedItem>>({});

  useEffect(() => {
    if (open) {
      setPath(null);
      setSelected({});
    }
  }, [open]);

  useEffect(() => {
    if (!open || !path) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listDirectory(path).then((res) => {
      if (cancelled) return;
      setLoading(false);
      setEntries(res.ok ? res.entries : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  const chooseRoot = (r: StorageRoot) => setPath({ rootId: r.id, segments: [] });
  const goUp = () => {
    if (!path) return;
    if (path.segments.length === 0) setPath(null);
    else setPath({ rootId: path.rootId, segments: path.segments.slice(0, -1) });
  };
  const enter = (name: string) => {
    if (!path) return;
    setPath({ rootId: path.rootId, segments: [...path.segments, name] });
  };

  const toggle = (e: FileEntry) => {
    if (!path) return;
    const abs = toAbsolutePath({ rootId: path.rootId, segments: [...path.segments, e.name] });
    setSelected((prev) => {
      const next = { ...prev };
      if (next[abs]) delete next[abs];
      else next[abs] = { entry: e, absolutePath: abs, relPath: e.name };
      return next;
    });
  };

  const count = Object.keys(selected).length;
  const folderCount = Object.values(selected).filter((it) => it.entry.isDirectory).length;
  const fileCount = count - folderCount;
  const totalBytes = Object.values(selected).reduce(
    (s, it) => s + (it.entry.isDirectory ? 0 : (it.entry.size ?? 0)),
    0,
  );

  const title = path
    ? path.segments.length
      ? path.segments[path.segments.length - 1]
      : (roots.find((r) => r.id === path.rootId)?.label ?? "Dossier")
    : "Choisir des fichiers";

  const summary =
    count === 0
      ? "Appuyez sur les éléments à envoyer"
      : [
          fileCount > 0 ? `${fileCount} fichier${fileCount > 1 ? "s" : ""}` : null,
          folderCount > 0 ? `${folderCount} dossier${folderCount > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ") + ` · ${formatSize(totalBytes)}`;

  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">{summary}</div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Annuler
            </button>
            <PrimaryButton
              onClick={() => onConfirm(Object.values(selected))}
              disabled={count === 0}
            >
              Valider
            </PrimaryButton>
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        {path ? (
          <button
            onClick={goUp}
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Revenir
          </button>
        ) : null}

        {!path ? (
          <ul className="space-y-1.5">
            {roots.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => chooseRoot(r)}
                  className="card-surface flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-primary">
                    <HardDrive className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.label}</p>
                    {r.hint ? (
                      <p className="truncate text-[11px] text-muted-foreground">{r.hint}</p>
                    ) : null}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-muted-foreground">Dossier vide.</p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {entries
              .slice()
              .sort((a, b) =>
                a.isDirectory === b.isDirectory
                  ? a.name.localeCompare(b.name)
                  : a.isDirectory
                    ? -1
                    : 1,
              )
              .map((e) => {
                const abs = toAbsolutePath({
                  rootId: path.rootId,
                  segments: [...path.segments, e.name],
                });
                const isSel = !!selected[abs];
                return (
                  <li key={abs}>
                    <div
                      className={`flex items-center gap-3 rounded-xl border p-2.5 transition-colors ${
                        isSel ? "border-primary/50 bg-primary/5" : "border-transparent"
                      }`}
                    >
                      <button
                        onClick={() => toggle(e)}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                          isSel
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40"
                        }`}
                        aria-label={isSel ? "Désélectionner" : "Sélectionner"}
                      >
                        {isSel ? <Check className="h-3.5 w-3.5" /> : null}
                      </button>
                      <button
                        onClick={() => (e.isDirectory ? enter(e.name) : toggle(e))}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        {e.isDirectory ? (
                          <span className="flex h-11 w-11 items-center justify-center rounded-[4px] bg-accent">
                            <Folder className="h-5 w-5 text-primary" />
                          </span>
                        ) : (
                          <FileIcon kind={e.kind} path={e.path} size="sm" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{e.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {e.isDirectory ? "Dossier" : formatSize(e.size ?? 0)}
                          </p>
                        </div>
                        {e.isDirectory ? (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : null}
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
