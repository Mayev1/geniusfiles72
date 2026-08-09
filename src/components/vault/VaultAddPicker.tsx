/**
 * Coffre-fort — picker to select files AND folders from the public
 * storage tree that will be moved into the vault. Any file type is
 * accepted; the built-in `FileSourcePicker` filters by extension, so
 * we ship this dedicated variant.
 */
import { ArrowLeft, Check, ChevronRight, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { BottomSheet, PrimaryButton } from "@/components/files/BottomSheet";
import { FileIcon } from "@/components/files/FileIcon";
import { listDirectory } from "@/lib/files/fs";
import { useRoots } from "@/lib/fs/useRoots";
import type { FileEntry, PathRef } from "@/lib/files/types";
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
  const [path, setPath] = useState<PathRef | null>(null);
  const { roots } = useRoots();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Record<string, PublicSource>>({});

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

  const keyOf = (parent: PathRef, name: string) =>
    `${parent.rootId}:${parent.segments.join("/")}/${name}`;

  const toggle = (parent: PathRef, entry: FileEntry) => {
    const key = keyOf(parent, entry.name);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = {
          parent,
          name: entry.name,
          isDirectory: entry.isDirectory,
          size: entry.size ?? 0,
        };
      }
      return next;
    });
  };

  const count = Object.keys(selected).length;

  const confirm = () => {
    onConfirm(Object.values(selected));
  };

  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title="Ajouter au coffre-fort"
      footer={
        <>
          <PrimaryButton variant="ghost" onClick={onCancel}>
            Annuler
          </PrimaryButton>
          <PrimaryButton onClick={confirm} disabled={count === 0}>
            Protéger ({count})
          </PrimaryButton>
        </>
      }
    >
      <div className="mb-2 flex items-center gap-1 overflow-x-auto text-[11px] text-muted-foreground">
        {path ? (
          <button
            type="button"
            onClick={() =>
              path.segments.length
                ? setPath({ rootId: path.rootId, segments: path.segments.slice(0, -1) })
                : setPath(null)
            }
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Retour
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setPath(null)}
          className="rounded px-1.5 py-0.5 hover:text-foreground"
        >
          Emplacements
        </button>
        {path ? (
          <>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {roots.find((r) => r.id === path.rootId)?.label} /{path.segments.join("/")}
            </span>
          </>
        ) : null}
      </div>

      <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-border">
        {!path ? (
          <ul className="divide-y divide-border">
            {roots
              .filter((r) => r.available)
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setPath({ rootId: r.id, segments: [] })}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/40"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <HardDrive className="h-4 w-4" />
                    </span>
                    <span className="flex-1 truncate text-[13px] font-medium">{r.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
                  </button>
                </li>
              ))}
          </ul>
        ) : loading ? (
          <div className="py-6 text-center text-[12px] text-muted-foreground">Chargement…</div>
        ) : entries.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-muted-foreground">Dossier vide.</div>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => {
              const key = keyOf(path, e.name);
              const isSelected = !!selected[key];
              return (
                <li key={e.name}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => toggle(path, e)}
                      className={`flex flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-secondary/40 ${
                        isSelected ? "bg-primary/10" : ""
                      }`}
                    >
                      <FileIcon kind={e.kind} path={e.path} />
                      <span className="flex-1 truncate text-[13px]">{e.name}</span>
                      {isSelected ? <Check className="h-4 w-4 text-primary" /> : null}
                    </button>
                    {e.isDirectory && !isSelected ? (
                      <button
                        type="button"
                        aria-label="Ouvrir"
                        onClick={() =>
                          setPath({
                            rootId: path.rootId,
                            segments: [...path.segments, e.name],
                          })
                        }
                        className="px-2 py-2 text-muted-foreground/70 hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">
        Les éléments sélectionnés seront déplacés dans un espace privé et n'apparaîtront plus dans
        les autres sections tant qu'ils resteront protégés.
      </p>
    </BottomSheet>
  );
}
