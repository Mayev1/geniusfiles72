/**
 * Montage vidéo — panneau de l'étape 4.
 *
 * Toutes les actions portent sur la position réelle du curseur et sur des
 * segments réellement exportables : division, suppression d'une portion au
 * milieu, retour à la vidéo entière. Rien n'est proposé ici que le moteur
 * natif ne sache produire.
 */
import { Scissors, RotateCcw, Trash2, SplitSquareHorizontal } from "lucide-react";
import { fmtTime } from "@/components/player/format";
import type { VideoProject } from "@/lib/video/project";
import { isEdited, totalLength } from "@/lib/video/project";

export function MontageBar({
  project,
  position,
  activeId,
  disabled,
  onCutBefore,
  onCutAfter,
  onSplit,
  onDeleteActive,
  onReset,
}: {
  project: VideoProject;
  position: number;
  activeId: string | null;
  disabled?: boolean;
  onCutBefore: () => void;
  onCutAfter: () => void;
  onSplit: () => void;
  onDeleteActive: () => void;
  onReset: () => void;
}) {
  const edited = isEdited(project);
  const kept = totalLength(project);
  const count = project.segments.length;

  return (
    <div className="mx-3 mb-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <Scissors className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium leading-tight">
            {edited
              ? `${count} segment${count > 1 ? "s" : ""} conservé${count > 1 ? "s" : ""}`
              : "Vidéo entière conservée"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            Durée finale : {fmtTime(kept)}
            {count > 1 ? " — segments raccordés à l'export" : ""}
          </p>
        </div>
        {edited ? (
          <button
            type="button"
            onClick={onReset}
            aria-label="Rétablir la vidéo entière"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:scale-95"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <SmallButton
          disabled={disabled}
          onPress={onCutBefore}
          label={`Couper avant (${fmtTime(position)})`}
        />
        <SmallButton
          disabled={disabled}
          onPress={onCutAfter}
          label={`Couper après (${fmtTime(position)})`}
        />
      </div>
      <div className="mt-2 flex gap-2">
        <SmallButton
          disabled={disabled}
          onPress={onSplit}
          icon={<SplitSquareHorizontal className="h-3.5 w-3.5" />}
          label="Diviser ici"
        />
        <SmallButton
          disabled={disabled || count <= 1 || !activeId}
          onPress={onDeleteActive}
          tone="danger"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Supprimer le segment"
        />
      </div>
      {count > 1 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Touchez un segment sur la piste pour le sélectionner.
        </p>
      ) : null}
    </div>
  );
}

function SmallButton({
  label,
  onPress,
  disabled,
  icon,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className={`flex flex-1 items-center justify-center gap-1.5 truncate rounded-lg px-2 py-1.5 text-[12px] font-medium transition-transform active:scale-[0.98] disabled:opacity-40 ${
        tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-secondary/70 text-foreground"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
