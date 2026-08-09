/**
 * Calques de l'éditeur vidéo — étape 7.
 *
 * Un calque est une surimpression datée : il apparaît à `startMs` et
 * disparaît à `endMs`, exactement de la même façon dans l'aperçu et dans le
 * fichier exporté. Les coordonnées sont normalisées (0 → 1) par rapport à
 * l'image de sortie (après recadrage et rotation), donc indépendantes de la
 * résolution choisie.
 *
 * Ce fichier est le contrat partagé avec le moteur natif
 * (`VideoOverlay.kt` côté Android) : toute clé ajoutée ici doit être lue
 * là-bas, sinon le réglage n'existerait que dans l'aperçu — ce qui est
 * précisément ce qu'on refuse.
 */

export type LayerKind = "text" | "image" | "draw" | "effect";

type Base = {
  id: string;
  /** Fenêtre d'apparition sur la timeline de sortie, en millisecondes. */
  startMs: number;
  endMs: number;
  /** Cadre normalisé dans l'image de sortie. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation du calque en degrés (sens horaire). */
  rotation: number;
  /** Opacité 0 → 1. */
  opacity: number;
};

export type TextLayer = Base & {
  kind: "text";
  text: string;
  /** Couleur du texte, en hexadécimal `#rrggbb`. */
  color: string;
  /** Fond derrière le texte ; `null` = aucun. */
  background: string | null;
  /** Hauteur de police relative à la hauteur de l'image (0.02 → 0.4). */
  fontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
};

export type ImageLayer = Base & {
  kind: "image";
  /** Chemin absolu du fichier sur l'appareil (lu par le moteur natif). */
  path: string;
  /** URL utilisable par l'aperçu web. */
  previewUrl: string;
  name: string;
};

export type Stroke = {
  /** Points normalisés dans l'image de sortie, aplatis : x0,y0,x1,y1… */
  points: number[];
  color: string;
  /** Épaisseur relative à la hauteur de l'image. */
  width: number;
};

export type DrawLayer = Base & {
  kind: "draw";
  strokes: Stroke[];
};

export type EffectLayer = Base & {
  kind: "effect";
  mode: "blur" | "mosaic";
  /** Intensité 0 → 1. */
  strength: number;
};

export type VideoLayer = TextLayer | ImageLayer | DrawLayer | EffectLayer;

/** Piste audio importée, posée sur la timeline de sortie. */
export type AudioClip = {
  id: string;
  path: string;
  name: string;
  /** Position de départ sur la timeline de sortie, en millisecondes. */
  startMs: number;
  /** Décalage à l'intérieur du fichier source. */
  offsetMs: number;
  /** Durée jouée ; 0 = jusqu'à la fin du fichier. */
  durationMs: number;
  volume: number;
};

export const LAYER_LABELS: Record<LayerKind, string> = {
  text: "Texte",
  image: "Image",
  draw: "Dessin",
  effect: "Zone floutée",
};

/**
 * Identifiant stable et déterministe : dérivé du type et du plus grand
 * numéro déjà utilisé, jamais d'aléatoire (rendu serveur et client
 * identiques).
 */
export function nextLayerId(existing: Array<{ id: string }>, kind: string): string {
  let max = 0;
  for (const l of existing) {
    const m = /-(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${kind}-${max + 1}`;
}

export function layerLabel(layer: VideoLayer): string {
  switch (layer.kind) {
    case "text":
      return layer.text.trim() ? layer.text.trim().slice(0, 24) : "Texte";
    case "image":
      return layer.name || "Image";
    case "draw":
      return `Dessin (${layer.strokes.length} trait${layer.strokes.length > 1 ? "s" : ""})`;
    case "effect":
      return layer.mode === "mosaic" ? "Mosaïque" : "Flou";
  }
}

export function isVisibleAt(layer: { startMs: number; endMs: number }, ms: number): boolean {
  return ms >= layer.startMs && ms < layer.endMs;
}

export function visibleLayers(layers: VideoLayer[], ms: number): VideoLayer[] {
  return layers.filter((l) => isVisibleAt(l, ms));
}

/** Constructeurs — cadre centré par défaut, durée de 3 s à partir du curseur. */
export function makeTextLayer(id: string, atMs: number, endBoundMs: number): TextLayer {
  return {
    kind: "text",
    id,
    ...window_(atMs, endBoundMs),
    x: 0.1,
    y: 0.62,
    w: 0.8,
    h: 0.14,
    rotation: 0,
    opacity: 1,
    text: "Votre texte",
    color: "#ffffff",
    background: null,
    fontSize: 0.09,
    bold: true,
    align: "center",
  };
}

export function makeImageLayer(
  id: string,
  atMs: number,
  endBoundMs: number,
  file: { path: string; previewUrl: string; name: string },
): ImageLayer {
  return {
    kind: "image",
    id,
    ...window_(atMs, endBoundMs),
    x: 0.3,
    y: 0.35,
    w: 0.4,
    h: 0.3,
    rotation: 0,
    opacity: 1,
    path: file.path,
    previewUrl: file.previewUrl,
    name: file.name,
  };
}

export function makeDrawLayer(id: string, atMs: number, endBoundMs: number): DrawLayer {
  return {
    kind: "draw",
    id,
    ...window_(atMs, endBoundMs),
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    opacity: 1,
    strokes: [],
  };
}

export function makeEffectLayer(
  id: string,
  atMs: number,
  endBoundMs: number,
  mode: "blur" | "mosaic",
): EffectLayer {
  return {
    kind: "effect",
    id,
    ...window_(atMs, endBoundMs),
    x: 0.3,
    y: 0.3,
    w: 0.4,
    h: 0.3,
    rotation: 0,
    opacity: 1,
    mode,
    strength: 0.6,
  };
}

function window_(atMs: number, endBoundMs: number): { startMs: number; endMs: number } {
  const start = Math.max(0, Math.round(atMs));
  const bound = endBoundMs > start ? endBoundMs : start + 3000;
  return { startMs: start, endMs: Math.min(bound, start + 3000) };
}

/** Format attendu par le moteur natif (`readLayers` côté Kotlin). */
export function toNativeLayers(layers: VideoLayer[]): Array<Record<string, unknown>> {
  return layers.map((l) => {
    const common = {
      kind: l.kind,
      startMs: l.startMs,
      endMs: l.endMs,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      rotation: l.rotation,
      opacity: l.opacity,
    };
    switch (l.kind) {
      case "text":
        return {
          ...common,
          text: l.text,
          color: l.color,
          background: l.background ?? "",
          fontSize: l.fontSize,
          bold: l.bold,
          align: l.align,
        };
      case "image":
        return { ...common, path: l.path };
      case "draw":
        return {
          ...common,
          strokes: l.strokes.map((s) => ({
            points: s.points,
            color: s.color,
            width: s.width,
          })),
        };
      case "effect":
        return { ...common, mode: l.mode, strength: l.strength };
    }
  });
}

export function toNativeAudio(clips: AudioClip[]): Array<Record<string, unknown>> {
  return clips.map((c) => ({
    path: c.path,
    startMs: c.startMs,
    offsetMs: c.offsetMs,
    durationMs: c.durationMs,
    volume: c.volume,
  }));
}
