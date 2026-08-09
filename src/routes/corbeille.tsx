/**
 * GeniusFiles — Corbeille (Trash) route.
 *
 * Central safety net for every deletion performed inside the app. Every
 * item deleted via the file explorer, the cleaner or any future module
 * lands here first; from this screen the user can restore selected
 * entries to their original folder, pick a new destination when the
 * origin no longer exists, or definitively free space by emptying the
 * trash.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckSquare,
  Clock,
  FolderOpen,
  Loader2,
  MoreVertical,
  RefreshCw,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";

import { toast } from "sonner";
import { IllustratedEmptyState } from "@/components/ui/IllustratedEmptyState";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/navigation/BackButton";
import { BACK_PRIORITY, useBackHandler } from "@/lib/navigation/back-stack";
import { ListSkeleton } from "@/components/ui/states";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { BottomSheet, PrimaryButton, ConfirmDialog } from "@/components/files/BottomSheet";
import { DestinationPicker } from "@/components/files/DestinationPicker";
import { FileIcon } from "@/components/files/FileIcon";
import { toAbsolutePath } from "@/lib/files/fs";
import { formatSize, formatDate, kindOf } from "@/lib/files/format";
import {
  emptyTrash,
  listTrashItems,
  permanentDelete,
  restoreItems,
  type TrashItem,
  type RestoreOutcome,
  trashAbsPath,
} from "@/lib/files/trash";
import type { PathRef } from "@/lib/files/types";
import { confirmCopy, freedLabel } from "@/lib/copy";

export const Route = createFileRoute("/corbeille")({
  head: () => ({
    meta: [
      { title: "Corbeille — GeniusFiles" },
      {
        name: "description",
        content:
          "Retrouvez et restaurez les fichiers supprimés, ou libérez de l'espace en supprimant définitivement.",
      },
    ],
  }),
  component: TrashPage,
});

function formatCountdown(ms?: number): string {
  if (ms == null) return "Conservation permanente";
  if (ms <= 0) return "Suppression imminente";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} jours restants`;
  if (days === 1) return "1 jour restant";
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `${hours}h restantes`;
}

function TrashPage() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [pickDestFor, setPickDestFor] = useState<TrashItem[] | null>(null);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  /* Retour Android : menu → sélection → écran précédent. */
  useBackHandler(
    menuOpen,
    () => {
      setMenuOpen(false);
      return true;
    },
    BACK_PRIORITY.overlay,
  );
  useBackHandler(
    pickDestFor != null,
    () => {
      setPickDestFor(null);
      return true;
    },
    BACK_PRIORITY.overlay,
  );
  useBackHandler(
    selected.size > 0,
    () => {
      setSelected(new Set());
      return true;
    },
    BACK_PRIORITY.mode,
  );

  const reload = useCallback(async () => {
    const res = await listTrashItems();
    setItems(res.items);
    setTotalBytes(res.totalBytes);
    setSelected((prev) => {
      const stillThere = new Set(res.items.map((i) => i.id));
      return new Set(Array.from(prev).filter((id) => stillThere.has(id)));
    });
  }, []);

  useEffect(() => {
    reload();
    if (typeof window === "undefined") return;
    const handler = () => reload();
    window.addEventListener("gf:trash-changed", handler);
    return () => window.removeEventListener("gf:trash-changed", handler);
  }, [reload]);

  const sortedItems = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => b.deletedAt - a.deletedAt);
  }, [items]);

  const allSelected = sortedItems.length > 0 && selected.size === sortedItems.length;
  const anySelected = selected.size > 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sortedItems.map((i) => i.id)));
  };

  const selectedItems = useMemo(
    () => sortedItems.filter((i) => selected.has(i.id)),
    [sortedItems, selected],
  );

  const anyOrphan = selectedItems.some((i) => i.originalParentExists === false);

  const runRestore = async (target?: PathRef) => {
    if (selectedItems.length === 0) return;
    setBusy(true);
    try {
      const res = await restoreItems(selectedItems, {
        targetPath: target ? toAbsolutePath(target) : undefined,
      });
      setOutcome(res);
      if (res.failed.length === 0) {
        toast.success(
          res.restored === 1 ? "Élément restauré" : `${res.restored} éléments restaurés`,
        );
      } else if (res.restored > 0) {
        toast.info(`${res.restored} restauré(s), ${res.failed.length} en échec`);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const onRestoreClick = () => {
    if (anyOrphan) {
      setPickDestFor(selectedItems);
      return;
    }
    setConfirmRestore(true);
  };

  const onPermanentDeleteClick = () => setConfirmPurge(true);

  const doPurgeSelected = async () => {
    setConfirmPurge(false);
    if (selectedItems.length === 0) return;
    setBusy(true);
    const freedBytes = selectedItems.reduce((acc, i) => acc + i.size, 0);
    try {
      const res = await permanentDelete(selectedItems);
      if (res.failed.length === 0) {
        toast.success(
          res.deleted === 1 ? "Élément supprimé" : `${res.deleted} éléments supprimés`,
          {
            description: `Suppression définitive · ${freedLabel(freedBytes)} libérés.`,
          },
        );
      } else {
        toast.info(`${res.deleted} supprimé(s), ${res.failed.length} en échec`);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const doEmpty = async () => {
    setConfirmEmpty(false);
    const freedBytes = totalBytes;
    setBusy(true);
    try {
      const res = await emptyTrash();
      toast.success("Corbeille vidée", {
        description: `${res.deleted} élément${res.deleted > 1 ? "s" : ""} supprimés définitivement · ${freedLabel(freedBytes)} libérés.`,
      });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      {/* En-tête compact — titre + tout sélectionner + menu contextuel */}
      <div className="flex items-center gap-2 pb-2">
        <BackButton className="gf-press flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-muted-foreground hover:text-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[20px] font-bold tracking-tight">
            {anySelected
              ? `${selected.size} sélectionné${selected.size > 1 ? "s" : ""}`
              : "Corbeille"}
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {items == null
              ? "Chargement…"
              : sortedItems.length === 0
                ? "Aucun élément"
                : `${sortedItems.length} élément${sortedItems.length > 1 ? "s" : ""} · ${formatSize(totalBytes)}`}
          </p>
        </div>
        {sortedItems.length > 0 ? (
          <button
            type="button"
            onClick={toggleAll}
            className="gf-press flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={allSelected ? "Tout désélectionner" : "Tout sélectionner"}
          >
            {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
        ) : null}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="gf-press flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Plus d'actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="glass-panel absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl shadow-soft"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  reload();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-secondary/60"
              >
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                Rafraîchir
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={sortedItems.length === 0 || busy}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmEmpty(true);
                }}
                className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2.5 text-left text-[13px] text-red-400 hover:bg-red-500/8 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Vider entièrement la Corbeille
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {items == null ? (
        <ListSkeleton rows={5} />
      ) : sortedItems.length === 0 ? (
        <IllustratedEmptyState
          id="trash"
          description="Les fichiers supprimés depuis GeniusFiles apparaîtront ici et pourront être restaurés."
        />
      ) : (
        <>
          <SectionHeader title="Éléments supprimés" hint="Les plus récents en premier" />
          <div className="gf-card divide-y divide-border/60">
            {sortedItems.map((it) => {
              const isSel = selected.has(it.id);
              const kind = kindOf(it.name, it.isDirectory);
              const parent = it.originalPath.split("/").slice(0, -1).join("/") || "—";
              const orphan = it.originalParentExists === false;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => toggle(it.id)}
                  className={`gf-row relative ${isSel ? "bg-primary-softer" : ""}`}
                >
                  {isSel ? (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                  ) : null}
                  {isSel ? (
                    <span className="gf-icon-tile bg-primary text-primary-foreground">
                      <Check className="h-5 w-5" />
                    </span>
                  ) : (
                    <FileIcon kind={kind} path={`${trashAbsPath()}/${it.id}`} />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="gf-row-title truncate">{it.name}</p>
                      {orphan ? (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-400">
                          Sans emplacement
                        </span>
                      ) : null}
                    </div>
                    <p className="gf-row-meta truncate">
                      <FolderOpen className="mr-1 inline h-3 w-3" />
                      {parent}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                      <span>{formatSize(it.size)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(it.deletedAt)}</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatCountdown(it.msUntilPurge)}
                      </span>
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Sticky selection bar */}
      {anySelected ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-40 flex justify-center px-3">
          <div className="glass-panel animate-in-up pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-3xl p-2 shadow-soft">
            <PrimaryButton variant="ghost" onClick={() => setSelected(new Set())}>
              Annuler
            </PrimaryButton>
            <div className="flex flex-1 gap-2">
              <PrimaryButton onClick={onRestoreClick} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <Undo2 className="h-4 w-4" />
                  Restaurer
                </span>
              </PrimaryButton>
              <PrimaryButton variant="danger" onClick={onPermanentDeleteClick} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <Trash2 className="h-4 w-4" />
                  Supprimer
                </span>
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmEmpty}
        title={confirmCopy.emptyTrash(sortedItems.length).title}
        description={confirmCopy.emptyTrash(sortedItems.length).description}
        confirmLabel={confirmCopy.emptyTrash(sortedItems.length).confirmLabel}
        danger
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={doEmpty}
      />

      <ConfirmDialog
        open={confirmPurge}
        title={confirmCopy.deleteForever(selectedItems.length).title}
        description={confirmCopy.deleteForever(selectedItems.length).description}
        confirmLabel={confirmCopy.deleteForever(selectedItems.length).confirmLabel}
        danger
        onCancel={() => setConfirmPurge(false)}
        onConfirm={doPurgeSelected}
      />

      <ConfirmDialog
        open={confirmRestore}
        title={confirmCopy.restore(selectedItems.length).title}
        description={confirmCopy.restore(selectedItems.length).description}
        confirmLabel={confirmCopy.restore(selectedItems.length).confirmLabel}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={async () => {
          setConfirmRestore(false);
          await runRestore();
        }}
      />

      <DestinationPicker
        open={pickDestFor !== null}
        title="Choisir un emplacement de restauration"
        initial={{ rootId: "internal", segments: [] }}
        onCancel={() => setPickDestFor(null)}
        onConfirm={(dest) => {
          setPickDestFor(null);
          void runRestore(dest);
        }}
      />

      <BottomSheet
        open={outcome !== null && (outcome?.failed.length ?? 0) > 0}
        onClose={() => setOutcome(null)}
      >
        {outcome ? (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-primary">
                <Undo2 className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Restauration terminée</p>
                <p className="text-[11px] text-muted-foreground">
                  {outcome.restored} restauré(s), {outcome.failed.length} en échec.
                </p>
              </div>
            </div>
            <ul className="max-h-56 overflow-auto rounded-xl border border-border bg-surface/60">
              {outcome.failed.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[12px] last:border-b-0"
                >
                  <span className="truncate">{f.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {f.reason === "PARENT_MISSING"
                      ? "Emplacement absent"
                      : f.reason === "MISSING"
                        ? "Introuvable"
                        : f.reason === "NO_TARGET"
                          ? "Destination inconnue"
                          : "Échec"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <PrimaryButton onClick={() => setOutcome(null)}>Fermer</PrimaryButton>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </AppShell>
  );
}
