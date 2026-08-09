/**
 * Automatisations — main route.
 *
 * The page walks users through a strict, guided creation flow:
 *   1. Trigger  (with mandatory params)
 *   2. Actions (each with required sources/destinations)
 *   3. Conditions (optional)
 *   4. Summary + activation
 *
 * The wizard never runs the automation on save. It also never fires a
 * notification at creation. Execution is only triggered from an
 * explicit "Exécuter maintenant" action on an existing card, or by
 * the scheduler when the exact trigger moment is reached.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  Copy,
  History,
  Loader2,
  Plus,
  Play,
  Power,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";

import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { BACK_PRIORITY, useBackHandler } from "@/lib/navigation/back-stack";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { errorMessage } from "@/lib/errors/humanize";
import {
  BottomSheet,
  ConfirmDialog,
  PrimaryButton,
  TextField,
} from "@/components/files/BottomSheet";
import { DestinationPicker } from "@/components/files/DestinationPicker";
import { FileIcon } from "@/components/files/FileIcon";
import { FileSourcePicker } from "@/components/files/FileSourcePicker";
import {
  ACTION_CATALOG,
  CONDITION_CATALOG,
  OPENABLE_MODULES,
  TRIGGER_CATALOG,
  WEEK_DAYS,
} from "@/lib/automations/catalog";
import { buildPreview, runAutomation, type ActionPreview } from "@/lib/automations/engine";
import { loadExecutionHistory, subscribeExecutionHistory } from "@/lib/automations/history";
import { displayStatus, isRunning, subscribeRunning } from "@/lib/automations/status";
import {
  deleteAutomation,
  duplicateAutomation,
  listAutomations,
  saveAutomation,
  subscribeAutomations,
  toggleAutomation,
} from "@/lib/automations/store";
import { toAbsolutePath } from "@/lib/files/fs";
import type {
  Action,
  ActionKind,
  Automation,
  Condition,
  ConditionKind,
  ExecutionRecord,
  FileSelection,
  Trigger,
  TriggerKind,
} from "@/lib/automations/types";
import type { FileEntry, PathRef } from "@/lib/files/types";

export const Route = createFileRoute("/automatisations")({
  head: () => ({
    meta: [
      { title: "Automatisations — GeniusFiles" },
      {
        name: "description",
        content:
          "Créez des automatisations fiables : assistant guidé, aperçu clair, exécution réelle des actions sur vos fichiers.",
      },
    ],
  }),
  component: AutomationsPage,
});

/* ─────────────────────── Draft helpers ─────────────────────── */

type Draft = {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
};

function emptyDraft(): Draft {
  return {
    name: "",
    description: "",
    enabled: true,
    trigger: { kind: "daily", at: "09:00" },
    conditions: [],
    actions: [],
  };
}

function fromAutomation(a: Automation): Draft {
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? "",
    enabled: a.enabled,
    trigger: a.trigger,
    conditions: a.conditions.map((c) => ({ ...c })),
    actions: a.actions.map((c) => ({ ...c })),
  };
}

/* ─────────────────────── Root component ─────────────────────── */

function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([]);
  const [history, setHistory] = useState<ExecutionRecord[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Automation | null>(null);
  const [, forceTick] = useState(0);

  const refresh = useCallback(() => {
    setItems(listAutomations());
    setHistory(loadExecutionHistory());
  }, []);

  useEffect(() => {
    refresh();
    const un1 = subscribeAutomations(refresh);
    const un2 = subscribeExecutionHistory(refresh);
    const un3 = subscribeRunning(() => forceTick((n) => n + 1));
    return () => {
      un1();
      un2();
      un3();
    };
  }, [refresh]);

  const activeCount = useMemo(() => items.filter((a) => a.enabled).length, [items]);

  const openCreate = () => setEditing(emptyDraft());
  const openEdit = (a: Automation) => setEditing(fromAutomation(a));

  const onSave = (draft: Draft) => {
    saveAutomation({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      enabled: draft.enabled,
      trigger: draft.trigger,
      conditions: draft.conditions,
      actions: draft.actions,
    });
    setEditing(null);
    toast.success(draft.id ? "Automatisation mise à jour" : "Automatisation créée", {
      description: draft.id
        ? "Les changements s'appliqueront au prochain déclenchement."
        : "Elle se déclenchera selon les conditions que vous avez définies.",
    });
  };

  return (
    <AppShell>
      {/* Overview */}
      <div className="card-surface flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
          <Zap className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-foreground">
            {items.length} automatisation{items.length > 1 ? "s" : ""}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {activeCount} active{activeCount > 1 ? "s" : ""} · déclenchement à l'heure exacte
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground shadow-soft"
        >
          <Plus className="h-4 w-4" />
          Nouvelle
        </button>
      </div>

      <SectionHeader
        title="Vos automatisations"
        hint={items.length ? undefined : "Aucune pour l'instant"}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Wand2}
          title="Créez votre première automatisation"
          description="Un assistant en 4 étapes : déclencheur, actions, conditions, résumé."
          action={
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground"
            >
              Commencer
            </button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              history={history}
              onEdit={() => openEdit(a)}
              onToggle={() => toggleAutomation(a.id, !a.enabled)}
              onDuplicate={() => {
                duplicateAutomation(a.id);
                toast.success("Automatisation dupliquée", {
                  description: "Une copie désactivée a été créée, modifiable librement.",
                });
              }}
              onDelete={() => setConfirmDelete(a)}
              onRun={async () => {
                try {
                  const rec = await runAutomation(a, { simulate: false });
                  if (rec.status === "ok") {
                    toast.success("Règle exécutée", {
                      description: `« ${a.name} » a été appliquée avec succès.`,
                    });
                  } else if (rec.status === "partial") {
                    toast.warning("Exécution partielle", {
                      description: `« ${a.name} » a rencontré ${rec.errors.length} erreur${rec.errors.length > 1 ? "s" : ""}. Consultez l'historique pour le détail.`,
                    });
                  } else {
                    toast.error("L'exécution a échoué", {
                      description: rec.errors[0]
                        ? errorMessage(new Error(rec.errors[0]))
                        : `« ${a.name} » n'a pas pu être exécutée.`,
                    });
                  }
                } catch (err) {
                  toast.error("L'exécution a échoué", {
                    description: errorMessage(err, "Impossible d'exécuter cette automatisation."),
                  });
                }
              }}
            />
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Link
          to="/automatisations/historique"
          className="card-surface flex w-full items-center gap-3 p-3.5"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-primary">
            <History className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <p className="text-[13px] font-medium text-foreground">Historique d'exécution</p>
            <p className="text-[11px] text-muted-foreground">
              {history.length} entrée{history.length > 1 ? "s" : ""}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {editing ? (
        <AutomationWizard draft={editing} onCancel={() => setEditing(null)} onSave={onSave} />
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Supprimer cette automatisation ?"
        danger
        confirmLabel="Supprimer"
        description={
          <>
            «<span className="font-medium text-foreground"> {confirmDelete?.name} </span>» ne
            s'exécutera plus. Vos fichiers déjà traités par ses exécutions passées ne sont pas
            concernés. Cette suppression est définitive.
          </>
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            deleteAutomation(confirmDelete.id);
            toast.success("Automatisation supprimée", {
              description: `« ${confirmDelete.name} » ne s'exécutera plus.`,
            });
          }
          setConfirmDelete(null);
        }}
      />
    </AppShell>
  );
}

/* ─────────────────────── Card ─────────────────────── */

function AutomationCard({
  automation,
  history,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
  onRun,
}: {
  automation: Automation;
  history: ExecutionRecord[];
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRun: () => Promise<void>;
}) {
  const summary = triggerSummary(automation.trigger);
  const st = displayStatus(automation, history);
  const running = isRunning(automation.id);
  const [busy, setBusy] = useState(false);
  const lastReal = history.find((r) => r.automationId === automation.id && !r.simulated);
  return (
    <li className="card-surface flex flex-col gap-2 p-3.5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={automation.enabled ? "Désactiver" : "Activer"}
          className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
            automation.enabled
              ? "bg-primary text-primary-foreground shadow-xs"
              : "bg-accent text-muted-foreground"
          }`}
        >
          <Power className="h-4 w-4" />
        </button>
        <button type="button" onClick={onEdit} className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-foreground">{automation.name}</p>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${st.tone}`}
            >
              {st.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {summary} · {automation.actions.length} action
            {automation.actions.length > 1 ? "s" : ""}
            {automation.conditions.length
              ? ` · ${automation.conditions.length} condition${automation.conditions.length > 1 ? "s" : ""}`
              : ""}
          </p>
          {lastReal ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Dernière exécution :{" "}
              {new Date(lastReal.finishedAt).toLocaleString("fr-FR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          ) : null}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-12">
        <RowChip
          icon={running || busy ? Loader2 : Play}
          label={running || busy ? "En cours…" : "Exécuter maintenant"}
          onClick={async () => {
            if (busy || running) return;
            setBusy(true);
            try {
              await onRun();
            } finally {
              setBusy(false);
            }
          }}
          primary
          spinning={running || busy}
        />
        <RowChip icon={Copy} label="Dupliquer" onClick={onDuplicate} />
        <RowChip icon={Trash2} label="Supprimer" onClick={onDelete} danger />
      </div>
    </li>
  );
}

function RowChip({
  icon: Icon,
  label,
  onClick,
  primary,
  danger,
  spinning,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  spinning?: boolean;
}) {
  const cls = primary
    ? "bg-primary text-primary-foreground shadow-soft"
    : danger
      ? "border border-red-500/30 text-red-500 hover:bg-red-500/10"
      : "border border-border bg-surface text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${cls}`}
    >
      <Icon className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

/* ─────────────────────── Wizard ─────────────────────── */

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "Déclencheur",
  2: "Actions",
  3: "Conditions",
  4: "Résumé",
};

function AutomationWizard({
  draft: initial,
  onCancel,
  onSave,
}: {
  draft: Draft;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [step, setStep] = useState<Step>(1);
  useEffect(() => setDraft(initial), [initial]);

  /* Retour Android dans l'assistant : revient à l'étape précédente avant de
     fermer la feuille (priorité au-dessus de l'overlay qui la contient). */
  useBackHandler(
    step > 1,
    () => {
      setStep((n) => (n - 1) as Step);
      return true;
    },
    BACK_PRIORITY.overlay + 10,
  );

  const triggerErr = validateTrigger(draft.trigger);
  const actionErr = validateActions(draft.actions);
  const conditionErr = draft.conditions.map((c) => validateCondition(c)).find((e) => e) as
    | string
    | undefined;

  const canNext =
    (step === 1 && !triggerErr) ||
    (step === 2 && !actionErr) ||
    (step === 3 && !conditionErr) ||
    step === 4;

  const submit = () => {
    if (!draft.name.trim()) {
      toast.error("Donnez un nom à l'automatisation");
      return;
    }
    if (triggerErr) {
      toast.error(triggerErr);
      setStep(1);
      return;
    }
    if (actionErr) {
      toast.error(actionErr);
      setStep(2);
      return;
    }
    if (conditionErr) {
      toast.error(conditionErr);
      setStep(3);
      return;
    }
    onSave(draft);
  };

  return (
    <BottomSheet
      open
      onClose={onCancel}
      title={draft.id ? "Modifier l'automatisation" : "Nouvelle automatisation"}
      footer={
        <>
          {step > 1 ? (
            <PrimaryButton variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Retour
            </PrimaryButton>
          ) : (
            <PrimaryButton variant="ghost" onClick={onCancel}>
              Annuler
            </PrimaryButton>
          )}
          {step < 4 ? (
            <PrimaryButton
              onClick={() => canNext && setStep((s) => (s + 1) as Step)}
              disabled={!canNext}
            >
              Suivant <ArrowRight className="ml-1 h-4 w-4" />
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={submit}>
              <Check className="mr-1 h-4 w-4" />
              {draft.id ? "Enregistrer" : "Créer"}
            </PrimaryButton>
          )}
        </>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
        <StepIndicator step={step} onGo={setStep} />

        {step === 1 ? (
          <TriggerStep
            trigger={draft.trigger}
            onChange={(trigger) => setDraft((d) => ({ ...d, trigger }))}
            error={triggerErr}
          />
        ) : null}

        {step === 2 ? (
          <ActionsStep
            actions={draft.actions}
            onChange={(actions) => setDraft((d) => ({ ...d, actions }))}
            error={actionErr}
          />
        ) : null}

        {step === 3 ? (
          <ConditionsStep
            conditions={draft.conditions}
            onChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
          />
        ) : null}

        {step === 4 ? (
          <SummaryStep
            draft={draft}
            onName={(name) => setDraft((d) => ({ ...d, name }))}
            onDescription={(description) => setDraft((d) => ({ ...d, description }))}
            onEnabled={(enabled) => setDraft((d) => ({ ...d, enabled }))}
          />
        ) : null}
      </div>
    </BottomSheet>
  );
}

function StepIndicator({ step, onGo }: { step: Step; onGo: (s: Step) => void }) {
  return (
    <ol className="flex items-center gap-1 text-[11px]">
      {[1, 2, 3, 4].map((n) => {
        const active = n === step;
        const done = n < step;
        return (
          <li key={n} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => onGo(n as Step)}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 transition-colors ${
                active
                  ? "bg-primary/15 text-primary"
                  : done
                    ? "text-emerald-500"
                    : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-emerald-500/20 text-emerald-500"
                      : "bg-accent text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : n}
              </span>
              <span className="text-[10px] font-medium">{STEP_LABELS[n as Step]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────── Step 1 — trigger ─────────────────────── */

function TriggerStep({
  trigger,
  onChange,
  error,
}: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
  error?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = TRIGGER_CATALOG.find((t) => t.kind === trigger.kind)!;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Choisissez quand cette automatisation doit se déclencher
      </p>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="card-surface flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Zap className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-[13px] font-medium text-foreground">{current.label}</p>
          <p className="text-[11px] text-muted-foreground">{triggerSummary(trigger)}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
      <TriggerParams trigger={trigger} onChange={onChange} />
      {error ? <p className="text-[11px] text-red-500">{error}</p> : null}

      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choisir un déclencheur"
      >
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {TRIGGER_CATALOG.map((entry) => (
            <li key={entry.kind}>
              <button
                type="button"
                onClick={() => {
                  onChange(defaultTrigger(entry.kind));
                  setPickerOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
              >
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">{entry.label}</p>
                  <p className="text-[11px] text-muted-foreground">{entry.description}</p>
                </div>
                {trigger.kind === entry.kind ? <Check className="h-4 w-4 text-primary" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}

function TriggerParams({
  trigger,
  onChange,
}: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
}) {
  if (trigger.kind === "scheduled_time" || trigger.kind === "daily") {
    return (
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Heure</label>
        <input
          type="time"
          value={trigger.at}
          onChange={(e) => onChange({ ...trigger, at: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
        />
      </div>
    );
  }
  if (trigger.kind === "weekly") {
    return (
      <div className="space-y-2">
        <label className="block text-[11px] font-medium text-muted-foreground">Jours</label>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_DAYS.map((label, idx) => {
            const active = trigger.days.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  const set = new Set(trigger.days);
                  if (active) set.delete(idx);
                  else set.add(idx);
                  onChange({ ...trigger, days: Array.from(set).sort() });
                }}
                className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-surface text-muted-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="block text-[11px] font-medium text-muted-foreground">Heure</label>
        <input
          type="time"
          value={trigger.at}
          onChange={(e) => onChange({ ...trigger, at: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
        />
      </div>
    );
  }
  if (trigger.kind === "file_added" || trigger.kind === "folder_changed") {
    return (
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Dossier</label>
        <TextField
          value={trigger.folder}
          onChange={(folder) => onChange({ ...trigger, folder })}
          placeholder="/DCIM/Camera"
        />
      </div>
    );
  }
  if (trigger.kind === "storage_low") {
    return (
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
          Seuil (% libre)
        </label>
        <input
          type="number"
          min={1}
          max={99}
          value={trigger.thresholdPct}
          onChange={(e) =>
            onChange({
              ...trigger,
              thresholdPct: Math.max(1, Math.min(99, Number(e.target.value) || 10)),
            })
          }
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
        />
      </div>
    );
  }
  return null;
}

function defaultTrigger(kind: TriggerKind): Trigger {
  switch (kind) {
    case "scheduled_time":
      return { kind, at: nextRoundTime() };
    case "daily":
      return { kind, at: "09:00" };
    case "weekly":
      return { kind, at: "09:00", days: [1, 2, 3, 4, 5] };
    case "app_open":
      return { kind };
    case "file_added":
      return { kind, folder: "" };
    case "folder_changed":
      return { kind, folder: "" };
    case "storage_low":
      return { kind, thresholdPct: 10 };
    case "device_connected":
      return { kind, deviceType: "any" };
  }
}

function nextRoundTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 5);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
}

function triggerSummary(t: Trigger): string {
  switch (t.kind) {
    case "scheduled_time":
      return `Une fois à ${t.at}`;
    case "daily":
      return `Chaque jour à ${t.at}`;
    case "weekly":
      return `${t.days.map((d) => WEEK_DAYS[d]).join(", ") || "Aucun jour"} à ${t.at}`;
    case "app_open":
      return "À l'ouverture de l'app";
    case "file_added":
      return t.folder ? `Nouveau fichier dans ${t.folder}` : "Nouveau fichier";
    case "folder_changed":
      return t.folder ? `Modification de ${t.folder}` : "Dossier modifié";
    case "storage_low":
      return `Stockage libre < ${t.thresholdPct}%`;
    case "device_connected":
      return "Périphérique connecté";
  }
}

function validateTrigger(t: Trigger): string | undefined {
  const validHM = (s: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim());
  switch (t.kind) {
    case "scheduled_time":
    case "daily":
      return validHM(t.at) ? undefined : "Renseignez une heure valide (HH:mm)";
    case "weekly":
      if (!validHM(t.at)) return "Renseignez une heure valide (HH:mm)";
      if (!t.days.length) return "Choisissez au moins un jour";
      return undefined;
    case "file_added":
    case "folder_changed":
      return t.folder.trim() ? undefined : "Indiquez un dossier à surveiller";
    case "storage_low":
      return t.thresholdPct >= 1 && t.thresholdPct <= 99 ? undefined : "Seuil entre 1 et 99";
    default:
      return undefined;
  }
}

/* ─────────────────────── Step 2 — actions ─────────────────────── */

function ActionsStep({
  actions,
  onChange,
  error,
}: {
  actions: Action[];
  onChange: (a: Action[]) => void;
  error?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Actions à effectuer
        </p>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
        >
          <Plus className="h-3 w-3" />
          Ajouter
        </button>
      </div>
      {actions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-center text-[11px] text-muted-foreground">
          Ajoutez au moins une action.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {actions.map((a, i) => (
            <li key={i} className="card-surface p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-foreground">
                  {i + 1}. {ACTION_CATALOG.find((entry) => entry.kind === a.kind)?.label}
                </p>
                <div className="flex items-center gap-2">
                  {i > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const copy = [...actions];
                        [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
                        onChange(copy);
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      ↑
                    </button>
                  ) : null}
                  {i < actions.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const copy = [...actions];
                        [copy[i + 1], copy[i]] = [copy[i], copy[i + 1]];
                        onChange(copy);
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      ↓
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onChange(actions.filter((_, j) => j !== i))}
                    className="text-[11px] text-red-500 hover:brightness-110"
                  >
                    Retirer
                  </button>
                </div>
              </div>
              <ActionParams
                action={a}
                onChange={(next) => onChange(actions.map((aa, j) => (j === i ? next : aa)))}
              />
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="text-[11px] text-red-500">{error}</p> : null}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Ajouter une action"
      >
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {ACTION_CATALOG.map((entry) => (
            <li key={entry.kind}>
              <button
                type="button"
                onClick={() => {
                  onChange([...actions, defaultAction(entry.kind)]);
                  setPickerOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
              >
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">{entry.label}</p>
                  <p className="text-[11px] text-muted-foreground">{entry.description}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}

/** UI to configure a single action. All file selections are typed. */
function ActionParams({ action, onChange }: { action: Action; onChange: (a: Action) => void }) {
  switch (action.kind) {
    case "copy":
    case "move":
    case "backup":
      return (
        <div className="space-y-2">
          <SelectionField
            label="Fichiers ou dossiers à traiter"
            selection={action.source}
            onChange={(source) => onChange({ ...action, source })}
          />
          <DestinationField
            label="Dossier de destination"
            path={action.destination}
            onChange={(destination) => onChange({ ...action, destination })}
          />
        </div>
      );
    case "trash":
      return (
        <SelectionField
          label="Fichiers ou dossiers à supprimer"
          selection={action.source}
          onChange={(source) => onChange({ ...action, source })}
        />
      );
    case "rename":
      return (
        <div className="space-y-2">
          <SelectionField
            label="Fichiers à renommer"
            selection={action.source}
            onChange={(source) => onChange({ ...action, source })}
          />
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Modèle · variables : {`{name} {ext} {date} {time}`}
            </label>
            <TextField
              value={action.pattern}
              onChange={(pattern) => onChange({ ...action, pattern })}
              placeholder="{date}-{name}"
            />
          </div>
        </div>
      );
    case "compress":
      return (
        <div className="space-y-2">
          <SelectionField
            label="Fichiers à compresser"
            selection={action.source}
            onChange={(source) => onChange({ ...action, source })}
          />
          <DestinationField
            label="Dossier où créer l'archive"
            path={action.destination}
            onChange={(destination) => onChange({ ...action, destination })}
          />
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nom de l'archive
            </label>
            <TextField
              value={action.archiveName}
              onChange={(archiveName) => onChange({ ...action, archiveName })}
              placeholder="archive.zip"
            />
          </div>
        </div>
      );
    case "extract":
      return (
        <div className="space-y-2">
          <SelectionField
            label="Archive à extraire"
            selection={action.archive}
            onChange={(archive) => onChange({ ...action, archive })}
            singleFileOnly
          />
          <DestinationField
            label="Dossier de destination"
            path={action.destination}
            onChange={(destination) => onChange({ ...action, destination })}
          />
        </div>
      );
    case "mkdir":
      return (
        <div className="space-y-2">
          <DestinationField
            label="Créer dans"
            path={action.parent}
            onChange={(parent) => onChange({ ...action, parent })}
          />
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nom du dossier
            </label>
            <TextField
              value={action.name}
              onChange={(name) => onChange({ ...action, name })}
              placeholder="Nouveau dossier"
            />
          </div>
        </div>
      );
    case "organize":
      return (
        <div className="space-y-2">
          <DestinationField
            label="Dossier à organiser"
            path={action.folder}
            onChange={(folder) => onChange({ ...action, folder })}
          />
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Règle
            </label>
            <select
              value={action.rule}
              onChange={(e) =>
                onChange({ ...action, rule: e.target.value as "type" | "date" | "name" })
              }
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
            >
              <option value="type">Par type de fichier</option>
              <option value="date">Par date</option>
              <option value="name">Par nom</option>
            </select>
          </div>
        </div>
      );
    case "cleaner_scan":
      return (
        <p className="text-[11px] text-muted-foreground">
          Lance une analyse intelligente du Nettoyeur.
        </p>
      );
    case "notify":
      return (
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Message affiché
          </label>
          <TextField
            value={action.message}
            onChange={(message) => onChange({ ...action, message })}
            placeholder="Message de la notification"
          />
        </div>
      );
    case "open_module":
      return (
        <select
          value={action.route}
          onChange={(e) => onChange({ ...action, route: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
        >
          {OPENABLE_MODULES.map((m) => (
            <option key={m.route} value={m.route}>
              {m.label}
            </option>
          ))}
        </select>
      );
  }
}

function defaultAction(kind: ActionKind): Action {
  switch (kind) {
    case "copy":
    case "move":
    case "backup":
      return { kind };
    case "rename":
      return { kind, pattern: "{date}-{name}" };
    case "trash":
      return { kind };
    case "compress":
      return { kind, archiveName: "archive.zip" };
    case "extract":
      return { kind };
    case "mkdir":
      return { kind, name: "" };
    case "organize":
      return { kind, rule: "type" };
    case "cleaner_scan":
      return { kind };
    case "notify":
      return { kind, message: "" };
    case "open_module":
      return { kind, route: "/" };
  }
}

function validateAction(a: Action): string | undefined {
  switch (a.kind) {
    case "copy":
    case "move":
    case "backup":
      if (!a.source || a.source.entries.length === 0) return "Sélectionnez au moins un élément";
      if (!a.destination) return "Choisissez un dossier de destination";
      return undefined;
    case "trash":
      if (!a.source || a.source.entries.length === 0) return "Sélectionnez au moins un élément";
      return undefined;
    case "rename":
      if (!a.source || a.source.entries.length === 0) return "Sélectionnez au moins un fichier";
      if (!a.pattern.trim()) return "Renseignez un modèle de nom";
      return undefined;
    case "compress":
      if (!a.source || a.source.entries.length === 0) return "Sélectionnez au moins un fichier";
      if (!a.destination) return "Choisissez un dossier pour l'archive";
      if (!a.archiveName.trim()) return "Nommez l'archive";
      return undefined;
    case "extract":
      if (!a.archive || a.archive.entries.length === 0) return "Sélectionnez une archive";
      if (!a.destination) return "Choisissez un dossier de destination";
      return undefined;
    case "mkdir":
      if (!a.parent) return "Choisissez un emplacement";
      if (!a.name.trim()) return "Nommez le dossier";
      return undefined;
    case "organize":
      if (!a.folder) return "Choisissez un dossier à organiser";
      return undefined;
    case "notify":
      if (!a.message.trim()) return "Renseignez le message de la notification";
      return undefined;
    default:
      return undefined;
  }
}

function validateActions(actions: Action[]): string | undefined {
  if (!actions.length) return "Ajoutez au moins une action";
  for (let i = 0; i < actions.length; i++) {
    const err = validateAction(actions[i]);
    if (err) return `Action ${i + 1} : ${err}`;
  }
  return undefined;
}

/* ─────────────────────── Selection + destination controls ─────────────────────── */

function SelectionField({
  label,
  selection,
  onChange,
  singleFileOnly,
}: {
  label: string;
  selection?: FileSelection;
  onChange: (s: FileSelection) => void;
  singleFileOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent"
      >
        <span className="flex-1 truncate">
          {selection && selection.entries.length ? (
            selection.entries.length === 1 ? (
              selection.entries[0].name
            ) : (
              `${selection.entries.length} éléments sélectionnés`
            )
          ) : (
            <span className="text-muted-foreground">Choisir…</span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
      {selection && selection.entries.length ? (
        <ul className="mt-1 space-y-0.5">
          {selection.entries.slice(0, 3).map((e) => (
            <li
              key={e.name}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <FileIcon kind={e.kind} path={e.path} />
              <span className="truncate">{e.name}</span>
            </li>
          ))}
          {selection.entries.length > 3 ? (
            <li className="text-[11px] text-muted-foreground">
              + {selection.entries.length - 3} autre(s)
            </li>
          ) : null}
        </ul>
      ) : null}
      <SelectionPicker
        open={open}
        onCancel={() => setOpen(false)}
        multi={!singleFileOnly}
        onConfirm={(sel) => {
          onChange(sel);
          setOpen(false);
        }}
      />
    </div>
  );
}

function DestinationField({
  label,
  path,
  onChange,
}: {
  label: string;
  path?: PathRef;
  onChange: (p: PathRef) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent"
      >
        <span className="flex-1 truncate">
          {path ? toAbsolutePath(path) : <span className="text-muted-foreground">Choisir…</span>}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
      <DestinationPicker
        open={open}
        title={label}
        initial={path ?? null}
        onCancel={() => setOpen(false)}
        onConfirm={(p) => {
          onChange(p);
          setOpen(false);
        }}
      />
    </div>
  );
}

/**
 * Wraps FileSourcePicker so it can produce a `FileSelection` (parent + entries).
 * The base picker returns absolute paths; we derive the parent PathRef from the
 * shared prefix and re-attach the FileEntry list.
 */
function SelectionPicker({
  open,
  multi,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  multi: boolean;
  onCancel: () => void;
  onConfirm: (s: FileSelection) => void;
}) {
  return (
    <FileSourcePicker
      open={open}
      title="Choisir des éléments"
      extensions={[
        "pdf",
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "heic",
        "mp4",
        "mov",
        "mkv",
        "avi",
        "mp3",
        "m4a",
        "wav",
        "ogg",
        "zip",
        "rar",
        "7z",
        "tar",
        "gz",
        "txt",
        "md",
        "csv",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "ppt",
        "pptx",
        "apk",
        "json",
        "xml",
        "html",
        "js",
        "ts",
      ]}
      multi={multi}
      onCancel={onCancel}
      onConfirm={(paths, entries) => {
        if (!entries.length) return onCancel();
        // Derive the parent PathRef from an entry's `path` (root-relative) and
        // the first absolute path (which starts with the root prefix).
        // The FileSourcePicker keeps entries in the same directory when `multi`
        // is true, so the parent is unambiguous.
        // Fallback: use the abs path stripped of the filename.
        const abs = paths[0];
        const name = entries[0].name;
        const parentAbs = abs.endsWith(name) ? abs.slice(0, -name.length).replace(/\/$/, "") : abs;
        const parent = absToPathRef(parentAbs);
        onConfirm({ parent, entries });
      }}
    />
  );
}

/** Convert an absolute path back to a PathRef by matching a known root. */
function absToPathRef(abs: string): PathRef {
  // Import here would create a cycle; do a lightweight best-effort match
  // against the roots exposed by fs.ts via toAbsolutePath.
  const roots: PathRef["rootId"][] = [
    "internal",
    "documents",
    "downloads",
    "pictures",
    "movies",
    "music",
    "sdcard",
  ];
  for (const r of roots) {
    try {
      const rootAbs = toAbsolutePath({ rootId: r, segments: [] });
      if (abs === rootAbs) return { rootId: r, segments: [] };
      if (abs.startsWith(rootAbs + "/")) {
        return {
          rootId: r,
          segments: abs
            .slice(rootAbs.length + 1)
            .split("/")
            .filter(Boolean),
        };
      }
    } catch {
      /* skip */
    }
  }
  return { rootId: "internal", segments: abs.split("/").filter(Boolean) };
}

/* ─────────────────────── Step 3 — conditions ─────────────────────── */

function ConditionsStep({
  conditions,
  onChange,
}: {
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Conditions (facultatif)
        </p>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Ajouter
        </button>
      </div>
      {conditions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-center text-[11px] text-muted-foreground">
          Sans condition, l'automatisation s'exécute à chaque déclenchement.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {conditions.map((c, i) => (
            <li key={i} className="card-surface p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[12px] font-medium text-foreground">
                  {CONDITION_CATALOG.find((entry) => entry.kind === c.kind)?.label}
                </p>
                <button
                  type="button"
                  onClick={() => onChange(conditions.filter((_, j) => j !== i))}
                  className="text-[11px] text-red-500 hover:brightness-110"
                >
                  Retirer
                </button>
              </div>
              <ConditionParams
                condition={c}
                onChange={(next) => onChange(conditions.map((cc, j) => (j === i ? next : cc)))}
              />
            </li>
          ))}
        </ul>
      )}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Ajouter une condition"
      >
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {CONDITION_CATALOG.map((entry) => (
            <li key={entry.kind}>
              <button
                type="button"
                onClick={() => {
                  onChange([...conditions, defaultCondition(entry.kind)]);
                  setPickerOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
              >
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">{entry.label}</p>
                  <p className="text-[11px] text-muted-foreground">{entry.description}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}

function ConditionParams({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
}) {
  switch (condition.kind) {
    case "file_type":
      return (
        <TextField
          value={condition.types.join(", ")}
          onChange={(v) =>
            onChange({
              ...condition,
              types: v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="image, video, pdf…"
        />
      );
    case "size_min":
    case "size_max":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={condition.bytes}
            onChange={(e) => onChange({ ...condition, bytes: Number(e.target.value) || 0 })}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
          />
          <span className="text-[11px] text-muted-foreground">octets</span>
        </div>
      );
    case "name_contains":
      return (
        <TextField
          value={condition.text}
          onChange={(text) => onChange({ ...condition, text })}
          placeholder="IMG_, .backup, rapport…"
        />
      );
    case "location":
      return (
        <TextField
          value={condition.folder}
          onChange={(folder) => onChange({ ...condition, folder })}
          placeholder="/Download"
        />
      );
    case "created_after":
    case "modified_after":
      return (
        <input
          type="date"
          value={condition.date}
          onChange={(e) => onChange({ ...condition, date: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
        />
      );
    case "storage_available":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={condition.minBytes}
            onChange={(e) => onChange({ ...condition, minBytes: Number(e.target.value) || 0 })}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
          />
          <span className="text-[11px] text-muted-foreground">octets libres min.</span>
        </div>
      );
  }
}

function defaultCondition(kind: ConditionKind): Condition {
  switch (kind) {
    case "file_type":
      return { kind, types: [] };
    case "size_min":
      return { kind, bytes: 1024 * 1024 };
    case "size_max":
      return { kind, bytes: 100 * 1024 * 1024 };
    case "name_contains":
      return { kind, text: "" };
    case "location":
      return { kind, folder: "" };
    case "created_after":
    case "modified_after":
      return { kind, date: new Date().toISOString().slice(0, 10) };
    case "storage_available":
      return { kind, minBytes: 1024 * 1024 * 1024 };
  }
}

function validateCondition(c: Condition): string | undefined {
  switch (c.kind) {
    case "file_type":
      return c.types.length ? undefined : "Précisez au moins un type";
    case "name_contains":
      return c.text.trim() ? undefined : "Renseignez un mot-clé";
    case "location":
      return c.folder.trim() ? undefined : "Renseignez un dossier";
    default:
      return undefined;
  }
}

/* ─────────────────────── Step 4 — summary ─────────────────────── */

function SummaryStep({
  draft,
  onName,
  onDescription,
  onEnabled,
}: {
  draft: Draft;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onEnabled: (v: boolean) => void;
}) {
  const preview: ActionPreview[] = useMemo(
    () =>
      buildPreview({
        id: draft.id ?? "draft",
        name: draft.name || "Sans nom",
        description: draft.description,
        enabled: draft.enabled,
        trigger: draft.trigger,
        conditions: draft.conditions,
        actions: draft.actions,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runCount: 0,
        source: "manual",
      }),
    [draft],
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Nom</label>
        <TextField
          value={draft.name}
          onChange={onName}
          placeholder="ex : Ranger les captures d'écran"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
          Description (facultatif)
        </label>
        <TextField
          value={draft.description}
          onChange={onDescription}
          placeholder="À quoi sert cette automatisation ?"
        />
      </div>

      <div className="card-surface p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Déclencheur
        </p>
        <p className="mt-1 flex items-center gap-2 text-[13px] font-medium text-foreground">
          <CalendarClock className="h-4 w-4 text-primary" />
          {triggerSummary(draft.trigger)}
        </p>
      </div>

      <div className="card-surface p-3">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {preview.length} action{preview.length > 1 ? "s" : ""} planifiée
          {preview.length > 1 ? "s" : ""}
        </p>
        <ol className="flex flex-col gap-1.5">
          {preview.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                {i + 1}
              </span>
              <div>
                <p className="text-[12px] font-medium text-foreground">{step.label}</p>
                <p className="text-[11px] text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {draft.conditions.length ? (
        <div className="card-surface p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Conditions
          </p>
          <ul className="flex flex-col gap-0.5 text-[12px] text-foreground">
            {draft.conditions.map((c, i) => (
              <li key={i}>{CONDITION_CATALOG.find((e) => e.kind === c.kind)?.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-foreground">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => onEnabled(e.target.checked)}
          className="h-4 w-4 accent-[color:var(--primary)]"
        />
        Activer immédiatement (sans exécution automatique tant que le déclencheur n'est pas atteint)
      </label>
    </div>
  );
}
