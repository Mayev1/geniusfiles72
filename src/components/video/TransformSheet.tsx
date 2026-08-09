/**
 * Feuille de transformation vidéo — étape 5.
 *
 * Rotation, recadrage et résolution de sortie. Chaque choix est appliqué
 * immédiatement à l'aperçu WebGL et transmis au moteur natif à l'export.
 */
import { useMemo } from "react";
import { BottomSheet, PrimaryButton } from "@/components/files/BottomSheet";
import {
  CROP_PRESETS,
  RESOLUTION_PRESETS,
  cropForRatio,
  effectiveDimensions,
  naturalShortSide,
  resolutionLabel,
  type CropPreset,
  type VideoEdit,
} from "@/lib/video/edit";

export function TransformSheet({
  open,
  onClose,
  srcW,
  srcH,
  edit,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  srcW: number;
  srcH: number;
  edit: VideoEdit;
  onChange: (edit: VideoEdit) => void;
}) {
  const cropPreset = useMemo<CropPreset>(() => {
    if (edit.crop.x === 0 && edit.crop.y === 0 && edit.crop.w === 1 && edit.crop.h === 1)
      return "original";
    const ratio = (edit.crop.w * srcW) / (edit.crop.h * srcH);
    const eps = 0.02;
    for (const p of CROP_PRESETS) {
      if (p.ratio && Math.abs(p.ratio - ratio) < eps) return p.value;
    }
    return "free";
  }, [edit.crop, srcW, srcH]);

  const setRotation = (rotation: VideoEdit["rotation"]) => onChange({ ...edit, rotation });

  const setCropPreset = (preset: CropPreset) => {
    if (preset === "original") {
      onChange({ ...edit, crop: { x: 0, y: 0, w: 1, h: 1 } });
      return;
    }
    if (preset === "free") return;
    const ratio = CROP_PRESETS.find((p) => p.value === preset)?.ratio ?? 1;
    onChange({ ...edit, crop: cropForRatio(srcW, srcH, ratio) });
  };

  const setResolution = (targetShortSide: number) => onChange({ ...edit, targetShortSide });

  const outLabel = resolutionLabel(edit, srcW, srcH);
  const naturalShort = naturalShortSide(srcW, srcH, edit);
  const scaled = edit.targetShortSide > 0 && edit.targetShortSide < naturalShort;
  const { width, height } = effectiveDimensions(srcW, srcH, edit);

  return (
    <BottomSheet open={open} onClose={onClose} title="Transformation">
      <div className="space-y-5">
        {/* Rotation */}
        <section>
          <h4 className="mb-2 text-[13px] font-medium text-foreground">Rotation</h4>
          <div className="grid grid-cols-4 gap-2">
            {[0, 90, 180, 270].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRotation(r as VideoEdit["rotation"])}
                className={`rounded-xl px-2 py-2 text-[13px] font-medium transition-colors ${
                  edit.rotation === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-foreground hover:bg-surface-3"
                }`}
              >
                {r}°
              </button>
            ))}
          </div>
        </section>

        {/* Recadrage */}
        <section>
          <h4 className="mb-2 text-[13px] font-medium text-foreground">Recadrage</h4>
          <div className="flex flex-wrap gap-2">
            {CROP_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setCropPreset(p.value)}
                className={`rounded-xl px-3 py-2 text-[12px] font-medium transition-colors ${
                  cropPreset === p.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-foreground hover:bg-surface-3"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {/* Résolution */}
        <section>
          <h4 className="mb-2 text-[13px] font-medium text-foreground">Résolution de sortie</h4>
          <div className="flex flex-wrap gap-2">
            {RESOLUTION_PRESETS.map((p) => {
              const active = edit.targetShortSide === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setResolution(p.value)}
                  className={`rounded-xl px-3 py-2 text-[12px] font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-foreground hover:bg-surface-3"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Sortie effective : {outLabel} ({width}×{height} avant scaling)
            {scaled ? " · réduite pour respecter le petit côté choisi" : ""}
          </p>
        </section>

        <PrimaryButton onClick={onClose}>Appliquer</PrimaryButton>
      </div>
    </BottomSheet>
  );
}
