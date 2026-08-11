import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileArchive,
  Folder,
  FolderOutput,
  KeyRound,
  Lock,
  Package,
} from "lucide-react";
import type { FileEntry, PathRef } from "@/lib/files/types";
import {
  type ArchiveCapabilities,
  type ArchiveFormat,
  type ArchiveListing,
  type ArchiveNode,
  type ConflictPolicy,
  CREATE_FORMATS,
} from "@/lib/files/archive";
import { formatDate, formatSize, pathToString } from "@/lib/files/format";
import { useRoots } from "@/lib/fs/useRoots";
import { BottomSheet, PrimaryButton, TextField } from "./BottomSheet";
import { DestinationPicker } from "./DestinationPicker";
import { FileIcon } from "./FileIcon";

/* ============================================================== */
/*  Create archive sheet                                          */
/* ============================================================== */

export function ArchiveCreateSheet({
  open,
  parent,
  entries,
  caps,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  parent: PathRef | null;
  entries: FileEntry[];
  caps: ArchiveCapabilities | null;
  onCancel: () => void;
  onSubmit: (opts: {
    destination: PathRef;
    archiveName: string;
    format: ArchiveFormat;
    level: number;
    password?: string;
  }) => Promise<void> | void;
}) {
  const { roots } = useRoots();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<ArchiveFormat>("zip");
  const [level, setLevel] = useState(6);
  const [password, setPassword] = useState("");
  const [destination, setDestination] = useState<PathRef | null>(parent);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDestination(parent);
    setLevel(6);
    setPassword("");
    setFormat("zip");
    setBusy(false);
    // Suggest a name.
    const suggested =
      entries.length === 1
        ? entries[0].name.replace(/\.[^.]+$/, "")
        : (parent?.segments[parent.segments.length - 1] ?? "archive");
    setName(suggested || "archive");
  }, [open, parent, entries]);

  const canCreate =
    caps?.supportedCreate.includes(format) ??
    (CREATE_FORMATS as readonly string[]).includes(format);
  const submit = async () => {
    if (busy || !destination || !name.trim()) return;
    setBusy(true);
    await onSubmit({
      destination,
      archiveName: name.trim(),
      format,
      level,
      password: password.trim() || undefined,
    });
    setBusy(false);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title="Créer une archive"
      footer={
        <>
          <PrimaryButton variant="ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </PrimaryButton>
          <PrimaryButton
            onClick={submit}
            disabled={busy || !destination || !name.trim() || !canCreate}
          >
            {busy ? "Création…" : "Créer"}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            {entries.length === 1
              ? `1 élément sélectionné`
              : `${entries.length} éléments sélectionnés`}
          </label>
          <div className="card-surface flex flex-wrap gap-1 px-2 py-1.5">
            {entries.slice(0, 4).map((e) => (
              <span
                key={e.name}
                className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[11px]"
              >
                <FileIcon kind={e.kind} path={e.path} />
                <span className="max-w-[110px] truncate">{e.name}</span>
              </span>
            ))}
            {entries.length > 4 ? (
              <span className="text-[11px] text-muted-foreground">
                +{entries.length - 4} autre(s)
              </span>
            ) : null}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Nom de l'archive
          </label>
          <div className="flex items-center gap-2">
            <TextField value={name} onChange={setName} placeholder="mon-archive" />
            <span className="rounded-lg border border-border bg-surface px-2 py-2 text-[12px] text-muted-foreground">
              .{format}
            </span>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Format
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["zip"] as ArchiveFormat[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors ${
                  format === f
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Niveau de compression</span>
            <span className="font-mono text-foreground">{level}</span>
          </div>
          <input
            type="range"
            min={0}
            max={9}
            step={1}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/80">
            <span>Rapide (0)</span>
            <span>Équilibré (6)</span>
            <span>Maximum (9)</span>
          </div>
        </div>

        {caps?.passwordSupported ? (
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <KeyRound className="h-3 w-3" /> Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Facultatif"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
            />
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Emplacement
          </label>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="card-surface flex w-full items-center gap-2 px-2.5 py-2 text-left"
          >
            <FolderOutput className="h-4 w-4 text-primary" />
            <span className="flex-1 truncate text-[12px] text-foreground">
              {destination ? pathToString(destination, roots) : "Choisir un dossier"}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <DestinationPicker
        open={pickerOpen}
        title="Enregistrer dans…"
        initial={destination}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(d) => {
          setDestination(d);
          setPickerOpen(false);
        }}
      />
    </BottomSheet>
  );
}

/* ============================================================== */
/*  Archive viewer sheet                                          */
/* ============================================================== */

export function ArchiveViewerSheet({
  open,
  entry,
  listing,
  loading,
  onClose,
  onExtractAll,
  onExtractSelection,
  onRename,
  onShare,
  onDelete,
}: {
  open: boolean;
  entry: FileEntry | null;
  listing: ArchiveListing | null;
  loading: boolean;
  onClose: () => void;
  onExtractAll: () => void;
  onExtractSelection: (paths: string[]) => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setExpanded(new Set([""]));
    }
  }, [open, listing]);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Selecting a folder selects all descendants.
  const applyFolderSelect = (node: ArchiveNode, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const walk = (n: ArchiveNode) => {
        if (!n.isDirectory) {
          if (on) next.add(n.path);
          else next.delete(n.path);
        } else {
          for (const c of n.children ?? []) walk(c);
        }
      };
      walk(node);
      return next;
    });
  };

  const info = listing;

  return (
    <BottomSheet
      open={open && !!entry}
      onClose={onClose}
      title={entry ? entry.name : ""}
      footer={
        <>
          <PrimaryButton variant="ghost" onClick={onClose}>
            Fermer
          </PrimaryButton>
          {selected.size > 0 ? (
            <PrimaryButton onClick={() => onExtractSelection([...selected])}>
              Extraire ({selected.size})
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onExtractAll}>Tout extraire</PrimaryButton>
          )}
        </>
      }
    >
      {info ? (
        <div className="mb-2 grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
          <Info
            label="Format"
            value={archiveFormatLabel(entry?.name ?? "", info.format)}
          />
          <Info label="Taille" value={formatSize(info.archiveSize)} />
          <Info label="Fichiers" value={String(info.fileCount)} />
          <Info label="Dossiers" value={String(info.dirCount)} />
          <Info label="Non compressé" value={formatSize(info.totalUncompressed)} />
          <Info label="Modifié" value={formatDate(info.mtime)} />
        </div>
      ) : null}

      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Contenu</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onRename}
            className="rounded border border-border px-1.5 py-0.5 hover:text-foreground"
          >
            Renommer
          </button>
          <button
            type="button"
            onClick={onShare}
            className="rounded border border-border px-1.5 py-0.5 hover:text-foreground"
          >
            Partager
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-border px-1.5 py-0.5 text-red-400 hover:brightness-110"
          >
            Supprimer
          </button>
        </div>
      </div>

      <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border bg-surface/50">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground">
            <FileArchive className="h-4 w-4 animate-pulse" /> Lecture de l'archive…
          </div>
        ) : info ? (
          <ArchiveTree
            node={info.tree}
            depth={0}
            expanded={expanded}
            selected={selected}
            toggleFolder={toggleFolder}
            toggle={toggle}
            applyFolderSelect={applyFolderSelect}
          />
        ) : (
          <div className="px-2 py-3 text-[12px] text-muted-foreground">Archive illisible.</div>
        )}
      </div>
    </BottomSheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/40 px-2 py-1">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/80">{label}</p>
      <p className="text-[12px] text-foreground">{value}</p>
    </div>
  );
}

function ArchiveTree({
  node,
  depth,
  expanded,
  selected,
  toggleFolder,
  toggle,
  applyFolderSelect,
}: {
  node: ArchiveNode;
  depth: number;
  expanded: Set<string>;
  selected: Set<string>;
  toggleFolder: (p: string) => void;
  toggle: (p: string) => void;
  applyFolderSelect: (n: ArchiveNode, on: boolean) => void;
}) {
  const rows: React.ReactElement[] = [];
  const walk = (n: ArchiveNode, d: number) => {
    if (n === node && n.path === "") {
      for (const c of n.children ?? []) walk(c, d);
      return;
    }
    if (n.isDirectory) {
      const isOpen = expanded.has(n.path);
      const allSelected =
        (n.children ?? []).length > 0 && collectFiles(n).every((p) => selected.has(p));
      rows.push(
        <div
          key={`d:${n.path}`}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] hover:bg-secondary/50"
          style={{ paddingLeft: 8 + d * 12 }}
        >
          <button
            type="button"
            onClick={() => toggleFolder(n.path)}
            className="text-muted-foreground"
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => applyFolderSelect(n, e.target.checked)}
            className="h-3 w-3 accent-primary"
          />
          <Folder className="h-3.5 w-3.5 text-primary" />
          <span className="flex-1 truncate">{n.name}</span>
        </div>,
      );
      if (isOpen) for (const c of n.children ?? []) walk(c, d + 1);
    } else {
      rows.push(
        <label
          key={`f:${n.path}`}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] hover:bg-secondary/50"
          style={{ paddingLeft: 8 + d * 12 + 18 }}
        >
          <input
            type="checkbox"
            checked={selected.has(n.path)}
            onChange={() => toggle(n.path)}
            className="h-3 w-3 accent-primary"
          />
          <FileIcon kind="other" />
          <span className="flex-1 truncate">{n.name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{formatSize(n.size)}</span>
        </label>,
      );
    }
  };
  walk(node, depth);
  return <>{rows}</>;
}

function collectFiles(n: ArchiveNode): string[] {
  if (!n.isDirectory) return [n.path];
  return (n.children ?? []).flatMap(collectFiles);
}

/* ============================================================== */
/*  Extract options sheet                                         */
/* ============================================================== */

export function ArchiveExtractSheet({
  open,
  entry,
  parent,
  initialDestination,
  selectionCount,
  caps,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  entry: FileEntry | null;
  parent: PathRef | null;
  initialDestination: PathRef | null;
  selectionCount: number;
  caps: ArchiveCapabilities | null;
  onCancel: () => void;
  onSubmit: (opts: {
    destination: PathRef;
    conflict: ConflictPolicy;
    password?: string;
  }) => void | Promise<void>;
}) {
  const { roots } = useRoots();
  const [destination, setDestination] = useState<PathRef | null>(initialDestination ?? parent);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictPolicy>("rename");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDestination(initialDestination ?? parent);
    setConflict("rename");
    setPassword("");
    setBusy(false);
  }, [open, initialDestination, parent]);

  const submit = async () => {
    if (busy || !destination) return;
    setBusy(true);
    await onSubmit({ destination, conflict, password: password.trim() || undefined });
    setBusy(false);
  };

  return (
    <BottomSheet
      open={open && !!entry}
      onClose={onCancel}
      title="Extraire l'archive"
      footer={
        <>
          <PrimaryButton variant="ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </PrimaryButton>
          <PrimaryButton onClick={submit} disabled={busy || !destination}>
            {busy ? "Extraction…" : "Extraire"}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-3">
        <div className="card-surface flex items-center gap-2 px-2.5 py-2">
          <Package className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium">{entry?.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {selectionCount > 0
                ? `${selectionCount} élément(s) sélectionné(s)`
                : "Tout le contenu"}
            </p>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Dossier de destination
          </label>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="card-surface flex w-full items-center gap-2 px-2.5 py-2 text-left"
          >
            <FolderOutput className="h-4 w-4 text-primary" />
            <span className="flex-1 truncate text-[12px]">
              {destination ? pathToString(destination, roots) : "Choisir un dossier"}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            En cas de conflit
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <ConflictOption
              label="Renommer auto"
              hint="Ajouter un suffixe"
              active={conflict === "rename"}
              onSelect={() => setConflict("rename")}
            />
            <ConflictOption
              label="Conserver les deux"
              hint="Garder l'ancien et le nouveau"
              active={conflict === "keepBoth"}
              onSelect={() => setConflict("keepBoth")}
            />
            <ConflictOption
              label="Remplacer"
              hint="Écraser les fichiers existants"
              active={conflict === "replace"}
              onSelect={() => setConflict("replace")}
            />
            <ConflictOption
              label="Ignorer"
              hint="Ne pas extraire les doublons"
              active={conflict === "skip"}
              onSelect={() => setConflict("skip")}
            />
          </div>
        </div>

        {caps?.passwordSupported ? (
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" /> Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Requis si l'archive est chiffrée"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
            />
          </div>
        ) : null}
      </div>

      <DestinationPicker
        open={pickerOpen}
        title="Extraire dans…"
        initial={destination}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(d) => {
          setDestination(d);
          setPickerOpen(false);
        }}
      />
    </BottomSheet>
  );
}

function ConflictOption({
  label,
  hint,
  active,
  onSelect,
}: {
  label: string;
  hint: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
        active ? "border-primary bg-primary/12" : "border-border bg-surface hover:border-primary/40"
      }`}
    >
      <p className="text-[12px] font-medium text-foreground">{label}</p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </button>
  );
}
