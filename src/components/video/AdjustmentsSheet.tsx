/**
 * Feuille de réglages image et son — étape 6.
 *
 * Filtres prédéfinis, curseurs de réglages, vitesse, volume/muet, et
 * extraction de la bande son. Tout est appliqué en temps réel à l'aperçu
 * WebGL et transmis au moteur natif à l'export.
 */
import { useState } from "react";
import { Music, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { BottomSheet, PrimaryButton } from "@/components/files/BottomSheet";
import { FILTER_PRESETS, applyFilter, type FilterPreset, type VideoEdit } from "@/lib/video/edit";

type SliderDef = { key: keyof VideoEdit; label: string; min: number; max: number; step: number };

const SLIDERS: SliderDef[] = [
  { key: "brightness", label: "Luminosité", min: -1, max: 1, step: 0.02 },
  { key: "contrast", label: "Contraste", min: -1, max: 1, step: 0.02 },
  { key: "exposure", label: "Exposition", min: -1, max: 1, step: 0.02 },
  { key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.02 },
  { key: "temperature", label: "Température", min: -1, max: 1, step: 0.02 },
  { key: "tint", label: "Teinte", min: -1, max: 1, step: 0.02 },
  { key: "sharpness", label: "Netteté", min: -1, max: 1, step: 0.02 },
];

export function AdjustmentsSheet({
  open,
  onClose,
  edit,
  onChange,
  onExtractAudio,
}: {
  open: boolean;
  onClose: () => void;
  edit: VideoEdit;
  onChange: (edit: VideoEdit) => void;
  onExtractAudio?: () => void;
}) {
  const [filter, setFilter] = useState<FilterPreset>("none");

  const setValue = (key: keyof VideoEdit, value: number) => {
    onChange({ ...edit, [key]: value });
  };

  const reset = () => {
    setFilter("none");
    onChange({
      ...edit,
      brightness: 0,
      contrast: 0,
      exposure: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      sharpness: 0,
    });
  };

  const applyPreset = (preset: FilterPreset) => {
    setFilter(preset);
    onChange(applyFilter(edit, preset));
  };

  const speedLabel = `${edit.speed.toFixed(2).replace(".00", "").replace(/0$/, "").replace(/\.$/, "")}×`;

  return (
    <BottomSheet open={open} onClose={onClose} title="Image et son">
      <div className="space-y-5">
        {/* Filtres */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[13px] font-medium text-foreground">Filtres</h4>
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground active:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Réinitialiser
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTER_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => applyPreset(p.value)}
                className={`rounded-xl px-3 py-2 text-[12px] font-medium transition-colors ${
                  filter === p.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-foreground hover:bg-surface-3"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {/* Réglages */}
        <section className="space-y-3">
          <h4 className="text-[13px] font-medium text-foreground">Réglages</h4>
          {SLIDERS.map((s) => (
            <SliderRow
              key={s.key}
              label={s.label}
              value={edit[s.key] as number}
              min={s.min}
              max={s.max}
              step={s.step}
              onChange={(v) => setValue(s.key, v)}
            />
          ))}
        </section>

        {/* Vitesse */}
        <section>
          <h4 className="mb-2 text-[13px] font-medium text-foreground">Vitesse · {speedLabel}</h4>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={edit.speed}
            onChange={(e) => setValue("speed", parseFloat(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>0,25×</span>
            <span>1×</span>
            <span>4×</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            La hauteur du son suit la vitesse (comme une bande accélérée).
          </p>
        </section>

        {/* Volume */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[13px] font-medium text-foreground">Volume</h4>
            <button
              type="button"
              onClick={() => onChange({ ...edit, muted: !edit.muted })}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                edit.muted ? "bg-destructive/10 text-destructive" : "bg-surface-2 text-foreground"
              }`}
              aria-label={edit.muted ? "Réactiver le son" : "Couper le son"}
            >
              {edit.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={edit.muted ? 0 : edit.volume}
            disabled={edit.muted}
            onChange={(e) =>
              onChange({ ...edit, muted: false, volume: parseFloat(e.target.value) })
            }
            className="w-full accent-primary disabled:opacity-40"
          />
        </section>

        {/* Extraction audio */}
        {onExtractAudio ? (
          <section className="rounded-xl border border-border bg-surface-2/50 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Music className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">Extraire la bande son</p>
                <p className="text-[11px] text-muted-foreground">
                  Crée un fichier M4A avec les réglages appliqués.
                </p>
              </div>
              <button
                type="button"
                onClick={onExtractAudio}
                className="rounded-xl bg-secondary px-3 py-2 text-[12px] font-medium text-foreground active:scale-95"
              >
                Extraire
              </button>
            </div>
          </section>
        ) : null}

        <PrimaryButton onClick={onClose}>Appliquer</PrimaryButton>
      </div>
    </BottomSheet>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">
          {value > 0 ? "+" : ""}
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
        style={{
          background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${pct}%, hsl(var(--surface-3)) ${pct}%, hsl(var(--surface-3)) 100%)`,
        }}
      />
    </div>
  );
}
