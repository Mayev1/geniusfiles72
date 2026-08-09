/**
 * Organisation intelligente — page principale.
 *
 * - Lance un scan à l'arrivée (ou réutilise le cache) ;
 * - présente les recommandations avec explication « Pourquoi ? » ;
 * - propose Aperçu, Renommage, Collections dynamiques ;
 * - exécute exclusivement des actions confirmées, via le pipeline
 *   d'opérations partagé (donc historique + Corbeille assurent
 *   l'annulation).
 *
 * 100 % local et hors connexion.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Info,
  Layers,
  ListTree,
  Loader2,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet, PrimaryButton } from "@/components/files/BottomSheet";
import { ConfirmDialog as SharedConfirmDialog } from "@/components/common/ConfirmDialog";
import { countLabel, formatCount } from "@/lib/copy";
import { errorMessage } from "@/lib/errors/humanize";
import { OrganizerPreview } from "@/components/organizer/OrganizerPreview";
import { RenameProposalSheet } from "@/components/organizer/RenameProposalSheet";
import { formatSize } from "@/lib/files/format";
import {
  buildPreview,
  categoryOf,
  evalCollection,
  executePlan,
  getCachedRecommendations,
  getCachedReport,
  listCollections,
  proposeBatchRename,
  refreshOrganization,
  subscribeOrganizer,
  summarizeActions,
} from "@/lib/organizer";
import type {
  CollectionMatch,
  OrgPlan,
  OrgPreview,
  OrgRecommendation,
  OrgReport,
  RenameProposal,
  SmartCollection,
} from "@/lib/organizer";

export const Route = createFileRoute("/organisation")({
  head: () => ({
    meta: [
      { title: "Organisation intelligente — GeniusFiles" },
      {
        name: "description",
        content:
          "Analyse locale du rangement de vos fichiers : recommandations claires, aperçu avant application, renommage intelligent et collections dynamiques.",
      },
      { property: "og:title", content: "Organisation intelligente — GeniusFiles" },
      {
        property: "og:description",
        content:
          "Comprenez comment vos fichiers sont rangés et améliorez-les en un geste — sans jamais rien perdre.",
      },
    ],
  }),
  component: OrganizationPage,
});

const ROOT = [{ rootId: "internal" as const, segments: [] }];

function OrganizationPage() {
  const [report, setReport] = useState<OrgReport | null>(() => getCachedReport());
  const [recs, setRecs] = useState<OrgRecommendation[] | null>(() => getCachedRecommendations());
  const [scanning, setScanning] = useState(false);
  const [tick, setTick] = useState(0);

  const [previewFor, setPreviewFor] = useState<{
    plan: OrgPlan;
    preview: OrgPreview | null;
    loading: boolean;
    reason: string;
  } | null>(null);
  const [renaming, setRenaming] = useState<{ proposals: RenameProposal[] } | null>(null);
  const [applyingRenames, setApplyingRenames] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState<OrgPlan | null>(null);
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
    label?: string;
  } | null>(null);
  const [openCollection, setOpenCollection] = useState<SmartCollection | null>(null);
  const [collectionMatch, setCollectionMatch] = useState<CollectionMatch | null>(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const collectionCtrl = useRef<AbortController | null>(null);
  const scanCtrl = useRef<AbortController | null>(null);

  useEffect(() => subscribeOrganizer(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    setReport(getCachedReport());
    setRecs(getCachedRecommendations());
  }, [tick]);

  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    scanCtrl.current?.abort();
    scanCtrl.current = new AbortController();
    try {
      const { report, recommendations } = await refreshOrganization(ROOT, scanCtrl.current.signal);
      setReport(report);
      setRecs(recommendations);
    } catch (err) {
      toast.error("L'analyse du rangement a échoué", {
        description: errorMessage(err, "Impossible d'analyser vos fichiers pour le moment."),
      });
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  // Premier scan à l'arrivée si aucun cache.
  useEffect(() => {
    if (!getCachedReport()) void runScan();
    return () => scanCtrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collections = useMemo(() => listCollections(), []);

  const openPreview = useCallback(async (rec: OrgRecommendation) => {
    if (rec.plan.actions.length === 0) {
      toast.message(rec.title, { description: rec.why });
      return;
    }
    setPreviewFor({ plan: rec.plan, preview: null, loading: true, reason: rec.why });
    try {
      const preview = await buildPreview(rec.plan);
      setPreviewFor({ plan: rec.plan, preview, loading: false, reason: rec.why });
    } catch (err) {
      setPreviewFor(null);
      toast.error("Aperçu indisponible", {
        description: errorMessage(err, "Impossible de préparer l'aperçu de ce rangement."),
      });
    }
  }, []);

  const runApplyPlan = useCallback(
    async (plan: OrgPlan) => {
      setConfirmPlan(null);
      setPreviewFor(null);
      setProgress({ processed: 0, total: plan.actions.length });
      const ctrl = new AbortController();
      try {
        const res = await executePlan(plan, {
          signal: ctrl,
          onProgress: (p) =>
            setProgress({ processed: p.processed, total: p.total, label: p.currentLabel }),
        });
        if (res.cancelled) {
          toast.info("Rangement interrompu", {
            description: "Aucune autre modification ne sera appliquée.",
          });
        } else if (res.failed.length === 0) {
          toast.success("Rangement terminé", {
            description: `${countLabel(res.applied, "action appliquée", "actions appliquées")}. Vous pouvez tout annuler depuis l'historique.`,
          });
        } else {
          toast.warning("Rangement partiel", {
            description: `${countLabel(res.applied, "action appliquée", "actions appliquées")}, ${countLabel(res.failed.length, "échec")} — ${res.failed[0].reason}`,
          });
        }
        await runScan();
      } catch (err) {
        toast.error("Le rangement a échoué", {
          description: errorMessage(err, "Impossible d'appliquer ce rangement pour le moment."),
        });
      } finally {
        setProgress(null);
      }
    },
    [runScan],
  );

  const openRenamer = useCallback(() => {
    if (!report) return;
    const entries = report.issues
      .filter((i) => i.kind === "unclear_name" && i.entries)
      .flatMap((i) => (i.entries ?? []).map((e) => ({ entry: e, parent: i.path })));
    const proposals = proposeBatchRename(entries);
    if (proposals.length === 0) {
      toast.message("Aucun renommage à proposer", {
        description: "Les noms de vos fichiers sont déjà clairs, rien à améliorer ici.",
      });
      return;
    }
    setRenaming({ proposals });
  }, [report]);

  const applyRenames = useCallback(
    async (accepted: RenameProposal[]) => {
      setRenaming(null);
      setApplyingRenames(true);
      const plan: OrgPlan = {
        id: `plan_rename_${Date.now()}`,
        title: "Renommage intelligent",
        description: `${accepted.length} fichier(s)`,
        destructive: true,
        actions: accepted.map((p) => ({
          kind: "rename",
          parent: p.parent,
          from: p.entryName,
          to: p.proposed,
          reason: p.reason,
        })),
      };
      await runApplyPlan(plan);
      setApplyingRenames(false);
    },
    [runApplyPlan],
  );

  const openCollectionSheet = useCallback(async (col: SmartCollection) => {
    setOpenCollection(col);
    setCollectionMatch(null);
    setCollectionLoading(true);
    collectionCtrl.current?.abort();
    const ctrl = new AbortController();
    collectionCtrl.current = ctrl;
    try {
      const m = await evalCollection(col.id, ROOT, ctrl.signal);
      if (!ctrl.signal.aborted) setCollectionMatch(m);
    } finally {
      if (!ctrl.signal.aborted) setCollectionLoading(false);
    }
  }, []);

  const distribution = useMemo(() => {
    if (!report) return [];
    return Object.entries(report.distribution)
      .map(([id, v]) => ({ id, ...v!, label: categoryOf(id as never).label }))
      .filter((d) => d.count > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 6);
  }, [report]);

  return (
    <AppShell>
      {/* Hero */}
      <section className="card-surface p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold">Organisation intelligente</h1>
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
              Analyse locale de votre rangement. Aucune modification sans votre accord.
            </p>
          </div>
          <button
            type="button"
            onClick={runScan}
            aria-label="Relancer l'analyse"
            className="rounded-lg border border-border bg-surface p-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat
            label="Réorganisable"
            value={formatSize(report?.reorganizableBytes ?? 0)}
            highlight
          />
          <Stat label="Recommandations" value={String(recs?.length ?? 0)} />
          <Stat
            label="Fichiers analysés"
            value={(report?.scannedFiles ?? 0).toLocaleString("fr-FR")}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openRenamer}
            disabled={!report}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-50"
          >
            <PencilLine className="h-3.5 w-3.5" /> Renommage intelligent
          </button>
        </div>
      </section>

      {/* Recommandations */}
      <SectionHeader title="Recommandations" hint="Chaque action explique son intérêt." />
      {scanning && !recs ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 text-[12px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analyse de votre rangement en cours…
        </div>
      ) : recs && recs.length > 0 ? (
        <div className="space-y-2">
          {recs.map((r) => (
            <RecommendationCard key={r.id} rec={r} onOpen={openPreview} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="Votre rangement est déjà clair"
          description="Aucune amélioration à vous proposer pour l'instant. Relancez l'analyse après avoir ajouté de nouveaux fichiers."
          action={
            <button type="button" onClick={runScan} className="btn-secondary gf-press">
              Relancer l'analyse
            </button>
          }
        />
      )}

      {/* Distribution */}
      {distribution.length > 0 ? (
        <>
          <SectionHeader title="Distribution actuelle" hint="Top catégories de votre stockage." />
          <div className="grid grid-cols-2 gap-2">
            {distribution.map((d) => (
              <div key={d.id} className="card-surface flex items-center gap-2 p-3">
                <Layers className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{d.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {d.count} · {formatSize(d.bytes)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Collections dynamiques */}
      <SectionHeader
        title="Collections dynamiques"
        hint="Vues virtuelles — n'altèrent aucun fichier."
      />
      <div className="grid grid-cols-2 gap-2">
        {collections.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => openCollectionSheet(c)}
            className="card-surface flex items-center gap-2 p-3 text-left transition-transform active:scale-[0.97]"
          >
            <ListTree className="h-4 w-4 text-primary" />
            <span className="flex-1 text-[12px] font-medium">{c.label}</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        ))}
      </div>

      {/* Aperçu du plan */}
      <BottomSheet
        open={!!previewFor}
        onClose={() => setPreviewFor(null)}
        title={previewFor?.plan.title ?? "Aperçu"}
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={() => setPreviewFor(null)}>
              Fermer
            </PrimaryButton>
            {previewFor && previewFor.plan.actions.length > 0 ? (
              <PrimaryButton onClick={() => setConfirmPlan(previewFor.plan)}>
                Appliquer
              </PrimaryButton>
            ) : null}
          </>
        }
      >
        {previewFor ? (
          <>
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-[12px]">
              <Info className="h-4 w-4 shrink-0 text-primary" />
              <span>{previewFor.reason}</span>
            </div>
            <PlanSummary plan={previewFor.plan} />
            {previewFor.loading ? (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Calcul de l'aperçu…
              </div>
            ) : previewFor.preview ? (
              <div className="mt-3">
                <OrganizerPreview preview={previewFor.preview} />
              </div>
            ) : null}
          </>
        ) : null}
      </BottomSheet>

      {/* Renommage */}
      <RenameProposalSheet
        open={!!renaming}
        proposals={renaming?.proposals ?? []}
        onClose={() => setRenaming(null)}
        onApply={applyRenames}
      />

      {/* Confirmation d'application */}
      <SharedConfirmDialog
        open={!!confirmPlan}
        copy={{
          title: "Appliquer ce rangement ?",
          description: confirmPlan
            ? `${summaryText(confirmPlan)} Vous pourrez tout annuler depuis l'historique ou la corbeille.`
            : "",
          confirmLabel: "Appliquer",
        }}
        onCancel={() => setConfirmPlan(null)}
        onConfirm={() => {
          if (confirmPlan) void runApplyPlan(confirmPlan);
        }}
      />

      {/* Progression */}
      <BottomSheet
        open={!!progress || applyingRenames}
        onClose={() => {}}
        title="Rangement en cours"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px] text-muted-foreground">
            <span className="truncate">{progress?.label ?? "Préparation du rangement…"}</span>
            <span>{progress ? `${progress.processed}/${progress.total}` : ""}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{
                width:
                  progress && progress.total > 0
                    ? `${Math.round((progress.processed / progress.total) * 100)}%`
                    : "0%",
              }}
            />
          </div>
        </div>
      </BottomSheet>

      {/* Collection viewer */}
      <BottomSheet
        open={!!openCollection}
        onClose={() => {
          collectionCtrl.current?.abort();
          setOpenCollection(null);
          setCollectionMatch(null);
        }}
        title={openCollection?.label ?? "Collection"}
      >
        {collectionLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Recherche des fichiers correspondants…
          </div>
        ) : collectionMatch ? (
          collectionMatch.entries.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Aucun fichier ne correspond à cette collection pour l'instant. Elle se remplira
              automatiquement dès que des fichiers correspondants apparaîtront.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-muted-foreground">
                {countLabel(collectionMatch.entries.length, "fichier")} —{" "}
                {formatSize(collectionMatch.totalBytes)}
              </p>
              <ul className="max-h-[52vh] space-y-1 overflow-y-auto">
                {collectionMatch.entries.slice(0, 200).map(({ entry, parent }) => (
                  <li
                    key={`${parent.rootId}:${parent.segments.join("/")}/${entry.name}`}
                    className="rounded-lg border border-border bg-surface p-2"
                  >
                    <p className="truncate text-[12px] font-medium">{entry.name}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      /{parent.segments.join("/")}
                    </p>
                  </li>
                ))}
              </ul>
              {collectionMatch.entries.length > 200 ? (
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Aperçu limité aux 200 premiers résultats sur{" "}
                  {formatCount(collectionMatch.entries.length)}.
                </p>
              ) : null}
            </>
          )
        ) : null}
      </BottomSheet>
    </AppShell>
  );
}

function RecommendationCard({
  rec,
  onOpen,
}: {
  rec: OrgRecommendation;
  onOpen: (r: OrgRecommendation) => void;
}) {
  const Icon =
    rec.severity === "danger" ? AlertTriangle : rec.severity === "warn" ? AlertTriangle : Sparkles;
  const tone =
    rec.severity === "danger"
      ? "bg-red-500/12 text-red-400"
      : rec.severity === "warn"
        ? "bg-amber-500/12 text-amber-400"
        : "bg-primary/12 text-primary";
  return (
    <button
      type="button"
      onClick={() => onOpen(rec)}
      className="card-surface flex w-full items-start gap-3 p-3 text-left transition-transform active:scale-[0.99]"
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{rec.title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium">Pourquoi ?</span> {rec.why}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium">
        {rec.cta}
      </span>
    </button>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-2 ${
        highlight ? "border-primary/40 bg-primary/8" : "border-border bg-surface"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold">{value}</p>
    </div>
  );
}

function PlanSummary({ plan }: { plan: OrgPlan }) {
  const s = summarizeActions(plan.actions);
  const parts = [
    s.renames > 0 ? countLabel(s.renames, "renommage") : null,
    s.moves > 0 ? countLabel(s.moves, "déplacement") : null,
    s.groups > 0 ? countLabel(s.groups, "regroupement") : null,
    s.archives > 0 ? countLabel(s.archives, "archivage") : null,
  ].filter(Boolean);
  return (
    <p className="text-[12px] text-muted-foreground">
      {parts.length ? parts.join(" · ") : "Aucune action à appliquer."}
    </p>
  );
}

function summaryText(plan: OrgPlan): string {
  const s = summarizeActions(plan.actions);
  const total = s.renames + s.moves + s.groups + s.archives;
  if (total === 0) return "Aucune action ne sera appliquée.";
  return `${countLabel(total, "action")} seront appliquées sur vos fichiers.`;
}
