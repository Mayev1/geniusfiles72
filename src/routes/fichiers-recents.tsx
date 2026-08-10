/**
 * Page plein écran « Fichiers récents ».
 *
 * Affiche tous les fichiers utilisés durant les 48 dernières heures,
 * groupés par jour (Aujourd'hui / Hier), avec recherche instantanée et
 * exactement les mêmes actions que dans le gestionnaire de fichiers.
 * Les données proviennent du journal local : aucune analyse du stockage
 * n'est relancée, l'ouverture est instantanée.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Search, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { usePullToRefresh } from "@/lib/gestures/pull-refresh";
import { BackButton } from "@/components/navigation/BackButton";
import { BACK_PRIORITY, useBackHandler } from "@/lib/navigation/back-stack";
import { FileIcon } from "@/components/files/FileIcon";
import { EntryActionSheet, type EntryAction } from "@/components/files/EntryActionSheet";
import { ConfirmDialog, NamePrompt } from "@/components/files/BottomSheet";
import { DestinationPicker } from "@/components/files/DestinationPicker";
import { DetailsSheet } from "@/components/files/DetailsSheet";
import { ProgressDialog } from "@/components/files/ProgressDialog";
import { startTransfer, cancelTransfer } from "@/lib/transfers/manager";
import { useTransferTask } from "@/lib/transfers/useTransfers";
import { UniversalViewer, type ViewerAction } from "@/components/viewer/UniversalViewer";
import { canPreview } from "@/lib/viewer/kinds";
import { openWithSystem } from "@/lib/viewer/openWith";
import { audioEditorSearch } from "@/lib/audio/routes";
import { batchSummary, errorMessage } from "@/lib/errors/humanize";
import { confirmCopy, progressLabel } from "@/lib/copy";
import type { FileEntry, PathRef } from "@/lib/files/types";
import {
  createSignal,
  deleteEntries,
  readDetails,
  renameEntry,
  shareEntries,
  transferEntries,
  type DetailsInfo,
  type OperationSignal,
  type ProgressEvent,
} from "@/lib/files/operations";
import { formatRecentClock, groupRecents } from "@/lib/recents/store";
import {
  addedAbsPath,
  addedId,
  addedLocationLabel,
  loadAddedWindow,
  subscribeAdded,
  watchAddedFiles,
  type AddedFile,
} from "@/lib/recents/added";

export const Route = createFileRoute("/fichiers-recents")({
  head: () => ({
    meta: [
      { title: "Fichiers récents — GeniusFiles" },
      {
        name: "description",
        content:
          "Retrouvez en un instant tous les nouveaux fichiers ajoutés à votre stockage, groupés par jour.",
      },
      { property: "og:title", content: "Fichiers récents — GeniusFiles" },
      {
        property: "og:description",
        content: "Tous les nouveaux fichiers ajoutés à votre stockage, groupés par jour.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AddedFilesPage,
});

type Dialog =
  | { kind: "none" }
  | { kind: "actions"; entry: AddedFile }
  | { kind: "details"; info: DetailsInfo | null; loading: boolean; parent: PathRef }
  | { kind: "rename"; entry: AddedFile; parent: PathRef }
  | { kind: "confirmDelete"; items: AddedFile[] }
  | { kind: "picker"; mode: "copy" | "move"; items: AddedFile[] }
  | { kind: "viewer"; entryId: string };

function parentOf(f: AddedFile): PathRef {
  return { rootId: f.rootId, segments: f.folderSegments };
}

function AddedFilesPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<AddedFile[]>([]);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });

  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [progressTitle, setProgressTitle] = useState("");
  const [progressSubtitle, setProgressSubtitle] = useState("");
  const [progressOpen, setProgressOpen] = useState(false);
  const [transferTaskId, setTransferTaskId] = useState<string | null>(null);
  /* La tâche appartient au gestionnaire global : fermer la fenêtre
     (« Masquer ») n'interrompt ni ne ralentit le transfert. */
  const activeTransfer = useTransferTask(transferTaskId);
  const transferProgress: ProgressEvent | null = activeTransfer
    ? {
        completed: activeTransfer.completed,
        total: activeTransfer.total,
        bytes: activeTransfer.bytes,
        totalBytes: activeTransfer.totalBytes,
        currentName: activeTransfer.currentName ?? "",
        elapsedMs: Date.now() - activeTransfer.startedAt,
        etaMs: activeTransfer.etaMs,
      }
    : null;
  const hideTransferDialog = useCallback(() => {
    setProgressOpen(false);
    setTransferTaskId(null);
  }, []);
  useEffect(() => {
    if (activeTransfer && activeTransfer.status !== "running") {
      setProgressOpen(false);
      setTransferTaskId(null);
    }
  }, [activeTransfer]);

  /* Retour Android : recherche en cours → écran précédent. */
  useBackHandler(
    query.length > 0,
    () => {
      setQuery("");
      return true;
    },
    BACK_PRIORITY.mode,
  );
  const signalRef = useRef<(OperationSignal & { cancel: () => void }) | null>(null);

  useEffect(() => {
    const refresh = () => setFiles(loadAddedWindow());
    refresh();
    const unsubscribe = subscribeAdded(refresh);
    const stop = watchAddedFiles();
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) => f.name.toLowerCase().includes(q) || addedLocationLabel(f).toLowerCase().includes(q),
    );
  }, [files, query]);

  const groups = useMemo(() => groupRecents(filtered), [filtered]);

  const viewerEntries = useMemo(() => filtered.filter((f) => canPreview(f)), [filtered]);
  const viewerIndex = useMemo(() => {
    if (dialog.kind !== "viewer") return -1;
    return viewerEntries.findIndex((f) => addedId(f) === dialog.entryId);
  }, [dialog, viewerEntries]);

  const refreshAfterMutation = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gf:storage-changed"));
    }
  };

  const openEntry = useCallback((f: AddedFile) => {
    if (canPreview(f)) setDialog({ kind: "viewer", entryId: addedId(f) });
    else setDialog({ kind: "actions", entry: f });
  }, []);

  const doShare = useCallback(async (items: AddedFile[]) => {
    for (const f of items) {
      const r = await shareEntries(parentOf(f), [f]);
      if (!r.ok) toast.error(errorMessage(r.error, "Partage impossible"));
    }
  }, []);

  const doDelete = useCallback(async (items: AddedFile[]) => {
    let ok = 0;
    let failed = 0;
    for (const f of items) {
      const r = await deleteEntries(parentOf(f), [f]);
      ok += r.succeeded;
      failed += r.failed.length;
    }
    refreshAfterMutation();
    const s = batchSummary("déplacé(s) dans la Corbeille", ok, failed);
    if (s.ok) toast.success(s.message);
    else toast.error(s.message);
  }, []);

  const doTransfer = useCallback((mode: "copy" | "move", items: AddedFile[], dest: PathRef) => {
    const destLabel = dest.segments.length ? dest.segments.join(" / ") : "Racine du stockage";
    const id = startTransfer({
      mode,
      groups: items.map((f) => ({ parent: parentOf(f), entries: [f as FileEntry] })),
      destination: dest,
      onDone: (task) => {
        refreshAfterMutation();
        if (task.status === "cancelled") {
          toast.warning("Opération annulée");
          return;
        }
        const s = batchSummary(
          mode === "copy" ? "copié(s)" : "déplacé(s)",
          task.succeeded,
          task.failures.length,
        );
        if (s.ok) toast.success(s.message);
        else toast.error(s.message);
      },
    });
    setTransferTaskId(id);
    setProgressTitle(
      progressLabel(mode === "copy" ? "Copie" : "Déplacement", undefined, items.length),
    );
    setProgressSubtitle(`Vers « ${destLabel} »`);
    setProgressOpen(true);
  }, []);

  const doRename = useCallback(async (entry: FileEntry, parent: PathRef, newName: string) => {
    const r = await renameEntry(parent, entry, newName);
    if (r.ok) {
      toast.success("Renommé");
      refreshAfterMutation();
      return true;
    }
    toast.error(errorMessage(r.error, "Renommage impossible"));
    return false;
  }, []);

  const onEntryAction = useCallback(
    async (action: EntryAction) => {
      if (dialog.kind !== "actions") return;
      const f = dialog.entry;
      const parent = parentOf(f);
      setDialog({ kind: "none" });
      switch (action) {
        case "open":
          if (canPreview(f)) setDialog({ kind: "viewer", entryId: addedId(f) });
          else await openWithSystem(parent, f);
          break;
        case "openWith":
          await openWithSystem(parent, f);
          break;
        case "editAudio":
          await navigate({
            to: "/editeur-audio",
            search: audioEditorSearch(parent, f),
          });
          break;
        case "share":
          await doShare([f]);
          break;
        case "rename":
          setDialog({ kind: "rename", entry: f, parent });
          break;
        case "copy":
          setDialog({ kind: "picker", mode: "copy", items: [f] });
          break;
        case "move":
          setDialog({ kind: "picker", mode: "move", items: [f] });
          break;
        case "delete":
          setDialog({ kind: "confirmDelete", items: [f] });
          break;
        case "info": {
          setDialog({ kind: "details", info: null, loading: true, parent });
          const info = await readDetails(parent, f);
          setDialog({ kind: "details", info, loading: false, parent });
          break;
        }
        default:
          break;
      }
    },
    [dialog, doShare, navigate],
  );

  const onViewerAction = useCallback(
    async (entry: FileEntry, action: ViewerAction) => {
      const f = entry as AddedFile;
      const parent = parentOf(f);
      switch (action) {
        case "share":
          await doShare([f]);
          break;
        case "openWith":
          await openWithSystem(parent, f);
          break;
        case "rename":
          setDialog({ kind: "rename", entry: f, parent });
          break;
        case "copy":
          setDialog({ kind: "picker", mode: "copy", items: [f] });
          break;
        case "move":
          setDialog({ kind: "picker", mode: "move", items: [f] });
          break;
        case "delete":
          setDialog({ kind: "confirmDelete", items: [f] });
          break;
        case "info": {
          setDialog({ kind: "details", info: null, loading: true, parent });
          const info = await readDetails(parent, f);
          setDialog({ kind: "details", info, loading: false, parent });
          break;
        }
        default:
          break;
      }
    },
    [doShare],
  );

  return (
    <AppShell>
      <div className="mb-3 flex items-center gap-2">
        <BackButton />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold">Fichiers récents</h1>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Tous les nouveaux fichiers ajoutés à votre stockage ces derniers jours.
          </p>
        </div>
      </div>

      <div className="mb-4 flex h-11 items-center gap-2 rounded-2xl border border-border bg-surface px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher dans les fichiers récents"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          aria-label="Rechercher dans les fichiers récents"
        />
        {query ? (
          <button
            type="button"
            aria-label="Effacer"
            onClick={() => setQuery("")}
            className="rounded-full p-1 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Clock3 className="h-7 w-7" strokeWidth={1.8} />
          </span>
          <p className="text-[14px] font-medium">
            {query ? "Aucun résultat." : "Aucun fichier récent."}
          </p>
          <p className="max-w-[18rem] text-[12px] leading-snug text-muted-foreground">
            {query
              ? "Essayez un autre nom de fichier."
              : "Les nouveaux fichiers ajoutés à votre stockage apparaîtront ici."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 pb-8">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {g.label}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {g.files.map((f, i) => (
                  <li
                    key={addedId(f)}
                    className="gf-appear"
                    style={{
                      animationDelay: `${Math.min(i, 8) * 35}ms`,
                      animationFillMode: "backwards",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => openEntry(f)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setDialog({ kind: "actions", entry: f });
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-surface px-3.5 py-3 text-left shadow-[0_1px_6px_-6px_rgba(15,23,42,0.25)] transition-transform duration-150 active:scale-[0.985]"
                    >
                      <span className="w-11 shrink-0 text-[11.5px] font-medium tabular-nums text-muted-foreground">
                        {formatRecentClock(f.at)}
                      </span>
                      <FileIcon kind={f.kind} size="sm" path={addedAbsPath(f)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium leading-tight">
                          {f.name}
                        </span>
                        <span className="mt-1 block truncate text-[11.5px] text-muted-foreground">
                          {addedLocationLabel(f)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <EntryActionSheet
        open={dialog.kind === "actions"}
        entry={dialog.kind === "actions" ? dialog.entry : null}
        onClose={() => setDialog({ kind: "none" })}
        onAction={onEntryAction}
      />

      <NamePrompt
        open={dialog.kind === "rename"}
        title="Renommer"
        label="Nouveau nom"
        initial={dialog.kind === "rename" ? dialog.entry.name : ""}
        cta="Renommer"
        onCancel={() => setDialog({ kind: "none" })}
        onSubmit={async (name: string) => {
          if (dialog.kind !== "rename") return;
          const ok = await doRename(dialog.entry, dialog.parent, name);
          if (ok) setDialog({ kind: "none" });
        }}
      />

      <ConfirmDialog
        open={dialog.kind === "confirmDelete"}
        title={
          dialog.kind === "confirmDelete" ? confirmCopy.moveToTrash(dialog.items.length).title : ""
        }
        description={
          dialog.kind === "confirmDelete"
            ? confirmCopy.moveToTrash(dialog.items.length).description
            : ""
        }
        confirmLabel={
          dialog.kind === "confirmDelete"
            ? confirmCopy.moveToTrash(dialog.items.length).confirmLabel
            : ""
        }
        danger
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={async () => {
          if (dialog.kind !== "confirmDelete") return;
          const items = dialog.items;
          setDialog({ kind: "none" });
          await doDelete(items);
        }}
      />

      <DestinationPicker
        open={dialog.kind === "picker"}
        title={
          dialog.kind === "picker" && dialog.mode === "copy" ? "Copier vers…" : "Déplacer vers…"
        }
        initial={null}
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={async (dest) => {
          if (dialog.kind !== "picker") return;
          const { mode, items } = dialog;
          setDialog({ kind: "none" });
          await doTransfer(mode, items, dest);
        }}
      />

      <DetailsSheet
        open={dialog.kind === "details"}
        info={dialog.kind === "details" ? dialog.info : null}
        onClose={() => setDialog({ kind: "none" })}
      />

      <UniversalViewer
        open={dialog.kind === "viewer" && viewerIndex >= 0}
        entries={viewerEntries}
        parent={
          viewerEntries[viewerIndex >= 0 ? viewerIndex : 0]
            ? parentOf(viewerEntries[viewerIndex >= 0 ? viewerIndex : 0])
            : null
        }
        index={viewerIndex >= 0 ? viewerIndex : 0}
        onIndexChange={(i) => {
          const next = viewerEntries[i];
          if (next) setDialog({ kind: "viewer", entryId: addedId(next) });
        }}
        onClose={() => setDialog({ kind: "none" })}
        onAction={onViewerAction}
        parentOf={(e) => parentOf(e as never)}
      />

      <ProgressDialog
        open={progressOpen}
        title={progressTitle}
        subtitle={progressSubtitle}
        progress={transferProgress ?? progress}
        speedBps={activeTransfer?.speedBps}
        onHide={activeTransfer ? hideTransferDialog : undefined}
        onCancel={() => {
          if (activeTransfer) cancelTransfer(activeTransfer.id);
          else signalRef.current?.cancel();
        }}
      />
    </AppShell>
  );
}
