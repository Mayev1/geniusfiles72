/**
 * ExplorerPicker — MODE SÉLECTION de GeniusFiles.
 *
 * Ce n'est plus un « petit sélecteur » : c'est l'interface principale de
 * GeniusFiles (accueil → stockages → catégories → dossiers → récents →
 * applications) affichée avec un mode sélection actif.
 *
 * Principes :
 *  - navigation complète : accueil, stockages, catégories indexées,
 *    dossiers réels, fichiers récents, applications installées ;
 *  - recherche, tri, vue liste/grille et aperçu conservés ;
 *  - actions non pertinentes (copier, déplacer, renommer, supprimer,
 *    partager) volontairement absentes ;
 *  - la sélection est globale : elle survit à toute navigation interne
 *    et n'est perdue qu'à l'annulation ou à la validation ;
 *  - toucher la ligne = sélectionner / désélectionner ; toucher l'icône =
 *    ouvrir (dossier : entrer, fichier : lire/aperçu, application :
 *    lancer) ;
 *  - performances : listes virtualisées, index lu depuis le cache local,
 *    aucune reconstruction complète (100 000+ fichiers supportés).
 */
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AppWindow,
  ArrowLeft,
  ArrowUpDown,
  Check,
  ChevronRight,
  Clock,
  Eye,
  Folder,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  Search,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  FileEntry,
  FileKind,
  PathRef,
  SortKey,
  SortOrder,
  StorageRoot,
  StorageRootId,
} from "@/lib/files/types";
import { listDirectory, toAbsolutePath } from "@/lib/files/fs";
import { useRoots } from "@/lib/fs/useRoots";
import {
  subscribeCategory,
  CATEGORY_LABEL,
  type CategoryFile,
  type CategoryKind,
} from "@/lib/files/categories";
import { FileIcon } from "@/components/files/FileIcon";
import { formatSize } from "@/lib/files/format";
import { sortEntries } from "@/lib/files/sort";
import { loadRecentFiles, subscribeRecents, type RecentFile } from "@/lib/recents/store";
import { listInstalledApps, openApp } from "@/lib/apps/api";
import type { InstalledApp } from "@/lib/apps/types";
import { openWithSystem } from "@/lib/viewer/openWith";
import { BottomSheet } from "@/components/files/BottomSheet";
import { PdfButton } from "@/components/pdf/ui";
import { useThumbnail } from "@/hooks/use-thumbnail";

/** Élément sélectionné, tel que transmis à la fonctionnalité appelante. */
export type PickedEntry = FileEntry & { absolutePath: string };

/** Détail complet d'une sélection (dossier parent réel + application). */
export type PickedDetail = {
  key: string;
  entry: FileEntry;
  absolutePath: string;
  /** Dossier réel contenant l'élément (null pour une application). */
  parent: PathRef | null;
  app?: InstalledApp;
};

/** Ce que la fonctionnalité appelante accepte. */
export type PickAccept = "files" | "folders" | "both";

const CATEGORY_KINDS: CategoryKind[] = ["images", "videos", "audio", "documents", "downloads"];

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif"]);

function categoriesFor(extensions: string[]): CategoryKind[] {
  if (extensions.length === 0) return CATEGORY_KINDS;
  const out = new Set<CategoryKind>(["documents", "downloads"]);
  if (extensions.some((e) => IMAGE_EXT.has(e))) out.add("images");
  if (extensions.some((e) => ["mp4", "mkv", "mov", "avi", "webm", "3gp"].includes(e)))
    out.add("videos");
  if (extensions.some((e) => ["mp3", "m4a", "flac", "wav", "ogg", "opus", "aac"].includes(e)))
    out.add("audio");
  return CATEGORY_KINDS.filter((k) => out.has(k));
}

type Screen =
  | { kind: "home" }
  | { kind: "folder"; path: PathRef }
  | { kind: "category"; category: CategoryKind }
  | { kind: "recents" }
  | { kind: "apps" };

type Row = {
  key: string;
  name: string;
  sub: string;
  isDirectory: boolean;
  fileKind: FileKind;
  absolutePath: string;
  parent: PathRef | null;
  entry: FileEntry;
  app?: InstalledApp;
  selectable: boolean;
};

function entryOfCategoryFile(f: CategoryFile): { entry: FileEntry; parent: PathRef } {
  const { rootId, folderSegments, ...rest } = f;
  return { entry: rest as FileEntry, parent: { rootId, segments: folderSegments } };
}

function appEntry(app: InstalledApp): FileEntry {
  return {
    name: `${app.label}.apk`,
    path: app.sourceDir,
    isDirectory: false,
    size: app.apkSize,
    mtime: app.lastUpdateTime,
    kind: "apk",
    ext: "apk",
  };
}

export function ExplorerPicker({
  open,
  title,
  extensions,
  multi,
  accept = "files",
  apps = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** Extensions minuscules sans point, ex. ["pdf"]. Vide = tout accepter. */
  extensions: string[];
  multi: boolean;
  /** Types d'éléments que la fonctionnalité appelante accepte. */
  accept?: PickAccept;
  /** Autorise la sélection d'applications installées (transfert). */
  apps?: boolean;
  onCancel: () => void;
  onConfirm: (paths: string[], entries: FileEntry[], details: PickedDetail[]) => void;
}) {
  const extKey = extensions.join(",");
  const wantedCategories = useMemo(() => categoriesFor(extensions), [extKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const imageOnly = useMemo(
    () => extensions.length > 0 && extensions.every((e) => IMAGE_EXT.has(e)),
    [extKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [stack, setStack] = useState<Screen[]>([{ kind: "home" }]);
  const screen = stack[stack.length - 1];
  const [view, setView] = useState<"grid" | "list">(imageOnly ? "grid" : "list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, PickedDetail>>({});
  const [preview, setPreview] = useState<PickedEntry | null>(null);

  const { roots } = useRoots();
  const [catFiles, setCatFiles] = useState<Partial<Record<CategoryKind, CategoryFile[]>>>({});
  const [catReady, setCatReady] = useState(false);
  const [recents, setRecents] = useState<RecentFile[]>([]);
  const [appList, setAppList] = useState<InstalledApp[]>([]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);

  /* ---------- ouverture : rien de l'outil appelant n'est touché ---------- */
  useEffect(() => {
    if (!open) return;
    setStack([{ kind: "home" }]);
    setSelected({});
    setQuery("");
    setSearchOpen(false);
    setPreview(null);
    setView(imageOnly ? "grid" : "list");
  }, [open, imageOnly]);

  /* ---------- index catégories (lecture du cache, aucun scan bloquant) --- */
  useEffect(() => {
    if (!open) return;
    setCatReady(false);
    let remaining = wantedCategories.length;
    const handles = wantedCategories.map((kind) =>
      subscribeCategory(kind, (files, done) => {
        setCatFiles((prev) => ({ ...prev, [kind]: files }));
        if (done) {
          remaining -= 1;
          if (remaining <= 0) setCatReady(true);
        }
      }),
    );
    return () => handles.forEach((h) => h.cancel());
  }, [open, wantedCategories]);

  /* ---------- fichiers récents ---------- */
  useEffect(() => {
    if (!open) return;
    const sync = () => setRecents(loadRecentFiles());
    sync();
    return subscribeRecents(sync);
  }, [open]);

  /* ---------- applications installées ---------- */
  useEffect(() => {
    if (!open || !apps || screen.kind !== "apps") return;
    let cancelled = false;
    void listInstalledApps({ includeIcons: true }).then((res) => {
      if (!cancelled) setAppList(res.apps);
    });
    return () => {
      cancelled = true;
    };
  }, [open, apps, screen.kind]);

  /* ---------- dossier courant ---------- */
  const folderPath = screen.kind === "folder" ? screen.path : null;
  const folderKey = folderPath ? `${folderPath.rootId}:${folderPath.segments.join("/")}` : "";
  useEffect(() => {
    if (!open || !folderPath) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setDirLoading(true);
    setDirError(null);
    listDirectory(folderPath)
      .then((res) => {
        if (cancelled) return;
        setDirLoading(false);
        if (res.ok) setEntries(res.entries);
        else {
          setEntries([]);
          setDirError("Dossier inaccessible ou autorisation refusée.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDirLoading(false);
        setDirError("Stockage indisponible.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, folderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- règles d'acceptation ---------- */
  const acceptsFile = useCallback(
    (name: string) =>
      accept !== "folders" &&
      (extensions.length === 0 || extensions.some((e) => name.toLowerCase().endsWith(`.${e}`))),
    [accept, extKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const acceptsFolder = accept !== "files";

  const rowOfEntry = useCallback(
    (entry: FileEntry, parent: PathRef, sub?: string): Row => {
      const absolutePath = toAbsolutePath({
        rootId: parent.rootId,
        segments: [...parent.segments, entry.name],
      });
      return {
        key: absolutePath,
        name: entry.name,
        sub: sub ?? (entry.isDirectory ? "Dossier" : formatSize(entry.size)),
        isDirectory: entry.isDirectory,
        fileKind: entry.kind,
        absolutePath,
        parent,
        entry,
        selectable: entry.isDirectory ? acceptsFolder : acceptsFile(entry.name),
      };
    },
    [acceptsFolder, acceptsFile],
  );

  /* ---------- lignes du écran courant ---------- */
  const q = deferredQuery.trim().toLowerCase();

  const searchRows = useMemo(() => {
    if (!q) return null;
    const out: Row[] = [];
    for (const kind of wantedCategories) {
      for (const f of catFiles[kind] ?? []) {
        if (!f.name.toLowerCase().includes(q)) continue;
        if (!acceptsFile(f.name)) continue;
        const { entry, parent } = entryOfCategoryFile(f);
        const row = rowOfEntry(entry, parent, parent.segments.join(" / ") || "Racine");
        if (!out.some((r) => r.key === row.key)) out.push(row);
        if (out.length >= 2000) break;
      }
    }
    return out;
  }, [q, wantedCategories, catFiles, acceptsFile, rowOfEntry]);

  const screenRows = useMemo(() => {
    if (screen.kind === "category") {
      const out: Row[] = [];
      for (const f of catFiles[screen.category] ?? []) {
        if (!acceptsFile(f.name)) continue;
        if (q && !f.name.toLowerCase().includes(q)) continue;
        const { entry, parent } = entryOfCategoryFile(f);
        out.push(rowOfEntry(entry, parent, parent.segments.join(" / ") || "Racine"));
      }
      return out;
    }
    if (screen.kind === "recents") {
      const out: Row[] = [];
      for (const f of recents) {
        if (q && !f.name.toLowerCase().includes(q)) continue;
        const parent: PathRef = { rootId: f.rootId, segments: f.folderSegments };
        const entry: FileEntry = {
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory,
          size: f.size,
          mtime: f.mtime,
          kind: f.kind,
          ext: f.ext,
        };
        const row = rowOfEntry(entry, parent);
        if (!row.selectable && !row.isDirectory) continue;
        out.push(row);
      }
      return out;
    }
    if (screen.kind === "apps") {
      return appList
        .filter((a) => !q || a.label.toLowerCase().includes(q))
        .map<Row>((a) => ({
          key: `app:${a.packageName}`,
          name: a.label,
          sub: `${a.packageName} · ${formatSize(a.apkSize)}`,
          isDirectory: false,
          fileKind: "apk",
          absolutePath: a.sourceDir,
          parent: null,
          entry: appEntry(a),
          app: a,
          selectable: true,
        }));
    }
    if (screen.kind === "folder" && folderPath) {
      const visible = entries.filter(
        (e) => (e.isDirectory || acceptsFile(e.name)) && (!q || e.name.toLowerCase().includes(q)),
      );
      return sortEntries(visible, sortKey, sortOrder, true).map((e) => rowOfEntry(e, folderPath));
    }
    return [];
  }, [
    screen,
    catFiles,
    recents,
    appList,
    entries,
    folderPath,
    q,
    acceptsFile,
    rowOfEntry,
    sortKey,
    sortOrder,
  ]);

  const rows = useMemo(() => {
    const base = screen.kind === "home" ? (searchRows ?? []) : screenRows;
    if (screen.kind === "folder" || screen.kind === "apps") return base;
    // Catégories / récents / recherche : tri appliqué sur la liste plate.
    const sorted = sortEntries(
      base.map((r) => r.entry),
      sortKey,
      sortOrder,
      true,
    );
    const index = new Map(base.map((r) => [r.entry, r] as const));
    return sorted.map((e) => index.get(e)!).filter(Boolean);
  }, [screen.kind, searchRows, screenRows, sortKey, sortOrder]);

  const selectedCount = Object.keys(selected).length;

  /* ---------- sélection ---------- */
  const detailOf = (row: Row): PickedDetail => ({
    key: row.key,
    entry: row.entry,
    absolutePath: row.absolutePath,
    parent: row.parent,
    app: row.app,
  });

  const confirmWith = (details: PickedDetail[]) => {
    onConfirm(
      details.map((d) => d.absolutePath),
      details.map((d) => d.entry),
      details,
    );
  };

  const activate = (row: Row) => {
    if (!row.selectable) {
      // Élément incompatible : la seule action utile reste l'exploration.
      openRow(row);
      return;
    }
    if (!multi) {
      confirmWith([detailOf(row)]);
      return;
    }
    setSelected((prev) => {
      const next = { ...prev };
      if (next[row.key]) delete next[row.key];
      else next[row.key] = detailOf(row);
      return next;
    });
  };

  const openRow = (row: Row) => {
    if (row.isDirectory && row.parent) {
      push({
        kind: "folder",
        path: { rootId: row.parent.rootId, segments: [...row.parent.segments, row.name] },
      });
      return;
    }
    if (row.app) {
      void openApp(row.app.packageName);
      return;
    }
    if (row.fileKind === "image") {
      setPreview({ ...row.entry, absolutePath: row.absolutePath });
      return;
    }
    if (row.parent) void openWithSystem(row.parent, row.entry, "view");
  };

  const push = (next: Screen) => {
    setStack((prev) => [...prev, next]);
    setQuery("");
  };

  const back = () => {
    if (stack.length > 1) {
      setStack((prev) => prev.slice(0, -1));
      setQuery("");
      return;
    }
    onCancel();
  };

  const goUp = () => {
    if (screen.kind === "folder" && screen.path.segments.length > 0) {
      const parent = { rootId: screen.path.rootId, segments: screen.path.segments.slice(0, -1) };
      setStack((prev) => [...prev.slice(0, -1), { kind: "folder", path: parent }]);
      setQuery("");
      return;
    }
    back();
  };

  const heading =
    screen.kind === "home"
      ? title
      : screen.kind === "category"
        ? CATEGORY_LABEL[screen.category]
        : screen.kind === "recents"
          ? "Fichiers récents"
          : screen.kind === "apps"
            ? "Applications"
            : screen.path.segments.length
              ? screen.path.segments[screen.path.segments.length - 1]
              : (roots.find((r) => r.id === screen.path.rootId)?.label ?? "Stockage");

  const hint = multi
    ? selectedCount > 0
      ? `${selectedCount} élément${selectedCount > 1 ? "s" : ""} sélectionné${selectedCount > 1 ? "s" : ""}`
      : "Touchez un élément pour le sélectionner · icône = ouvrir"
    : "Touchez un élément pour le choisir · icône = ouvrir";

  return (
    <>
      <BottomSheet open={open} onClose={onCancel} fullScreen>
        <div className="-mx-6 -my-5 flex h-full min-h-0 flex-col">
          <div className="shrink-0 space-y-3 border-b border-border/60 bg-surface px-4 pb-3 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goUp}
                aria-label="Retour"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 active:scale-95 hover:bg-surface-2"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[17px] font-semibold leading-tight text-foreground">
                  {heading}
                </h2>
                <p className="truncate text-[12px] text-muted-foreground">{hint}</p>
              </div>
              <button
                type="button"
                onClick={() => setSearchOpen((s) => !s)}
                aria-label="Rechercher"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 active:scale-95 hover:bg-surface-2"
              >
                <Search className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setSortOpen(true)}
                aria-label="Trier"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 active:scale-95 hover:bg-surface-2"
              >
                <ArrowUpDown className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setView((v) => (v === "grid" ? "list" : "grid"))}
                aria-label="Changer la vue"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 active:scale-95 hover:bg-surface-2"
              >
                {view === "grid" ? (
                  <ListIcon className="h-5 w-5" />
                ) : (
                  <LayoutGrid className="h-5 w-5" />
                )}
              </button>
            </div>

            {searchOpen ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground-2" />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher dans GeniusFiles…"
                  className="h-[52px] w-full rounded-2xl border border-transparent bg-input pl-11 pr-4 text-[15px] text-foreground outline-none transition-all duration-150 focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/20 placeholder:text-muted-foreground-2"
                />
              </div>
            ) : null}

            {screen.kind === "folder" ? (
              <p className="truncate text-[12px] text-muted-foreground">
                {roots.find((r) => r.id === screen.path.rootId)?.label}
                {screen.path.segments.length ? ` / ${screen.path.segments.join(" / ")}` : ""}
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1">
            {screen.kind === "home" && !q ? (
              <HomeBody
                roots={roots}
                categories={wantedCategories}
                showApps={apps}
                onRoot={(id) => push({ kind: "folder", path: { rootId: id, segments: [] } })}
                onCategory={(category) => push({ kind: "category", category })}
                onRecents={() => push({ kind: "recents" })}
                onApps={() => push({ kind: "apps" })}
              />
            ) : dirLoading && rows.length === 0 ? (
              <Empty>Chargement…</Empty>
            ) : dirError ? (
              <Empty>{dirError}</Empty>
            ) : rows.length === 0 ? (
              <Empty>
                {!catReady && (screen.kind === "category" || screen.kind === "home")
                  ? "Indexation en cours…"
                  : q
                    ? "Aucun résultat."
                    : "Aucun élément compatible ici."}
              </Empty>
            ) : view === "grid" ? (
              <GridBody
                rows={rows}
                selected={selected}
                onActivate={activate}
                onOpen={openRow}
                multi={multi}
              />
            ) : (
              <ListBody
                rows={rows}
                selected={selected}
                onActivate={activate}
                onOpen={openRow}
                multi={multi}
              />
            )}
          </div>

          <div
            className="shrink-0 border-t border-border/60 bg-surface px-4 py-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {multi && selectedCount
                  ? `${selectedCount} sélectionné${selectedCount > 1 ? "s" : ""}`
                  : `${rows.length} élément${rows.length > 1 ? "s" : ""}`}
              </span>
              {multi && selectedCount ? (
                <PdfButton variant="ghost" onClick={() => setSelected({})}>
                  Tout effacer
                </PdfButton>
              ) : null}
              {multi ? (
                <PdfButton
                  onClick={() => confirmWith(Object.values(selected))}
                  disabled={selectedCount === 0}
                >
                  Valider{selectedCount ? ` (${selectedCount})` : ""}
                </PdfButton>
              ) : (
                <PdfButton variant="ghost" onClick={onCancel}>
                  Annuler
                </PdfButton>
              )}
            </div>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)} title="Trier par">
        <div className="space-y-1 pb-2">
          {(
            [
              ["name", "Nom"],
              ["date", "Date"],
              ["size", "Taille"],
              ["type", "Type"],
            ] as [SortKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                else setSortKey(key);
                setSortOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-[15px] transition-colors active:bg-secondary/40 ${
                sortKey === key ? "text-primary" : "text-foreground"
              }`}
            >
              {label}
              {sortKey === key ? (
                <span className="text-[12px] text-muted-foreground">
                  {sortOrder === "asc" ? "Croissant" : "Décroissant"}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </BottomSheet>

      {preview ? <PreviewOverlay entry={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

/* --------------------------------------------------------------------- */
/* Accueil du mode sélection                                              */
/* --------------------------------------------------------------------- */

function HomeBody({
  roots,
  categories,
  showApps,
  onRoot,
  onCategory,
  onRecents,
  onApps,
}: {
  roots: StorageRoot[];
  categories: CategoryKind[];
  showApps: boolean;
  onRoot: (id: StorageRootId) => void;
  onCategory: (kind: CategoryKind) => void;
  onRecents: () => void;
  onApps: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 py-3">
      <SectionTitle>Stockages</SectionTitle>
      <ul className="mb-4">
        {roots
          .filter((r) => r.available)
          .map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onRoot(r.id)}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors active:bg-secondary/40"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <HardDrive className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-foreground">
                    {r.label}
                  </span>
                  {r.hint ? (
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {r.hint}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
              </button>
            </li>
          ))}
      </ul>

      <SectionTitle>Catégories</SectionTitle>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {categories.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onCategory(k)}
            className="rounded-2xl border border-border bg-surface-2 px-3 py-4 text-left text-[14px] font-medium text-foreground transition-transform duration-150 active:scale-[0.98]"
          >
            {CATEGORY_LABEL[k]}
          </button>
        ))}
      </div>

      <SectionTitle>Raccourcis</SectionTitle>
      <ul>
        <li>
          <button
            type="button"
            onClick={onRecents}
            className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors active:bg-secondary/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/60 text-foreground/80">
              <Clock className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
              Fichiers récents
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
          </button>
        </li>
        {showApps ? (
          <li>
            <button
              type="button"
              onClick={onApps}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors active:bg-secondary/40"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/60 text-foreground/80">
                <AppWindow className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                Applications
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-2 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Listes                                                                 */
/* --------------------------------------------------------------------- */

function ListBody({
  rows,
  selected,
  onActivate,
  onOpen,
  multi,
}: {
  rows: Row[];
  selected: Record<string, PickedDetail>;
  onActivate: (row: Row) => void;
  onOpen: (row: Row) => void;
  multi: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain px-4">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          const isSel = !!selected[row.key];
          return (
            <div
              key={row.key}
              className="absolute left-0 top-0 flex w-full items-center gap-3"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
            >
              <button
                type="button"
                onClick={() => onOpen(row)}
                aria-label={row.isDirectory ? `Ouvrir ${row.name}` : `Lire ${row.name}`}
                className="relative shrink-0 rounded-xl transition-transform duration-150 active:scale-95"
              >
                {row.isDirectory ? (
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
                    <Folder className="h-5 w-5" />
                  </span>
                ) : row.app?.iconBase64 ? (
                  <img
                    src={`data:image/png;base64,${row.app.iconBase64}`}
                    alt=""
                    className="h-11 w-11 rounded-xl object-contain"
                  />
                ) : (
                  <FileIcon kind={row.fileKind} path={row.absolutePath} size="sm" />
                )}
                {!row.isDirectory && row.fileKind === "image" ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-white">
                    <Eye className="h-2.5 w-2.5" />
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onActivate(row)}
                className={`flex h-full min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 text-left transition-colors active:bg-secondary/40 ${
                  isSel ? "bg-primary/10" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-foreground">{row.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {row.sub}
                  </span>
                </span>
                {row.selectable && multi ? (
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isSel
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GridBody({
  rows,
  selected,
  onActivate,
  onOpen,
  multi,
}: {
  rows: Row[];
  selected: Record<string, PickedDetail>;
  onActivate: (row: Row) => void;
  onOpen: (row: Row) => void;
  multi: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(3);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setCols(Math.max(2, Math.min(6, Math.round(el.clientWidth / 130))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(rows.length / cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 124,
    overscan: 6,
  });

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain px-4 py-2">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const slice = rows.slice(v.index * cols, v.index * cols + cols);
          return (
            <div
              key={v.key}
              className="absolute left-0 top-0 grid w-full gap-2 pb-2"
              style={{
                height: v.size,
                transform: `translateY(${v.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {slice.map((row) => {
                const isSel = !!selected[row.key];
                return (
                  <div
                    key={row.key}
                    className={`relative overflow-hidden rounded-2xl border transition-all duration-150 ${
                      isSel ? "border-primary ring-2 ring-primary/30" : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onActivate(row)}
                      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-2 p-1 transition-transform duration-150 active:scale-[0.98]"
                    >
                      {row.isDirectory ? (
                        <Folder className="h-7 w-7 text-muted-foreground" />
                      ) : row.app?.iconBase64 ? (
                        <img
                          src={`data:image/png;base64,${row.app.iconBase64}`}
                          alt=""
                          className="h-10 w-10 object-contain"
                        />
                      ) : (
                        <FileIcon kind={row.fileKind} path={row.absolutePath} size="lg" />
                      )}
                      <span className="line-clamp-2 w-full px-1 text-center text-[10px] leading-tight text-muted-foreground">
                        {row.name}
                      </span>
                    </button>
                    {isSel && multi ? (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={row.isDirectory ? `Ouvrir ${row.name}` : `Lire ${row.name}`}
                      onClick={() => onOpen(row)}
                      className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white transition-transform duration-150 active:scale-95"
                    >
                      {row.isDirectory ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewOverlay({ entry, onClose }: { entry: PickedEntry; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const src = useThumbnail(entry.absolutePath, 1200);
  return (
    <div className="fixed inset-0 z-[4000] flex flex-col bg-black/95">
      <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l'aperçu"
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-transform duration-150 active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{entry.name}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {src ? (
          <img
            src={src}
            alt={entry.name}
            onClick={() => setZoom((z) => (z >= 3 ? 1 : z + 1))}
            style={{ transform: `scale(${zoom})` }}
            className="max-h-full max-w-full origin-center object-contain transition-transform duration-200"
          />
        ) : (
          <span className="text-[13px] text-white/60">Aperçu indisponible</span>
        )}
      </div>
    </div>
  );
}
