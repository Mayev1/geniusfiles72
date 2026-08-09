/**
 * Feuille des calques — étape 7.
 *
 * Ajout, réglage et suppression des surimpressions (texte, image, dessin,
 * flou / mosaïque) et des pistes audio importées. Chaque calque a une
 * fenêtre d'apparition réglable, visible sur la timeline et respectée à
 * l'export.
 */
import { Image as ImageIcon, Music, Pencil, Plus, Squircle, Trash2, Type } from "lucide-react";
import { BottomSheet } from "@/components/files/BottomSheet";
import { fmtTime } from "@/components/player/format";
import type { AudioClip, LayerKind, VideoLayer } from "@/lib/video/layers";
import { LAYER_LABELS, layerLabel } from "@/lib/video/layers";

const TEXT_COLORS = ["#ffffff", "#000000", "#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ff2d95"];

export function LayersSheet({
  open,
  onClose,
  layers,
  audioTracks,
  selectedId,
  positionMs,
  durationMs,
  drawing,
  onSelect,
  onAdd,
  onChange,
  onRemove,
  onToggleDrawing,
  onAddAudio,
  onAudioChange,
  onAudioRemove,
}: {
  open: boolean;
  onClose: () => void;
  layers: VideoLayer[];
  audioTracks: AudioClip[];
  selectedId: string | null;
  positionMs: number;
  durationMs: number;
  drawing: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (kind: LayerKind, mode?: "blur" | "mosaic") => void;
  onChange: (id: string, patch: Partial<VideoLayer>) => void;
  onRemove: (id: string) => void;
  onToggleDrawing: () => void;
  onAddAudio: () => void;
  onAudioChange: (id: string, patch: Partial<AudioClip>) => void;
  onAudioRemove: (id: string) => void;
}) {
  const selected = layers.find((l) => l.id === selectedId) ?? null;

  return (
    <BottomSheet open={open} onClose={onClose} title="Calques">
      <div className="space-y-5">
        {/* Ajout */}
        <section>
          <h4 className="mb-2 text-[13px] font-medium text-foreground">Ajouter</h4>
          <div className="grid grid-cols-5 gap-2">
            <AddButton label="Texte" onPress={() => onAdd("text")}>
              <Type className="h-4 w-4" />
            </AddButton>
            <AddButton label="Image" onPress={() => onAdd("image")}>
              <ImageIcon className="h-4 w-4" />
            </AddButton>
            <AddButton label="Dessin" onPress={() => onAdd("draw")}>
              <Pencil className="h-4 w-4" />
            </AddButton>
            <AddButton label="Flou" onPress={() => onAdd("effect", "blur")}>
              <Squircle className="h-4 w-4" />
            </AddButton>
            <AddButton label="Mosaïque" onPress={() => onAdd("effect", "mosaic")}>
              <Plus className="h-4 w-4" />
            </AddButton>
          </div>
        </section>

        {/* Liste */}
        <section>
          <h4 className="mb-2 text-[13px] font-medium text-foreground">
            Calques ({layers.length})
          </h4>
          {layers.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Aucun calque. Les calques ajoutés ici sont composés dans le fichier exporté.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {layers.map((l) => (
                <li key={l.id}>
                  <div
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                      selectedId === l.id ? "border-primary bg-primary/5" : "border-border/60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(selectedId === l.id ? null : l.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-[13px] font-medium">{layerLabel(l)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {LAYER_LABELS[l.kind]} · {fmtTime(l.startMs / 1000)} →{" "}
                        {fmtTime(l.endMs / 1000)}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`Supprimer ${layerLabel(l)}`}
                      onClick={() => onRemove(l.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:scale-95"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Réglages du calque sélectionné */}
        {selected ? (
          <section className="space-y-3 rounded-xl border border-border/60 p-3">
            <h4 className="text-[13px] font-medium text-foreground">
              {LAYER_LABELS[selected.kind]} — réglages
            </h4>

            <Range
              label="Début"
              value={selected.startMs}
              min={0}
              max={Math.max(durationMs, 1000)}
              step={100}
              display={fmtTime(selected.startMs / 1000)}
              onChange={(v) =>
                onChange(selected.id, { startMs: Math.min(v, selected.endMs - 200) })
              }
            />
            <Range
              label="Fin"
              value={selected.endMs}
              min={0}
              max={Math.max(durationMs, 1000)}
              step={100}
              display={fmtTime(selected.endMs / 1000)}
              onChange={(v) =>
                onChange(selected.id, { endMs: Math.max(v, selected.startMs + 200) })
              }
            />
            <button
              type="button"
              onClick={() => onChange(selected.id, { startMs: Math.round(positionMs) })}
              className="text-[11px] font-medium text-primary"
            >
              Commencer à la position actuelle ({fmtTime(positionMs / 1000)})
            </button>

            <Range
              label="Opacité"
              value={selected.opacity}
              min={0.05}
              max={1}
              step={0.05}
              display={`${Math.round(selected.opacity * 100)} %`}
              onChange={(v) => onChange(selected.id, { opacity: v })}
            />
            <Range
              label="Rotation"
              value={selected.rotation}
              min={-180}
              max={180}
              step={1}
              display={`${Math.round(selected.rotation)}°`}
              onChange={(v) => onChange(selected.id, { rotation: v })}
            />

            {selected.kind === "text" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-[12px] text-muted-foreground">Texte</span>
                  <textarea
                    value={selected.text}
                    rows={2}
                    onChange={(e) =>
                      onChange(selected.id, { text: e.target.value } as Partial<VideoLayer>)
                    }
                    className="w-full rounded-lg border border-border/60 bg-background px-2 py-1.5 text-[13px]"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Couleur ${c}`}
                      onClick={() => onChange(selected.id, { color: c } as Partial<VideoLayer>)}
                      className={`h-7 w-7 rounded-full border-2 ${
                        selected.color === c ? "border-primary" : "border-border/60"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <Range
                  label="Taille"
                  value={selected.fontSize}
                  min={0.03}
                  max={0.3}
                  step={0.005}
                  display={`${Math.round(selected.fontSize * 100)} %`}
                  onChange={(v) => onChange(selected.id, { fontSize: v } as Partial<VideoLayer>)}
                />
                <div className="flex items-center gap-2">
                  <Toggle
                    active={selected.bold}
                    onPress={() =>
                      onChange(selected.id, { bold: !selected.bold } as Partial<VideoLayer>)
                    }
                  >
                    Gras
                  </Toggle>
                  <Toggle
                    active={!!selected.background}
                    onPress={() =>
                      onChange(selected.id, {
                        background: selected.background ? null : "#000000a0",
                      } as Partial<VideoLayer>)
                    }
                  >
                    Fond
                  </Toggle>
                  {(["left", "center", "right"] as const).map((a) => (
                    <Toggle
                      key={a}
                      active={selected.align === a}
                      onPress={() => onChange(selected.id, { align: a } as Partial<VideoLayer>)}
                    >
                      {a === "left" ? "Gauche" : a === "center" ? "Centre" : "Droite"}
                    </Toggle>
                  ))}
                </div>
              </>
            ) : null}

            {selected.kind === "draw" ? (
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-muted-foreground">
                  {drawing ? "Dessinez sur l'aperçu." : "Activez le tracé pour dessiner."}
                </p>
                <Toggle active={drawing} onPress={onToggleDrawing}>
                  {drawing ? "Terminer" : "Dessiner"}
                </Toggle>
              </div>
            ) : null}

            {selected.kind === "effect" ? (
              <>
                <div className="flex items-center gap-2">
                  <Toggle
                    active={selected.mode === "blur"}
                    onPress={() => onChange(selected.id, { mode: "blur" } as Partial<VideoLayer>)}
                  >
                    Flou
                  </Toggle>
                  <Toggle
                    active={selected.mode === "mosaic"}
                    onPress={() => onChange(selected.id, { mode: "mosaic" } as Partial<VideoLayer>)}
                  >
                    Mosaïque
                  </Toggle>
                </div>
                <Range
                  label="Intensité"
                  value={selected.strength}
                  min={0.1}
                  max={1}
                  step={0.05}
                  display={`${Math.round(selected.strength * 100)} %`}
                  onChange={(v) => onChange(selected.id, { strength: v } as Partial<VideoLayer>)}
                />
              </>
            ) : null}
          </section>
        ) : null}

        {/* Pistes audio importées */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[13px] font-medium text-foreground">
              Pistes audio ({audioTracks.length})
            </h4>
            <button
              type="button"
              onClick={onAddAudio}
              className="flex items-center gap-1 rounded-full bg-secondary/60 px-3 py-1.5 text-[12px] font-medium active:scale-95"
            >
              <Music className="h-3.5 w-3.5" />
              Importer
            </button>
          </div>
          {audioTracks.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Aucune piste importée. Le son importé est réellement mixé au son d'origine à l'export.
            </p>
          ) : (
            <ul className="space-y-2">
              {audioTracks.map((a) => (
                <li key={a.id} className="rounded-xl border border-border/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</p>
                    <button
                      type="button"
                      aria-label={`Supprimer ${a.name}`}
                      onClick={() => onAudioRemove(a.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:scale-95"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <Range
                    label="Position"
                    value={a.startMs}
                    min={0}
                    max={Math.max(durationMs, 1000)}
                    step={100}
                    display={fmtTime(a.startMs / 1000)}
                    onChange={(v) => onAudioChange(a.id, { startMs: v })}
                  />
                  <Range
                    label="Début dans le fichier"
                    value={a.offsetMs}
                    min={0}
                    max={Math.max(durationMs, 60000)}
                    step={100}
                    display={fmtTime(a.offsetMs / 1000)}
                    onChange={(v) => onAudioChange(a.id, { offsetMs: v })}
                  />
                  <Range
                    label="Durée"
                    value={a.durationMs}
                    min={0}
                    max={Math.max(durationMs, 60000)}
                    step={100}
                    display={a.durationMs > 0 ? fmtTime(a.durationMs / 1000) : "Tout"}
                    onChange={(v) => onAudioChange(a.id, { durationMs: v })}
                  />
                  <Range
                    label="Volume"
                    value={a.volume}
                    min={0}
                    max={2}
                    step={0.05}
                    display={`${Math.round(a.volume * 100)} %`}
                    onChange={(v) => onAudioChange(a.id, { volume: v })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </BottomSheet>
  );
}

function AddButton({
  children,
  label,
  onPress,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex flex-col items-center gap-1 rounded-xl border border-border/60 py-2 text-[11px] font-medium active:scale-95"
    >
      {children}
      {label}
    </button>
  );
}

function Toggle({
  children,
  active,
  onPress,
}: {
  children: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`rounded-full px-3 py-1.5 text-[12px] font-medium active:scale-95 ${
        active ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
        {label}
        <span className="tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}
