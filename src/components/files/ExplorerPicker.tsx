/**
 * ExplorerPicker — sélecteur de fichiers plein écran partagé par tous les
 * outils PDF (et les autres modules qui doivent choisir des fichiers).
 *
 * Il remplace l'ancien mini-menu : c'est le véritable explorateur
 * GeniusFiles, alimenté par les mêmes données que le gestionnaire de
 * fichiers.
 *
 *  - onglet catégorie : lecture instantanée de l'index local
 *    (subscribeCategory) — aucune analyse déclenchée, supporte 100 000+
 *    fichiers grâce à la virtualisation ;
 *  - onglet « Dossiers » : navigation réelle dans les volumes, avec
 *    retour et fil d'Ariane ;
 *  - recherche instantanée, vue grille/liste, miniatures asynchrones,
 *    aperçu plein écran, sélection multiple avec compteur et bouton
 *    « Valider » toujours accessible au pouce.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Eye,
  Folder,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  Search,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileEntry, PathRef, StorageRoot, StorageRootId } from "@/lib/files/types";
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
import { BottomSheet } from "@/components/files/BottomSheet";
import { PdfButton } from "@/components/pdf/ui";
import { useThumbnail } from "@/hooks/use-thumbnail";

export type PickedEntry = FileEntry & { absolutePath: string };

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif"]);

function categoryFor(extensions: string[]): CategoryKind {
  if (extensions.length && extensions.every((e) => IMAGE_EXT.has(e))) return "images";
  if (extensions.some((e) => ["mp4", "mkv", "mov", "avi", "webm"].includes(e))) return "videos";
  if (extensions.some((e) => ["mp3", "m4a", "flac", "wav", "ogg"].includes(e))) return "audio";
  return "documents";
}

function absOf(f: CategoryFile): string {
  return toAbsolutePath({ rootId: f.rootId, segments: [...f.folderSegments, f.name] });
}

export function ExplorerPicker({
  open,
  title,
  extensions,
  multi,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** Extensions minuscules sans point, ex. ["pdf"]. Vide = tout accepter. */
  extensions: string[];
  multi: boolean;
  onCancel: () => void;
  onConfirm: (paths: string[], entries: FileEntry[]) => void;
}) {
  const extKey = extensions.join(",");
  const kind = useMemo(() => categoryFor(extensions), [extKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const isImages = kind === "images";

  const [tab, setTab] = useState<"category" | "folders">("category");
  const [view, setView] = useState<"grid" | "list">(isImages ? "grid" : "list");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Record<string, FileEntry>>({});
  const [preview, setPreview] = useState<PickedEntry | null>(null);

  const [catFiles, setCatFiles] = useState<CategoryFile[]>([]);
  const [catReady, setCatReady] = useState(false);

  const { roots } = useRoots();
  const [path, setPath] = useState<PathRef | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);

  // Réinitialisation à l'ouverture uniquement : l'état de l'outil appelant
  // n'est jamais touché, rien n'est perdu pendant la sélection.
  useEffect(() => {
    if (!open) return;
    setSelected({});
    setQuery("");
    setPreview(null);
    setTab("category");
    setView(isImages ? "grid" : "list");
  }, [open, isImages]);

  useEffect(() => {
    if (!open) return;
    setCatReady(false);
    const h = subscribeCategory(kind, (files, done) => {
      setCatFiles(files);
      if (done) setCatReady(true);
    });
    return () => h.cancel();
  }, [open, kind]);

  useEffect(() => {
    if (!open || tab !== "folders" || !path) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setDirLoading(true);
    setDirError(null);
    listDirectory(path)
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
  }, [open, tab, path]);

  const categoryRows = useMemo(() => {
    const accept = (name: string) =>
      extensions.length === 0 || extensions.some((e) => name.toLowerCase().endsWith(`.${e}`));
    const q = deferredQuery.trim().toLowerCase();
    const out: PickedEntry[] = [];
    for (const f of catFiles) {
      if (!accept(f.name)) continue;
      if (q && !f.name.toLowerCase().includes(q)) continue;
      out.push({ ...f, absolutePath: absOf(f) });
    }
    out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    return out;
  }, [catFiles, deferredQuery, extKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const folderRows = useMemo(() => {
    if (!path) return [] as PickedEntry[];
    const accept = (name: string) =>
      extensions.length === 0 || extensions.some((e) => name.toLowerCase().endsWith(`.${e}`));
    const q = deferredQuery.trim().toLowerCase();
    return entries
      .filter((e) => (e.isDirectory || accept(e.name)) && (!q || e.name.toLowerCase().includes(q)))
      .map((e) => ({
        ...e,
        absolutePath: toAbsolutePath({ rootId: path.rootId, segments: [...path.segments, e.name] }),
      }))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory));
  }, [entries, path, deferredQuery, extKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: PickedEntry[] = tab === "category" ? categoryRows : folderRows;
  const selectedCount = Object.keys(selected).length;

  const toggle = (row: PickedEntry) => {
    if (!multi) {
      onConfirm([row.absolutePath], [row]);
      return;
    }
    setSelected((prev) => {
      const next = { ...prev };
      if (next[row.absolutePath]) delete next[row.absolutePath];
      else next[row.absolutePath] = row;
      return next;
    });
  };

  const confirm = () => {
    const paths = Object.keys(selected);
    onConfirm(
      paths,
      paths.map((p) => selected[p]),
    );
  };

  const openRow = (row: PickedEntry) => {
    if (row.isDirectory && path) {
      setPath({ rootId: path.rootId, segments: [...path.segments, row.name] });
      setQuery("");
      return;
    }
    toggle(row);
  };

  const showRoots = tab === "folders" && !path;

  return (
    <>
      <BottomSheet open={open} onClose={onCancel} fullScreen>
        <div className="-mx-6 -my-5 flex h-full min-h-0 flex-col">
          <div className="shrink-0 space-y-3 border-b border-border/60 bg-surface px-4 pb-3 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  tab === "folders" && path
                    ? setPath(
                        path.segments.length
                          ? { rootId: path.rootId, segments: path.segments.slice(0, -1) }
                          : null,
                      )
                    : onCancel()
                }
                aria-label="Retour"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 active:scale-95 hover:bg-surface-2"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[17px] font-semibold leading-tight text-foreground">
                  {title}
                </h2>
                <p className="truncate text-[12px] text-muted-foreground">
                  {multi
                    ? "Sélectionnez un ou plusieurs fichiers, puis validez."
                    : "Touchez un fichier pour le sélectionner."}
                </p>
              </div>
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

            <div className="flex gap-1 rounded-2xl bg-surface-2 p-1">
              <TabButton active={tab === "category"} onClick={() => setTab("category")}>
                {CATEGORY_LABEL[kind]}
              </TabButton>
              <TabButton active={tab === "folders"} onClick={() => setTab("folders")}>
                Dossiers
              </TabButton>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground-2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher…"
                className="h-[52px] w-full rounded-2xl border border-transparent bg-input pl-11 pr-4 text-[15px] text-foreground outline-none transition-all duration-150 focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/20 placeholder:text-muted-foreground-2"
              />
            </div>

            {tab === "folders" && path ? (
              <p className="truncate text-[12px] text-muted-foreground">
                {roots.find((r) => r.id === path.rootId)?.label}
                {path.segments.length ? ` / ${path.segments.join(" / ")}` : ""}
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1">
            {showRoots ? (
              <RootList roots={roots} onPick={(id) => setPath({ rootId: id, segments: [] })} />
            ) : dirLoading && rows.length === 0 ? (
              <Empty>Chargement…</Empty>
            ) : dirError ? (
              <Empty>{dirError}</Empty>
            ) : rows.length === 0 ? (
              <Empty>
                {tab === "category" && !catReady
                  ? "Indexation en cours…"
                  : query
                    ? "Aucun résultat."
                    : "Aucun fichier compatible ici."}
              </Empty>
            ) : view === "grid" ? (
              <GridBody rows={rows} selected={selected} onOpen={openRow} onPreview={setPreview} />
            ) : (
              <ListBody rows={rows} selected={selected} onOpen={openRow} onPreview={setPreview} />
            )}
          </div>

          <div
            className="shrink-0 border-t border-border/60 bg-surface px-4 py-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {multi && selectedCount
                  ? `${selectedCount} fichier(s) sélectionné(s)`
                  : `${rows.length} élément(s)`}
              </span>
              {multi && selectedCount ? (
                <PdfButton variant="ghost" onClick={() => setSelected({})}>
                  Tout effacer
                </PdfButton>
              ) : null}
              {multi ? (
                <PdfButton onClick={confirm} disabled={selectedCount === 0}>
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

      {preview ? <PreviewOverlay entry={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 flex-1 rounded-xl text-[13px] font-semibold transition-all duration-150 active:scale-[0.98] ${
        active ? "bg-surface text-foreground shadow-soft" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}

function RootList({
  roots,
  onPick,
}: {
  roots: StorageRoot[];
  onPick: (id: StorageRootId) => void;
}) {
  return (
    <ul className="h-full overflow-y-auto overscroll-contain px-4 py-2">
      {roots
        .filter((r) => r.available)
        .map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onPick(r.id)}
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
                  <span className="block truncate text-[12px] text-muted-foreground">{r.hint}</span>
                ) : null}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
            </button>
          </li>
        ))}
    </ul>
  );
}

function ListBody({
  rows,
  selected,
  onOpen,
  onPreview,
}: {
  rows: PickedEntry[];
  selected: Record<string, FileEntry>;
  onOpen: (row: PickedEntry) => void;
  onPreview: (row: PickedEntry) => void;
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
          const isSel = !!selected[row.absolutePath];
          return (
            <div
              key={row.absolutePath}
              className="absolute left-0 top-0 w-full"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
            >
              <button
                type="button"
                onClick={() => onOpen(row)}
                className={`flex h-full w-full items-center gap-3 rounded-2xl px-2 text-left transition-colors active:bg-secondary/40 ${
                  isSel ? "bg-primary/10" : ""
                }`}
              >
                {row.isDirectory ? (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground">
                    <Folder className="h-5 w-5" />
                  </span>
                ) : (
                  <FileIcon kind={row.kind} path={row.absolutePath} size="sm" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-foreground">{row.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {row.isDirectory ? "Dossier" : formatSize(row.size)}
                  </span>
                </span>
                {row.isDirectory ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                ) : (
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isSel
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
              {!row.isDirectory && row.kind === "image" ? (
                <button
                  type="button"
                  aria-label={`Aperçu de ${row.name}`}
                  onClick={() => onPreview(row)}
                  className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              ) : null}
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
  onOpen,
  onPreview,
}: {
  rows: PickedEntry[];
  selected: Record<string, FileEntry>;
  onOpen: (row: PickedEntry) => void;
  onPreview: (row: PickedEntry) => void;
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
                const isSel = !!selected[row.absolutePath];
                return (
                  <div
                    key={row.absolutePath}
                    className={`relative overflow-hidden rounded-2xl border transition-all duration-150 ${
                      isSel ? "border-primary ring-2 ring-primary/30" : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(row)}
                      className="flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-2 p-1 transition-transform duration-150 active:scale-[0.98]"
                    >
                      {row.isDirectory ? (
                        <Folder className="h-7 w-7 text-muted-foreground" />
                      ) : (
                        <FileIcon kind={row.kind} path={row.absolutePath} size="lg" />
                      )}
                      <span className="line-clamp-2 w-full px-1 text-center text-[10px] leading-tight text-muted-foreground">
                        {row.name}
                      </span>
                    </button>
                    {isSel ? (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                    {!row.isDirectory && row.kind === "image" ? (
                      <button
                        type="button"
                        aria-label={`Aperçu de ${row.name}`}
                        onClick={() => onPreview(row)}
                        className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
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
