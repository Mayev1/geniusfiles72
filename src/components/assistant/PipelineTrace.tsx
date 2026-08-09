/**
 * Pipeline de traitement de Genius AI.
 *
 * Chaque étape reflète un état réel du tour en cours (envoi, réflexion du
 * modèle, exécution d'une commande par le moteur local, reprise du modèle,
 * rédaction). Aucune étape n'est jouée « à vide » : elles sont dérivées du
 * flux réel de la conversation et de la progression publiée par le moteur.
 */
import { Check, X } from "lucide-react";

export type PipelineState = "pending" | "active" | "done" | "failed";

export type PipelineStep = {
  id: string;
  label: string;
  /** Détail réel (progression du moteur) affiché sous l'étape en cours. */
  detail?: string;
  state: PipelineState;
};

export function PipelineTrace({ steps }: { steps: PipelineStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div
      className="gf-chat-safe gf-pipeline rounded-[22px] border border-border/60 bg-surface/70 px-3.5 py-3"
      aria-live="polite"
    >
      <ol className="space-y-0">
        {steps.map((step, i) => (
          <li key={step.id} className="relative flex gap-3 pb-2.5 last:pb-0">
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className={`absolute left-[9px] top-[20px] bottom-0 w-px transition-colors duration-300 ${
                  step.state === "done" ? "bg-primary/45" : "bg-border"
                }`}
              />
            ) : null}
            <Marker state={step.state} />
            <div className="min-w-0 flex-1 pt-px">
              <p
                className={`truncate text-[13px] leading-[18px] transition-colors duration-200 ${
                  step.state === "pending"
                    ? "text-muted-foreground/60"
                    : step.state === "failed"
                      ? "text-destructive"
                      : step.state === "active"
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                }`}
              >
                {step.label}
              </p>
              {step.detail && step.state === "active" ? (
                <p className="gf-pipeline-detail mt-0.5 truncate text-[12px] leading-[16px] text-muted-foreground">
                  {step.detail}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Marker({ state }: { state: PipelineState }) {
  if (state === "done") {
    return (
      <span className="gf-pipeline-pop z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="gf-pipeline-pop z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary/15">
        <span className="gf-pipeline-spin h-[10px] w-[10px] rounded-full border-2 border-primary/30 border-t-primary" />
      </span>
    );
  }
  return (
    <span className="z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-surface-2">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
    </span>
  );
}
