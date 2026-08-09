/**
 * Feuille d'enregistrement d'un export vidéo.
 *
 * Progression réelle remontée par l'encodeur, annulation possible à tout
 * moment, et distinction explicite entre « nouveau fichier » (défaut) et
 * « remplacer l'original » (confirmation obligatoire).
 */
import { useState } from "react";
import { BottomSheet, PrimaryButton } from "@/components/files/BottomSheet";
import { fmtTime } from "@/components/player/format";
import type { SaveMode } from "@/lib/video/save";
import { trimmedName, replacementName } from "@/lib/video/save";

export function ExportSheet({
  open,
  onClose,
  originalName,
  keptLength,
  segmentCount,
  exact,
  onExactChange,
  busy,
  progress,
  onExport,
  onCancelExport,
}: {
  open: boolean;
  onClose: () => void;
  originalName: string;
  /** Durée réellement écrite après montage. */
  keptLength: number;
  segmentCount: number;
  exact: boolean;
  onExactChange: (v: boolean) => void;
  busy: boolean;
  progress: number;
  onExport: (mode: SaveMode) => void;
  onCancelExport: () => void;
}) {
  const [mode, setMode] = useState<SaveMode>("new");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const name = mode === "replace" ? replacementName(originalName) : trimmedName(originalName);
  const forcedReencode = segmentCount > 1;

  return (
    <BottomSheet open={open} onClose={busy ? () => undefined : onClose} title="Exporter la vidéo">
      <div className="space-y-3 px-1 pb-2">
        <p className="text-[12.5px] text-muted-foreground">
          {segmentCount > 1
            ? `${segmentCount} segments raccordés — durée finale ${fmtTime(keptLength)}.`
            : `Durée finale : ${fmtTime(keptLength)}.`}
        </p>

        <div className="space-y-2">
          <Option
            active={mode === "new"}
            disabled={busy}
            title="Nouveau fichier"
            detail={`Enregistré sous « ${trimmedName(originalName)} », l'original reste intact.`}
            onPress={() => {
              setMode("new");
              setConfirmReplace(false);
            }}
          />
          <Option
            active={mode === "replace"}
            disabled={busy}
            title="Remplacer l'original"
            detail={`Le fichier « ${replacementName(originalName)} » écrasera la vidéo d'origine.`}
            onPress={() => setMode("replace")}
          />
        </div>

        <label className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/50 px-3 py-2">
          <input
            type="checkbox"
            checked={exact || forcedReencode}
            disabled={busy || forcedReencode}
            onChange={(e) => onExactChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="text-[12px] leading-snug">
            <span className="font-medium text-foreground">Coupe à l'image près</span>
            <span className="block text-muted-foreground">
              {forcedReencode
                ? "Obligatoire ici : raccorder plusieurs segments impose de réencoder la vidéo."
                : "Réencode la vidéo pour couper exactement à l'instant choisi. Sinon la copie est sans perte, mais démarre à l'image-clé précédente."}
            </span>
          </span>
        </label>

        {mode === "replace" && !busy ? (
          <label className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            <input
              type="checkbox"
              checked={confirmReplace}
              onChange={(e) => setConfirmReplace(e.target.checked)}
              className="h-4 w-4"
            />
            Je confirme le remplacement définitif de l'original.
          </label>
        ) : null}

        {busy ? (
          <div className="space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>Encodage en cours — {Math.round(progress * 100)} %</span>
              <button
                type="button"
                onClick={onCancelExport}
                className="rounded-lg bg-secondary/70 px-2 py-1 text-[12px] font-medium text-foreground"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <PrimaryButton
            onClick={() => onExport(mode)}
            disabled={mode === "replace" && !confirmReplace}
          >
            Exporter vers « {name} »
          </PrimaryButton>
        )}
      </div>
    </BottomSheet>
  );
}

function Option({
  active,
  title,
  detail,
  onPress,
  disabled,
}: {
  active: boolean;
  title: string;
  detail: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
        active ? "border-primary bg-primary/10" : "border-border bg-surface-2/50"
      }`}
    >
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{detail}</p>
    </button>
  );
}
