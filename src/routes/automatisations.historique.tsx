/**
 * Historique complet des exécutions d'automatisations.
 *
 * Route dédiée (SEO + partage) qui reprend le journal `gf.automations.history`
 * et le compteur `runCount` de chaque règle. La page reste synchronisée avec
 * le reste de l'app grâce aux évènements `gf:automations-history-changed` et
 * `gf:automations-changed` — pas de rafraîchissement manuel nécessaire.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  History as HistoryIcon,
  Trash2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/navigation/BackButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useConfirm } from "@/components/common/useConfirm";
import { countLabel } from "@/lib/copy";
import {
  clearExecutionHistory,
  loadExecutionHistory,
  subscribeExecutionHistory,
} from "@/lib/automations/history";
import { listAutomations, subscribeAutomations } from "@/lib/automations/store";
import type { Automation, ExecutionRecord, ExecutionStatus } from "@/lib/automations/types";

export const Route = createFileRoute("/automatisations/historique")({
  head: () => ({
    meta: [
      { title: "Historique des automatisations — GeniusFiles" },
      {
        name: "description",
        content:
          "Consultez les dernières exécutions de vos automatisations GeniusFiles : statut, date, heure et nombre total d'exécutions.",
      },
      { property: "og:title", content: "Historique des automatisations — GeniusFiles" },
      {
        property: "og:description",
        content: "Journal complet des exécutions : réussies, en cours ou en échec.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const [history, setHistory] = useState<ExecutionRecord[]>([]);
  const [rules, setRules] = useState<Automation[]>([]);
  const confirm = useConfirm();

  useEffect(() => {
    const refresh = () => {
      setHistory(loadExecutionHistory());
      setRules(listAutomations());
    };
    refresh();
    const u1 = subscribeExecutionHistory(refresh);
    const u2 = subscribeAutomations(refresh);
    return () => {
      u1();
      u2();
    };
  }, []);

  const totals = useMemo(() => {
    const byRule = new Map<string, number>();
    for (const r of rules) byRule.set(r.id, r.runCount);
    return byRule;
  }, [rules]);

  return (
    <AppShell>
      <div className="flex items-center gap-2">
        <BackButton className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground hover:text-foreground" />
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-foreground">Historique des exécutions</p>
          <p className="text-[11px] text-muted-foreground">
            {countLabel(history.length, "exécution")} conservée{history.length > 1 ? "s" : ""} sur
            cet appareil
          </p>
        </div>
        {history.length ? (
          <button
            type="button"
            onClick={() =>
              confirm.ask(
                {
                  title: "Vider l'historique des exécutions ?",
                  description: `${countLabel(
                    history.length,
                    "exécution",
                  )} enregistrée${history.length > 1 ? "s" : ""} sur cet appareil ${
                    history.length > 1 ? "seront supprimées" : "sera supprimée"
                  }. Les compteurs par automatisation ne sont pas affectés.`,
                  confirmLabel: "Vider l'historique",
                  tone: "danger",
                },
                () => clearExecutionHistory(),
              )
            }
            className="flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Vider
          </button>
        ) : null}
      </div>

      <SectionHeader
        title="Compteurs par automatisation"
        hint={rules.length ? undefined : "Aucune automatisation créée"}
      />
      {rules.length === 0 ? null : (
        <ul className="grid grid-cols-1 gap-2">
          {rules.map((r) => (
            <li
              key={r.id}
              className="card-surface flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-foreground">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.lastRunAt
                    ? `Dernière exécution ${new Date(r.lastRunAt).toLocaleString("fr-FR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}`
                    : "Jamais exécutée"}
                </p>
              </div>
              <span className="rounded-lg bg-accent px-2 py-1 text-[11px] font-semibold text-foreground">
                {totals.get(r.id) ?? 0}×
              </span>
            </li>
          ))}
        </ul>
      )}

      <SectionHeader title="Dernières exécutions" />
      {history.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="Aucune exécution pour l'instant"
          description="Dès qu'une automatisation se déclenche ou que vous en lancez une manuellement, son résultat apparaît ici : ce qui a été fait, sur combien de fichiers et à quel moment."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {history.map((h) => (
            <HistoryRow key={h.id} record={h} />
          ))}
        </ul>
      )}
      {confirm.dialog}
    </AppShell>
  );
}

function StatusIcon({ status }: { status: ExecutionStatus }) {
  if (status === "ok")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Réussie" />;
  if (status === "partial")
    return <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Partielle" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" aria-label="Échouée" />;
  return <Loader2 className="h-4 w-4 text-primary" aria-label="Simulation" />;
}

function statusLabel(s: ExecutionStatus): string {
  switch (s) {
    case "ok":
      return "Réussie";
    case "partial":
      return "Partielle";
    case "failed":
      return "Échouée";
    case "simulated":
      return "Simulée";
  }
}

function HistoryRow({ record }: { record: ExecutionRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card-surface flex flex-col gap-2 p-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start gap-3 text-left"
      >
        <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-accent">
          <StatusIcon status={record.status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">
            {record.automationName}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(record.startedAt).toLocaleString("fr-FR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
            <span>· {statusLabel(record.status)}</span>
            <span>· {countLabel(record.actions.length, "action")}</span>
            {record.filesProcessed ? (
              <span>· {countLabel(record.filesProcessed, "fichier")}</span>
            ) : null}
          </p>
        </div>
      </button>
      {open ? (
        <div className="ml-12 flex flex-col gap-1">
          {record.actions.map((a, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px]"
            >
              <span className="text-foreground">{a.label}</span>
              <span
                className={
                  a.status === "failed"
                    ? "text-red-500"
                    : a.status === "skipped"
                      ? "text-muted-foreground"
                      : "text-emerald-500"
                }
              >
                {a.status === "failed" ? "Échec" : a.status === "skipped" ? "Ignoré" : "OK"}
              </span>
            </div>
          ))}
          {record.errors.length ? (
            <ul className="mt-1 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-[11px] text-red-500">
              {record.errors.map((e, i) => (
                <li key={i}>· {e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
