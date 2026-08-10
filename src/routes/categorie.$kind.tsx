/**
 * Vue virtuelle par catégorie — Images, Vidéos, Musique, Documents,
 * Téléchargements. Agrège tous les fichiers correspondants sur
 * l'ensemble des espaces de stockage autorisés, quel que soit leur
 * dossier d'origine. Les résultats streament pendant l'analyse et
 * sont mis en cache : réouvrir la catégorie est quasi instantané.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, FolderSearch } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { usePullToRefresh } from "@/lib/gestures/pull-refresh";
import { useAppBack } from "@/lib/navigation/use-app-back";
import { BACK_PRIORITY, useBackHandler } from "@/lib/navigation/back-stack";
import { FilesTopBar } from "@/components/files/FilesTopBar";
import { FileGridView, FileListView } from "@/components/files/FileList";
import { SelectionBar } from "@/components/files/SelectionBar";

import { MoreActionsSheet } from "@/components/files/MoreActionsSheet";
import { buildMoreActions } from "@/lib/files/selection-actions";
import { EntryActionSheet, type EntryAction } from "@/components/files/EntryActionSheet";
import { ConfirmDialog, NamePrompt } from "@/components/files/BottomSheet";
import { DestinationPicker } from "@/components/files/DestinationPicker";
import { DetailsSheet } from "@/components/files/DetailsSheet";
import { ProgressDialog } from "@/components/files/ProgressDialog";
import { startTransfer, cancelTransfer } from "@/lib/transfers/manager";
import { useTransferTask } from "@/lib/transfers/useTransfers";
import { UniversalViewer, type ViewerAction } from "@/components/viewer/UniversalViewer";
import { EmptyState } from "@/components/ui/EmptyState";
import { batchSummary, errorMessage } from "@/lib/errors/humanize";
import { confirmCopy, progressLabel } from "@/lib/copy";
import { canOpenInViewer, canPreview } from "@/lib/viewer/kinds";
import { openWithSystem } from "@/lib/viewer/openWith";
import { audioEditorSearch } from "@/lib/audio/routes";
import { sortEntries } from "@/lib/files/sort";
import { formatSize } from "@/lib/files/format";
import { useSelectionSize } from "@/lib/files/selection-size";
import { selectionKey, type SelectionItem } from "@/lib/files/selection-store";
import { loadFoldersFirst, loadSort, loadView, saveSort, saveView } from "@/lib/files/preferences";
import type { FileEntry, PathRef, SortKey, SortOrder, ViewMode } from "@/lib/files/types";
import {
  CATEGORY_LABEL,
  refreshCategory,
  subscribeCategory,
  type CategoryFile,
  type CategoryKind,
} from "@/lib/files/categories";
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

import { CategoryTabs, type CategoryTabId } from "@/components/files/CategoryTabs";
import { DOC_TABS, isDocTab, matchesDocTab } from "@/lib/files/doc-tabs";
import { CategoryFolderList, type CategoryFolder } from "@/components/files/CategoryFolderList";
import { groupBySort, type FileGroup } from "@/lib/files/image-groups";
import { IllustratedEmptyState } from "@/components/ui/IllustratedEmptyState";
import type { EmptyIllustrationId } from "@/lib/copy/empty-illustrations";

/** Illustration officielle correspondant à chaque catégorie. */
const EMPTY_ILLUSTRATION_BY_KIND: Record<CategoryKind, EmptyIllustrationId> = {
  images: "images",
  videos: "videos",
  audio: "audio",
  documents: "documents",
  downloads: "downloads",
};

const KINDS: CategoryKind[] = ["images", "videos", "audio", "documents", "downloads"];

function isKind(x: string): x is CategoryKind {
  return (KINDS as string[]).includes(x);
}

export const Route = createFileRoute("/categorie/$kind")({
  head: ({ params }) => {
    const label = isKind(params.kind) ? CATEGORY_LABEL[params.kind] : "Catégorie";
    return {
      meta: [
        { title: `${label} — GeniusFiles` },
        {
          name: "description",
          content: `Tous vos fichiers « ${label} » rassemblés en une vue unique, quel que soit leur emplacement de stockage.`,
        },
        { property: "og:title", content: `${label} — GeniusFiles` },
        {
          property: "og:description",
          content: `Vue virtuelle GeniusFiles regroupant automatiquement vos ${label.toLowerCase()}.`,
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: CategoryPage,
});

type Dialog =
  | { kind: "none" }
  | { kind: "actions"; entry: FileEntry }
  | { kind: "details"; info: DetailsInfo | null; loading: boolean; parent: PathRef }
  | { kind: "rename"; entry: FileEntry; parent: PathRef }
  | { kind: "confirmDelete"; items: CategoryFile[] }
  | { kind: "picker"; mode: "copy" | "move"; items: CategoryFile[] }
  | { kind: "viewer"; entryName: string };

function parentOf(f: CategoryFile): PathRef {
  return { rootId: f.rootId, segments: f.folderSegments };
}

function CategoryPage() {
  const navigate = useNavigate();
  const params = Route.useParams();
  const kind: CategoryKind = isKind(params.kind) ? params.kind : "images";
  const label = CATEGORY_LABEL[kind];

  const [files, setFiles] = useState<CategoryFile[]>([]);

  /* Onglets : « Chansons / Dossiers » (Musique) ou « Toutes / WORD / PDF /
     TXT / Autres » (Documents). L'onglet actif et le dossier ouvert sont
     conservés tant que l'utilisateur reste dans la catégorie
     (sessionStorage), comme sur Android. */
  /* Musique, Vidéos et Images partagent la même structure : onglet média +
     onglet dossiers/albums avec navigation à l'intérieur d'un dossier. */
  const folderTabs = kind === "audio" || kind === "videos" || kind === "images";
  const mediaTabLabel = kind === "videos" ? "Vidéos" : kind === "images" ? "Images" : "Chansons";
  const mediaUnitLabel = kind === "videos" ? "vidéo" : kind === "images" ? "photo" : "chanson";
  const folderTabLabel = kind === "images" ? "Albums" : "Dossiers";
  /* Images : regroupement automatique selon le tri actif (galerie Android). */
  const grouped = kind === "images";
  const docTabs = kind === "documents";
  const hasTabs = folderTabs || docTabs;
  const defaultTab: CategoryTabId = docTabs ? "all" : "songs";
  const [tab, setTab] = useState<CategoryTabId>(defaultTab);

  const [openFolder, setOpenFolder] = useState<{
    rootId: CategoryFile["rootId"];
    segments: string[];
    name: string;
  } | null>(null);

  const [view, setView] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [query, setQuery] = useState("");
  /* Recherche contextuelle : dépliée depuis la barre supérieure, comme le
     gestionnaire de fichiers. Le libellé s'adapte à l'onglet actif. */
  const [searchOpen, setSearchOpen] = useState(false);
  const goBack = useAppBack();
  const searchPlaceholder = (() => {
    if (folderTabs && openFolder) return `Rechercher dans « ${openFolder.name} »`;
    if (docTabs) {
      if (tab === "pdf") return "Rechercher dans les PDF";
      if (tab === "txt") return "Rechercher dans les TXT";
      if (tab === "word") return "Rechercher dans les documents Word";
      if (tab === "other") return "Rechercher dans les autres documents";
      return `Rechercher dans « ${label} »`;
    }
    if (folderTabs && tab === "folders") {
      return kind === "images"
        ? "Rechercher dans les albums"
        : `Rechercher dans les dossiers de ${label}`;
    }
    return `Rechercher dans « ${label} »`;
  })();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [moreOpen, setMoreOpen] = useState(false);

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

  /* Retour Android : feuille → recherche → sélection → écran précédent.
     Les BottomSheet/visionneuse s'enregistrent eux-mêmes. */
  useBackHandler(
    moreOpen,
    () => {
      setMoreOpen(false);
      return true;
    },
    BACK_PRIORITY.overlay,
  );
  useBackHandler(
    searchOpen,
    () => {
      setQuery("");
      setSearchOpen(false);
      return true;
    },
    BACK_PRIORITY.mode,
  );

  useBackHandler(
    selected.size > 0,
    () => {
      setSelected(new Set());
      return true;
    },
    BACK_PRIORITY.mode,
  );
  /* Retour : dossier → liste des dossiers → onglet par défaut → écran précédent. */
  useBackHandler(
    folderTabs && openFolder !== null,
    () => {
      setOpenFolder(null);
      return true;
    },
    BACK_PRIORITY.page,
  );
  useBackHandler(
    folderTabs && openFolder === null && tab === "folders",
    () => {
      setTab("songs");
      return true;
    },
    BACK_PRIORITY.page,
  );
  useBackHandler(
    docTabs && tab !== "all",
    () => {
      setTab("all");
      return true;
    },
    BACK_PRIORITY.page,
  );

  const signalRef = useRef<(OperationSignal & { cancel: () => void }) | null>(null);

  useEffect(() => {
    setView(loadView());
    const s = loadSort();
    setSortKey(s.key);
    setSortOrder(s.order);
  }, []);

  /* Ouverture instantanée : l'index persistant est lu immédiatement,
     aucune analyse n'est déclenchée à l'affichage. Les créations,
     suppressions et renommages arrivent en direct via les patchs. */
  useEffect(() => {
    setSelected(new Set());
    const handle = subscribeCategory(kind, (next) => setFiles(next));
    return () => handle.cancel();
  }, [kind]);

  // Restauration de la position de défilement (retour depuis un fichier).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `gf:cat-scroll:${kind}`;
    const saved = Number(sessionStorage.getItem(key) ?? "0");
    if (saved > 0) {
      requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: "auto" }));
    }
    const onScroll = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sessionStorage.setItem(key, String(window.scrollY));
      window.removeEventListener("scroll", onScroll);
    };
  }, [kind]);

  /* Onglet actif + dossier ouvert : restaurés à l'ouverture de la catégorie. */
  useEffect(() => {
    if (!hasTabs || typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(`gf:cat-tab:${kind}`);
      if (!raw) return;
      const st = JSON.parse(raw) as {
        tab?: CategoryTabId;
        folder?: { rootId: CategoryFile["rootId"]; segments: string[]; name: string } | null;
      };
      if (st.tab) setTab(st.tab);
      if (st.folder) setOpenFolder(st.folder);
    } catch {
      /* état de navigation illisible : on repart de l'onglet par défaut */
    }
  }, [hasTabs, kind]);

  useEffect(() => {
    if (!hasTabs || typeof window === "undefined") return;
    sessionStorage.setItem(`gf:cat-tab:${kind}`, JSON.stringify({ tab, folder: openFolder }));
  }, [hasTabs, kind, tab, openFolder]);

  /** Fichiers visibles : filtre du sous-onglet, ou dossier ouvert. */
  const scoped = useMemo(() => {
    if (docTabs) {
      if (tab === "all") return files;
      const t = isDocTab(tab) ? tab : "all";
      return files.filter((f) => matchesDocTab(t, f.name));
    }
    if (!folderTabs || !openFolder) return files;
    const key = `${openFolder.rootId}/${openFolder.segments.join("/")}`;
    return files.filter((f) => `${f.rootId}/${f.folderSegments.join("/")}` === key);
  }, [files, folderTabs, docTabs, tab, openFolder]);

  /** Dossiers contenant au moins un fichier de la catégorie. */
  const folders = useMemo<CategoryFolder[]>(() => {
    if (!folderTabs) return [];
    const m = new Map<string, CategoryFolder>();
    for (const f of files) {
      const key = `${f.rootId}/${f.folderSegments.join("/")}`;
      const found = m.get(key);
      if (found) {
        found.count += 1;
        continue;
      }
      m.set(key, {
        rootId: f.rootId,
        segments: f.folderSegments,
        name: f.folderSegments[f.folderSegments.length - 1] ?? "Racine du stockage",
        count: 1,
        // Album : miniature réelle de la première image du dossier.
        coverPath: grouped ? f.path : undefined,
      });
    }
    const list = [...m.values()];
    list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));
    return list;
  }, [files, folderTabs, grouped]);

  /* La saisie reste prioritaire : le filtrage d'une très grande liste est
     recalculé en tâche de moindre priorité (aucune frappe perdue). */
  const deferredQuery = useDeferredValue(query);

  const visibleFolders = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, deferredQuery]);

  const filtered = useMemo(() => {
    if (!deferredQuery.trim()) return scoped;
    const q = deferredQuery.trim().toLowerCase();
    return scoped.filter((f) => f.name.toLowerCase().includes(q));
  }, [scoped, deferredQuery]);

  const sorted = useMemo(
    () => sortEntries(filtered, sortKey, sortOrder, false) as CategoryFile[],
    [filtered, sortKey, sortOrder],
  );

  /* Regroupement dynamique (Images) : reconstruit dès que le tri change,
     sans rechargement des données. */
  const groups = useMemo<FileGroup<CategoryFile>[]>(
    () => (grouped ? groupBySort(sorted, sortKey) : []),
    [grouped, sorted, sortKey],
  );

  /* Chargement progressif des groupes (galerie) : seuls les premiers
     groupes sont montés, les suivants arrivent au défilement. */
  const GROUP_PAGE = 8;
  const [groupLimit, setGroupLimit] = useState(GROUP_PAGE);
  useEffect(() => {
    setGroupLimit(GROUP_PAGE);
  }, [kind, tab, openFolder, sortKey, sortOrder, deferredQuery]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!grouped) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setGroupLimit((n) => (n >= groups.length ? n : n + GROUP_PAGE));
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [grouped, groups.length]);

  const idOf = (f: CategoryFile) => `${f.rootId}/${f.folderSegments.join("/")}/${f.name}`;
  /* Index identifiant → fichier, construit une seule fois par liste : chaque
     cocher/décocher devient O(taille de la sélection) au lieu d'un parcours
     complet de la catégorie (100 000+ éléments). */
  const byId = useMemo(() => {
    const m = new Map<string, CategoryFile>();
    for (const f of sorted) m.set(idOf(f), f);
    return m;
  }, [sorted]);
  const selectedFiles = useMemo(() => {
    const out: CategoryFile[] = [];
    for (const id of selected) {
      const f = byId.get(id);
      if (f) out.push(f);
    }
    return out;
  }, [byId, selected]);

  /* Taille réelle de la sélection — exactement le même mécanisme que le
     gestionnaire de fichiers (tailles connues pour les fichiers, mesure
     récursive mémorisée pour les dossiers, sans double comptage). */
  const selectionItems = useMemo(() => {
    const m = new Map<string, SelectionItem>();
    for (const f of selectedFiles) {
      const parent = parentOf(f);
      const key = selectionKey(parent, f.name);
      m.set(key, { key, parent, entry: f });
    }
    return m;
  }, [selectedFiles]);
  const selectionSize = useSelectionSize(selectionItems);
  const selectionSizeLabel = selectionSize.pending
    ? selectionSize.bytes > 0
      ? `${formatSize(selectionSize.bytes)} • calcul…`
      : "Calcul…"
    : formatSize(selectionSize.bytes);

  const toggleSelect = useCallback((entry: FileEntry) => {
    const f = entry as CategoryFile;
    setSelected((prev) => {
      const next = new Set(prev);
      const id = idOf(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const beginSelection = useCallback((entry: FileEntry) => {
    setSelected(new Set([idOf(entry as CategoryFile)]));
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const selectAll = useCallback(() => {
    setSelected(new Set(sorted.map(idOf)));
  }, [sorted]);
  const selectRange = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const indices: number[] = [];
      sorted.forEach((e, i) => {
        if (prev.has(idOf(e))) indices.push(i);
      });
      if (indices.length === 0) return prev;
      const lo = indices[0];
      const hi = indices[indices.length - 1];
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(idOf(sorted[i]));
      return next;
    });
  }, [sorted]);
  const isSelected = useCallback(
    (e: FileEntry) => selected.has(idOf(e as CategoryFile)),
    [selected],
  );

  const openEntry = useCallback((entry: FileEntry) => {
    const f = entry as CategoryFile;
    if (canPreview(f)) setDialog({ kind: "viewer", entryName: f.name });
    else setDialog({ kind: "actions", entry: f });
  }, []);

  /* ---------- grouped batch operations (per parent folder) ---------- */

  const groupByParent = (items: CategoryFile[]) => {
    const m = new Map<string, { parent: PathRef; entries: CategoryFile[] }>();
    for (const f of items) {
      const key = `${f.rootId}/${f.folderSegments.join("/")}`;
      const bucket = m.get(key);
      if (bucket) bucket.entries.push(f);
      else m.set(key, { parent: parentOf(f), entries: [f] });
    }
    return [...m.values()];
  };

  /* Tirer pour actualiser : reconstruction de l'index en tâche de fond,
     la liste affichée n'est jamais vidée. */
  usePullToRefresh(
    useCallback(() => {
      refreshCategory(kind);
    }, [kind]),
  );

  const refreshAfterMutation = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gf:storage-changed"));
    }
  };

  const doDelete = useCallback(
    async (items: CategoryFile[]) => {
      const groups = groupByParent(items);
      let ok = 0;
      let failed = 0;
      for (const g of groups) {
        const r = await deleteEntries(g.parent, g.entries);
        ok += r.succeeded;
        failed += r.failed.length;
      }
      clearSelection();
      refreshAfterMutation();
      const s = batchSummary("déplacé(s) dans la Corbeille", ok, failed);
      if (s.ok) toast.success(s.message);
      else toast.error(s.message);
    },
    [clearSelection],
  );

  const doShare = useCallback(async (items: CategoryFile[]) => {
    const groups = groupByParent(items);
    for (const g of groups) {
      const r = await shareEntries(g.parent, g.entries);
      if (!r.ok) toast.error(errorMessage(r.error, "Partage impossible"));
    }
  }, []);

  const doTransfer = useCallback(
    (mode: "copy" | "move", items: CategoryFile[], dest: PathRef) => {
      const destLabel = dest.segments.length ? dest.segments.join(" / ") : "Racine du stockage";
      const id = startTransfer({
        mode,
        groups: groupByParent(items),
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
      clearSelection();
    },
    [clearSelection],
  );

  const doRename = useCallback(
    async (entry: FileEntry, parent: PathRef, newName: string) => {
      const r = await renameEntry(parent, entry, newName);
      if (r.ok) {
        toast.success("Renommé");
        clearSelection();
        refreshAfterMutation();
        return true;
      }
      toast.error(errorMessage(r.error, "Renommage impossible"));
      return false;
    },
    [clearSelection],
  );

  /* ---------- action-sheet dispatch ---------- */

  const onEntryAction = useCallback(
    async (action: EntryAction) => {
      if (dialog.kind !== "actions") return;
      const f = dialog.entry as CategoryFile;
      const parent = parentOf(f);
      setDialog({ kind: "none" });
      switch (action) {
        case "open":
          if (canPreview(f)) setDialog({ kind: "viewer", entryName: f.name });
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
      const f = entry as CategoryFile;
      const parent = parentOf(f);
      switch (action) {
        case "share":
          await doShare([f]);
          break;
        case "openWith":
          await openWithSystem(parent, f);
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

  const viewerEntries = useMemo(() => sorted.filter((f) => canOpenInViewer(f)), [sorted]);

  /**
   * Ouverture rapide depuis la vignette pendant le mode sélection : le
   * lecteur interne s'ouvre pour tout fichier, la sélection est préservée.
   */
  const quickOpenEntry = useCallback((entry: FileEntry) => {
    const f = entry as CategoryFile;
    if (canOpenInViewer(f)) setDialog({ kind: "viewer", entryName: f.name });
    else setDialog({ kind: "actions", entry: f });
  }, []);
  const viewerIndex = useMemo(() => {
    if (dialog.kind !== "viewer") return -1;
    return viewerEntries.findIndex((f) => f.name === dialog.entryName);
  }, [dialog, viewerEntries]);

  const selectionMode = selected.size > 0;
  const showFolders = folderTabs && tab === "folders" && !openFolder;

  return (
    <AppShell>
      <FilesTopBar
        title={folderTabs && openFolder ? openFolder.name : label}
        count={
          showFolders
            ? visibleFolders.length
            : folderTabs && openFolder
              ? scoped.length
              : docTabs
                ? scoped.length
                : files.length
        }
        onBack={goBack}
        onSearch={() => setSearchOpen((v) => !v)}
        view={view}
        onViewChange={(v) => {
          setView(v);
          saveView(v);
        }}
        sortKey={sortKey}
        sortOrder={sortOrder}
        onSortChange={(k, o) => {
          setSortKey(k);
          setSortOrder(o);
          saveSort({ key: k, order: o });
        }}
        onRefresh={() => {
          // Actualisation explicite : l'index se reconstruit en tâche de
          // fond, la liste affichée n'est jamais vidée.
          refreshCategory(kind);
        }}
        refreshing={false}
        onSelect={() => sorted[0] && setSelected(new Set([sorted[0].name]))}
        selection={
          selectionMode
            ? {
                count: selectedFiles.length,
                sizeLabel: selectionSizeLabel,
                onClear: clearSelection,
                onSelectAll: selectAll,
                onSelectRange: selectedFiles.length >= 1 ? selectRange : undefined,
              }
            : null
        }
      >
        {hasTabs && !openFolder ? (
          <CategoryTabs
            tabs={
              docTabs
                ? DOC_TABS
                : [
                    { id: "songs", label: mediaTabLabel },
                    { id: "folders", label: folderTabLabel },
                  ]
            }
            active={tab}
            onChange={(t) => {
              setTab(t);
              setQuery("");
            }}
          />
        ) : folderTabs && openFolder ? (
          <div className="flex h-8 items-center px-3">
            <p className="truncate text-[12px] text-muted-foreground">
              {openFolder.segments.join(" / ") || "Racine du stockage"}
            </p>
          </div>
        ) : null}
      </FilesTopBar>

      {searchOpen && !selectionMode ? (
        <div className="mb-2 mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSearchOpen(false);
            }}
            aria-label="Fermer la recherche"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {showFolders ? (
        visibleFolders.length === 0 ? (
          <EmptyState
            icon={FolderSearch}
            title={grouped ? "Aucun album" : "Aucun dossier"}
            description={`Aucun ${grouped ? "album" : "dossier"} contenant des fichiers « ${label.toLowerCase()} » n'a été trouvé.`}
          />
        ) : (
          <div className="-mx-4 pt-1">
            <CategoryFolderList
              folders={visibleFolders}
              unitLabel={folderTabs ? mediaUnitLabel : "fichier"}
              onOpen={(f) => {
                setSelected(new Set());
                setQuery("");
                setOpenFolder({ rootId: f.rootId, segments: f.segments, name: f.name });
              }}
            />
          </div>
        )
      ) : sorted.length === 0 && query.trim() ? (
        <IllustratedEmptyState
          id="search"
          description={`Aucun fichier ne correspond à « ${query.trim()} ». Essayez un autre terme.`}
          action={
            <button onClick={() => setQuery("")} className="btn-primary gf-press">
              Effacer la recherche
            </button>
          }
        />
      ) : sorted.length === 0 ? (
        <IllustratedEmptyState id={EMPTY_ILLUSTRATION_BY_KIND[kind]} />
      ) : (
        /* Marges identiques au gestionnaire de fichiers : la liste
           annule le padding horizontal de l'AppShell (-mx-4) puisque
           FileListView/FileGridView portent déjà leur propre px-4.
           Sans cela les marges étaient doublées (32 px au lieu de 16). */
        <div className="-mx-4 pt-1">
          {(grouped ? groups.slice(0, groupLimit) : [{ key: "all", label: "", items: sorted }]).map(
            (g) => (
              <section key={g.key}>
                {grouped && g.label ? (
                  <h2 className="sticky top-0 z-10 bg-background/95 px-4 py-1.5 text-[12.5px] font-semibold text-foreground/90 backdrop-blur">
                    {g.label}
                  </h2>
                ) : null}
                {view === "list" ? (
                  <FileListView
                    entries={g.items}
                    onOpen={openEntry}
                    onQuickOpen={quickOpenEntry}
                    onLongPress={beginSelection}
                    onMore={(e) => setDialog({ kind: "actions", entry: e })}
                    selectionMode={selectionMode}
                    isSelected={isSelected}
                    onToggleSelect={toggleSelect}
                  />
                ) : (
                  <FileGridView
                    entries={g.items}
                    onOpen={openEntry}
                    onQuickOpen={quickOpenEntry}
                    onLongPress={beginSelection}
                    onMore={(e) => setDialog({ kind: "actions", entry: e })}
                    selectionMode={selectionMode}
                    isSelected={isSelected}
                    onToggleSelect={toggleSelect}
                  />
                )}
              </section>
            ),
          )}
          {grouped && groupLimit < groups.length ? (
            <div ref={sentinelRef} className="h-10" aria-hidden />
          ) : null}
        </div>
      )}

      {selectionMode ? (
        <SelectionBar
          count={selectedFiles.length}
          onCopy={() => setDialog({ kind: "picker", mode: "copy", items: selectedFiles })}
          onMove={() => setDialog({ kind: "picker", mode: "move", items: selectedFiles })}
          onDelete={() => setDialog({ kind: "confirmDelete", items: selectedFiles })}
          onRename={() => {
            if (selectedFiles.length !== 1) return;
            const f = selectedFiles[0];
            setDialog({ kind: "rename", entry: f, parent: parentOf(f) });
          }}
          onShare={() => doShare(selectedFiles.filter((f) => !f.isDirectory))}
          onMore={() => setMoreOpen(true)}
        />
      ) : null}

      <MoreActionsSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        actions={buildMoreActions(selectedFiles, {
          onShare: () => doShare(selectedFiles.filter((f) => !f.isDirectory)),
          onProperties: async () => {
            const f = selectedFiles[0];
            if (!f) return;
            const parent = parentOf(f);
            setDialog({ kind: "details", info: null, loading: true, parent });
            const info = await readDetails(parent, f);
            setDialog({ kind: "details", info, loading: false, parent });
          },
          onCut: () => setDialog({ kind: "picker", mode: "move", items: selectedFiles }),
        })}
      />

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
          if (next) setDialog({ kind: "viewer", entryName: next.name });
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
