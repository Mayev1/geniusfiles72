/**
 * Nettoyeur intelligent — main route.
 *
 * Runs a non-blocking BFS scan of the primary internal storage root,
 * classifies items into 8 clean-up categories, and lets the user
 * review every proposed item before confirming any deletion.
 *
 * Deletions are soft (move to Trash on Android) and go through the
 * shared operations pipeline, so history/undo and the dashboard event
 * bus stay consistent. Nothing is removed automatically.
 *
 * Deletions go through the shared operations pipeline so history/undo
 * and the dashboard event bus stay consistent.

 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Copy,
  FileArchive,
  FileWarning,
  FolderX,
  MessageCircle,
  Package,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ListSkeleton } from "@/components/ui/states";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet, PrimaryButton } from "@/components/files/BottomSheet";
import { ConfirmDialog as SharedConfirmDialog } from "@/components/common/ConfirmDialog";
import { useConfirm } from "@/components/common/useConfirm";
import { confirmCopy, countLabel, freedLabel, progressLabel } from "@/lib/copy";
import { errorMessage } from "@/lib/errors/humanize";
import { FileIcon } from "@/components/files/FileIcon";
import { formatSize } from "@/lib/files/format";
import { scanCleanup } from "@/lib/cleaner/scanner";
import { runCleanup, type CleanupProgress } from "@/lib/cleaner/deleter";
import type {
  CleanCategory,
  CleanCategoryKey,
  CleanItem,
  CleanScanResult,
} from "@/lib/cleaner/types";
import { checkStoragePermission } from "@/lib/native/storage-permission";
import { useRoots } from "@/lib/fs/useRoots";
import { StorageScopePicker, type StorageScope } from "@/components/common/StorageScopePicker";
import { resolveScope } from "@/components/common/storage-scope";

export const Route = createFileRoute("/nettoyeur")({
  head: () => ({
    meta: [
      { title: "Nettoyeur intelligent — GeniusFiles" },
      {
        name: "description",
        content:
          "Analyse fiable et transparente du stockage : doublons, fichiers volumineux, téléchargements anciens, APK inutilisés et plus.",
      },
    ],
  }),
  component: CleanerPage,
});

const CATEGORY_ORDER: CleanCategoryKey[] = [
  "duplicates",
  "large",
  "old_downloads",
  "apk",
  "messaging_media",
  "extracted_archives",
  "temp",
  "empty_folders",
];

const CATEGORY_ICONS: Record<CleanCategoryKey, typeof Copy> = {
  duplicates: Copy,
  large: FileWarning,
  old_downloads: CalendarClock,
  empty_folders: FolderX,
  temp: Trash2,
  extracted_archives: FileArchive,
  apk: Package,
  messaging_media: MessageCircle,
};

function CleanerPage() {
  const [scan, setScan] = useState<CleanScanResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [tick, setTick] = useState(0);
  const [permission, setPermission] = useState<"granted" | "denied" | "unavailable">("unavailable");
  const [openCategory, setOpenCategory] = useState<CleanCategoryKey | null>(null);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [progress, setProgress] = useState<CleanupProgress | null>(null);
  const { roots } = useRoots();
  const [scope, setScope] = useState<StorageScope>("internal");

  useEffect(() => {
    let mounted = true;
    checkStoragePermission().then((p) => mounted && setPermission(p));
    return () => {
      mounted = false;
    };
  }, [tick]);

  // Kick off scan.
  useEffect(() => {
    setScanning(true);
    setScan(null);
    const targets = resolveScope(scope, roots).map((rootId) => ({
      rootId,
      segments: [] as string[],
    }));
    const handle = scanCleanup(
      targets,
      (partial) => setScan({ ...partial }),
      (result) => {
        setScan(result);
        setScanning(false);
      },
    );
    return () => handle.cancel();
  }, [tick, scope, roots]);

  const totalReclaimable = scan?.totalBytes ?? 0;
  const totalItems = scan?.totalItems ?? 0;

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const set of Object.values(selection)) for (const id of set) ids.add(id);
    return ids;
  }, [selection]);

  const selectedItems = useMemo(() => {
    if (!scan) return [] as CleanItem[];
    const out: CleanItem[] = [];
    for (const c of Object.values(scan.categories)) {
      for (const it of c.items) if (selectedIds.has(it.id)) out.push(it);
    }
    return out;
  }, [scan, selectedIds]);

  const selectedBytes = useMemo(
    () => selectedItems.reduce((s, i) => s + (i.entry.size ?? 0), 0),
    [selectedItems],
  );

  const toggleItem = useCallback((catKey: CleanCategoryKey, id: string) => {
    setSelection((prev) => {
      const cur = new Set(prev[catKey] ?? []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      return { ...prev, [catKey]: cur };
    });
  }, []);

  const toggleCategoryAll = useCallback((cat: CleanCategory, selectAll: boolean) => {
    setSelection((prev) => {
      const next = new Set<string>();
      if (selectAll) for (const it of cat.items) next.add(it.id);
      return { ...prev, [cat.key]: next };
    });
  }, []);

  const doCleanup = useCallback(async () => {
    if (!selectedItems.length) return;
    setConfirming(false);
    setCleaning(true);
    setProgress({ processed: 0, total: selectedItems.length, bytes: 0, totalBytes: selectedBytes });
    try {
      const res = await runCleanup(selectedItems, (p) => setProgress(p));
      if (res.failed) {
        toast.warning("Nettoyage partiel", {
          description: `${countLabel(res.removed, "élément")} déplacés vers la corbeille, ${countLabel(res.failed, "élément")} n'ont pas pu être traités. ${freedLabel(res.reclaimedBytes)} libérés.`,
        });
      } else {
        toast.success("Nettoyage terminé", {
          description: `${freedLabel(res.reclaimedBytes)} libérés — ${countLabel(res.removed, "élément")} déplacés vers la corbeille. Vous pouvez les restaurer tant qu'elle n'est pas vidée.`,
        });
      }
      setSelection({});
      setOpenCategory(null);
      setTick((t) => t + 1);
    } catch (err) {
      toast.error("Le nettoyage a échoué", {
        description: errorMessage(err, "Une erreur est survenue pendant le nettoyage."),
      });
    } finally {
      setCleaning(false);
      setProgress(null);
    }
  }, [selectedItems, selectedBytes]);

  const activeCategory = openCategory && scan ? scan.categories[openCategory] : null;

  /* Répartition de l'espace récupérable par catégorie — visualisation
     immédiate de « où » se trouve le gain, avant toute action. */
  const shares = useMemo(() => {
    if (!scan || totalReclaimable <= 0) return [];
    return CATEGORY_ORDER.map((key) => scan.categories[key])
      .filter((c) => c.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .map((c) => ({
        key: c.key,
        label: c.label,
        bytes: c.bytes,
        pct: Math.max(2, Math.round((c.bytes / totalReclaimable) * 100)),
      }));
  }, [scan, totalReclaimable]);

  return (
    <AppShell>
      <PageHeader
        title="Nettoyeur"
        subtitle="Analyse locale · rien n'est supprimé sans votre accord"
        action={
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            aria-label="Relancer l'analyse"
            className="gf-press flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-[18px] w-[18px] ${scanning ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="pt-3">
        <StorageScopePicker roots={roots} value={scope} onChange={setScope} />
      </div>

      {/* Statistiques principales — gain de stockage mis en avant */}
      <div className="gf-card mt-3 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Espace récupérable
            </p>
            <p className="mt-1.5 truncate font-display text-[36px] font-bold leading-none text-primary">
              {formatSize(totalReclaimable)}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary-softer px-2.5 py-1 text-[11px] font-semibold text-primary">
            {scanning ? "Analyse…" : "Prêt"}
          </span>
        </div>

        {/* Barre de répartition par catégorie */}
        {shares.length > 0 ? (
          <>
            <div className="mt-3.5 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
              {shares.map((s, i) => (
                <span
                  key={s.key}
                  className="h-full"
                  style={{
                    width: `${s.pct}%`,
                    opacity: 1 - Math.min(0.6, i * 0.12),
                    background: "var(--color-primary, hsl(var(--primary)))",
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {shares.slice(0, 4).map((s) => (
                <span
                  key={s.key}
                  className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <span className="truncate">{s.label}</span>
                  <span className="shrink-0 font-semibold text-foreground">
                    {formatSize(s.bytes)}
                  </span>
                </span>
              ))}
            </div>
          </>
        ) : null}

        <div className="mt-3.5 grid grid-cols-2 gap-3">
          <div className="min-w-0 rounded-2xl bg-surface-2 px-3 py-2.5">
            <p className="text-[17px] font-semibold leading-none">
              {totalItems.toLocaleString("fr-FR")}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              élément{totalItems > 1 ? "s" : ""} détecté{totalItems > 1 ? "s" : ""}
            </p>
          </div>
          <div className="min-w-0 rounded-2xl bg-surface-2 px-3 py-2.5">
            <p className="text-[17px] font-semibold leading-none">
              {(scan?.scannedFolders ?? 0).toLocaleString("fr-FR")}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">dossiers analysés</p>
          </div>
        </div>

        {scanning ? (
          <div className="mt-3.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {progressLabel("Analyse", undefined, scan?.scannedFiles ?? 0)}
            </p>
          </div>
        ) : null}
      </div>

      {permission === "denied" ? (
        <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            L'accès complet aux fichiers n'est pas encore accordé. Certaines catégories peuvent être
            incomplètes.
          </span>
        </div>
      ) : null}

      <SectionHeader title="Catégories" hint="Passez en revue avant d'agir" />

      {scan == null ? (
        <ListSkeleton rows={4} />
      ) : totalItems === 0 && !scanning ? (
        <EmptyState
          icon={Sparkles}
          title="Rien à nettoyer pour l'instant"
          description="Aucun doublon, cache ou fichier inutile détecté sur cet emplacement. Relancez l'analyse après avoir ajouté des fichiers, ou changez d'emplacement à analyser."
        />
      ) : (
        <div className="gf-card divide-y divide-border/60">
          {CATEGORY_ORDER.map((key) => {
            const cat = scan.categories[key];
            if (!cat.items.length && !scanning) return null;
            const Icon = CATEGORY_ICONS[key];
            const selectedCount = selection[key]?.size ?? 0;
            const empty = cat.items.length === 0;
            return (
              <button
                key={key}
                type="button"
                disabled={empty}
                onClick={() => setOpenCategory(key)}
                className="gf-row hover:bg-secondary/40"
              >
                <span className="gf-icon-tile bg-primary-softer text-primary">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="gf-row-title truncate">{cat.label}</p>
                    {selectedCount > 0 ? (
                      <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {selectedCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="gf-row-meta truncate">
                    {cat.items.length.toLocaleString("fr-FR")} élément
                    {cat.items.length > 1 ? "s" : ""}
                  </p>
                </div>
                <span className="shrink-0 text-right">
                  <span className="block text-[14px] font-semibold text-primary">
                    {formatSize(cat.bytes)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">à libérer</span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground/60" />
              </button>
            );
          })}
        </div>
      )}

      {/* Category review sheet */}
      <CategorySheet
        open={!!activeCategory}
        category={activeCategory}
        selection={activeCategory ? (selection[activeCategory.key] ?? new Set()) : new Set()}
        onToggle={(id) => activeCategory && toggleItem(activeCategory.key, id)}
        onSelectAll={(all) => activeCategory && toggleCategoryAll(activeCategory, all)}
        onClose={() => setOpenCategory(null)}
      />

      {/* Barre d'action collante — disposition en grille : les libellés
          ne peuvent plus déborder sur les écrans étroits. */}
      {selectedIds.size > 0 && !cleaning ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-40 mx-auto flex max-w-[520px] justify-center px-3">
          <div className="glass-panel animate-in-up pointer-events-auto w-full rounded-3xl border border-border-strong p-2.5 shadow-soft">
            <div className="mb-2 min-w-0 px-1">
              <p className="truncate text-[13.5px] font-semibold leading-tight">
                {countLabel(selectedIds.size, "élément sélectionné", "éléments sélectionnés")}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {freedLabel(selectedBytes)} à libérer
              </p>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
              <button
                type="button"
                onClick={() => setSelection({})}
                className="gf-press h-11 rounded-2xl bg-surface-2 px-3.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Désélectionner
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="gf-press flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-2xl bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground shadow-soft"
              >
                <Play className="h-4 w-4 shrink-0" />
                <span className="truncate">Nettoyer · {freedLabel(selectedBytes)}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SharedConfirmDialog
        open={confirming}
        copy={confirmCopy.clean(selectedBytes, selectedIds.size)}
        busy={cleaning}
        onCancel={() => setConfirming(false)}
        onConfirm={doCleanup}
      />

      {/* Progress sheet during cleanup */}
      <BottomSheet open={cleaning} onClose={() => {}} title="Nettoyage en cours">
        <div className="mb-2 flex items-center justify-between text-[12px] text-muted-foreground">
          <span className="truncate pr-2">
            {progress?.currentName ?? "Préparation du nettoyage…"}
          </span>
          <span className="shrink-0 font-mono text-[11px]">
            {progress
              ? Math.min(
                  100,
                  Math.round(progress.total > 0 ? (progress.processed / progress.total) * 100 : 0),
                )
              : 0}
            %
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{
              width: `${progress ? Math.min(100, (progress.processed / Math.max(1, progress.total)) * 100) : 0}%`,
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {progress
              ? countLabel(progress.processed, "élément") + ` sur ${progress.total}`
              : "Préparation…"}
          </span>
          <span>
            {progress ? `${formatSize(progress.bytes)} / ${formatSize(progress.totalBytes)}` : ""}
          </span>
        </div>
      </BottomSheet>
    </AppShell>
  );
}

/* --------- Sub-components --------- */

function CategorySheet({
  open,
  category,
  selection,
  onToggle,
  onSelectAll,
  onClose,
}: {
  open: boolean;
  category: CleanCategory | null;
  selection: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (all: boolean) => void;
  onClose: () => void;
}) {
  if (!category) {
    return (
      <BottomSheet open={open} onClose={onClose} title="Catégorie">
        <div className="text-[12px] text-muted-foreground">Aucune donnée.</div>
      </BottomSheet>
    );
  }
  const allSelected = selection.size === category.items.length && category.items.length > 0;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={category.label}
      footer={
        <>
          <PrimaryButton variant="ghost" onClick={onClose}>
            <span className="flex items-center gap-1">
              <ArrowLeft className="h-3.5 w-3.5" /> Retour
            </span>
          </PrimaryButton>
          <PrimaryButton onClick={() => onSelectAll(!allSelected)}>
            {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
          </PrimaryButton>
        </>
      }
    >
      <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
        {category.description}
      </p>
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {category.items.length} élément{category.items.length > 1 ? "s" : ""}
        </span>
        <span>{formatSize(category.bytes)} récupérable</span>
      </div>
      <ul className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
        {category.items.map((item) => {
          const checked = selection.has(item.id);
          const path = item.parent.segments.length > 0 ? `/${item.parent.segments.join("/")}` : "/";
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onToggle(item.id)}
                className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                  checked
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-surface/60 hover:border-border-strong"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface"
                  }`}
                >
                  {checked ? "✓" : ""}
                </span>
                <FileIcon kind={item.entry.kind} size="sm" path={item.entry.path} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{item.entry.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {item.reason} · {path}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatSize(item.entry.size)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
