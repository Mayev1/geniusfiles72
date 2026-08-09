/**
 * Paramètres d'édition vidéo — étapes 5 et 6.
 *
 * Ce fichier est le contrat entre l'interface, l'aperçu WebGL et le moteur
 * natif Android. Toutes les valeurs par défaut sont neutres : un objet
 * `VideoEdit` frais ne modifie strictement rien au fichier source.
 */

import type { AudioClip, VideoLayer } from "@/lib/video/layers";
import { toNativeAudio, toNativeLayers } from "@/lib/video/layers";

export type VideoEdit = {
  /** Rotation appliquée aux pixels : 0, 90, 180 ou 270. */
  rotation: 0 | 90 | 180 | 270;
  /** Recadrage normalisé par rapport à la vidéo d'origine. */
  crop: { x: number; y: number; w: number; h: number };
  /** Petit côté visé en pixels ; 0 = conserver la résolution d'origine. */
  targetShortSide: number;
  /** Vitesse de lecture : 0.25 → 4.0. */
  speed: number;
  /** Volume de la piste audio : 0 → 2.0. */
  volume: number;
  /** Coupe entièrement le son. */
  muted: boolean;
  /** Réglages d'image. Tous à 0 = inchangé. */
  brightness: number;
  contrast: number;
  exposure: number;
  saturation: number;
  temperature: number;
  tint: number;
  sharpness: number;
  /** Calques composés à l'export (étape 7). */
  layers: VideoLayer[];
  /** Pistes audio importées, mixées à l'export (étape 7). */
  audioTracks: AudioClip[];
};

export const DEFAULT_EDIT: VideoEdit = {
  rotation: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  targetShortSide: 0,
  speed: 1,
  volume: 1,
  muted: false,
  brightness: 0,
  contrast: 0,
  exposure: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  layers: [],
  audioTracks: [],
};

/** Préréglages de recadrage (ratios). */
export type CropPreset = "original" | "free" | "1:1" | "4:3" | "16:9" | "9:16" | "3:4";

export const CROP_PRESETS: { value: CropPreset; label: string; ratio?: number }[] = [
  { value: "original", label: "Original" },
  { value: "free", label: "Libre" },
  { value: "1:1", label: "1:1", ratio: 1 },
  { value: "4:3", label: "4:3", ratio: 4 / 3 },
  { value: "3:4", label: "3:4", ratio: 3 / 4 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
  { value: "9:16", label: "9:16", ratio: 9 / 16 },
];

/** Préréglages de résolution (petit côté). 0 = original. */
export const RESOLUTION_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Original" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
  { value: 480, label: "480p" },
  { value: 360, label: "360p" },
];

/** Filtres construits sur les mêmes réglages colorimétriques. */
export type FilterPreset =
  | "none"
  | "natural"
  | "warm"
  | "cool"
  | "bw"
  | "cinema"
  | "vintage"
  | "dramatic"
  | "soft";

export const FILTER_PRESETS: { value: FilterPreset; label: string }[] = [
  { value: "none", label: "Aucun" },
  { value: "natural", label: "Naturel" },
  { value: "warm", label: "Chaud" },
  { value: "cool", label: "Froid" },
  { value: "bw", label: "Noir & blanc" },
  { value: "cinema", label: "Cinéma" },
  { value: "vintage", label: "Vintage" },
  { value: "dramatic", label: "Dramatique" },
  { value: "soft", label: "Doux" },
];

export function filterValues(preset: FilterPreset): Partial<VideoEdit> {
  switch (preset) {
    case "natural":
      return { brightness: 0.02, contrast: 0.02, saturation: 0.05, sharpness: 0.05 };
    case "warm":
      return { temperature: 0.08, saturation: 0.06, brightness: 0.02 };
    case "cool":
      return { temperature: -0.08, tint: -0.03, saturation: 0.04 };
    case "bw":
      return { saturation: -1 };
    case "cinema":
      return { contrast: 0.08, saturation: -0.15, brightness: -0.04, sharpness: 0.08 };
    case "vintage":
      return { temperature: 0.12, contrast: -0.06, saturation: -0.25, brightness: 0.04 };
    case "dramatic":
      return { contrast: 0.18, saturation: 0.12, sharpness: 0.12, exposure: 0.04 };
    case "soft":
      return { contrast: -0.08, saturation: -0.1, sharpness: -0.12, brightness: 0.03 };
    default:
      return {};
  }
}

/** Applique un filtre tout en préservant les réglages manuels déjà faits. */
export function applyFilter(base: VideoEdit, preset: FilterPreset): VideoEdit {
  if (preset === "none") {
    // On garde rotation/crop/speed/volume, on réinitialise les réglages image.
    return {
      ...base,
      brightness: 0,
      contrast: 0,
      exposure: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      sharpness: 0,
    };
  }
  const vals = filterValues(preset);
  return { ...base, ...vals };
}

/** Vrai si au moins un réglage image/son/rotation/crop est actif. */
export function isEditActive(edit: VideoEdit): boolean {
  return (
    edit.rotation !== 0 ||
    edit.crop.x !== 0 ||
    edit.crop.y !== 0 ||
    edit.crop.w !== 1 ||
    edit.crop.h !== 1 ||
    edit.targetShortSide !== 0 ||
    edit.speed !== 1 ||
    edit.volume !== 1 ||
    edit.muted ||
    edit.brightness !== 0 ||
    edit.contrast !== 0 ||
    edit.exposure !== 0 ||
    edit.saturation !== 0 ||
    edit.temperature !== 0 ||
    edit.tint !== 0 ||
    edit.sharpness !== 0 ||
    edit.layers.length > 0 ||
    edit.audioTracks.length > 0
  );
}

/** Format attendu par le plugin natif (`readEdit` côté Kotlin). */
export function toNativeEdit(edit: VideoEdit): Record<string, unknown> {
  return {
    rotation: edit.rotation,
    cropX: edit.crop.x,
    cropY: edit.crop.y,
    cropW: edit.crop.w,
    cropH: edit.crop.h,
    targetShortSide: edit.targetShortSide,
    speed: edit.speed,
    volume: edit.volume,
    muted: edit.muted,
    brightness: edit.brightness,
    contrast: edit.contrast,
    exposure: edit.exposure,
    saturation: edit.saturation,
    temperature: edit.temperature,
    tint: edit.tint,
    sharpness: edit.sharpness,
    layers: toNativeLayers(edit.layers),
    audioTracks: toNativeAudio(edit.audioTracks),
  };
}

/** Calcul du recadrage à partir d'un ratio cible et des dimensions source. */
export function cropForRatio(
  srcW: number,
  srcH: number,
  ratio: number,
): { x: number; y: number; w: number; h: number } {
  const srcRatio = srcW / srcH;
  let w = 1;
  let h = 1;
  if (srcRatio > ratio) {
    h = 1;
    w = ratio / srcRatio;
  } else {
    w = 1;
    h = srcRatio / ratio;
  }
  const x = (1 - w) / 2;
  const y = (1 - h) / 2;
  return { x, y, w, h };
}

/** Dimensions effectives après rotation et recadrage, sans redimensionnement final. */
export function effectiveDimensions(
  srcW: number,
  srcH: number,
  edit: VideoEdit,
): { width: number; height: number } {
  const cropW = Math.max(1, Math.round(srcW * edit.crop.w));
  const cropH = Math.max(1, Math.round(srcH * edit.crop.h));
  const swap = edit.rotation === 90 || edit.rotation === 270;
  const width = swap ? cropH : cropW;
  const height = swap ? cropW : cropH;
  return { width, height };
}

/** Petit côté effectif après recadrage/rotation, avant le scaling final. */
export function naturalShortSide(srcW: number, srcH: number, edit: VideoEdit): number {
  const { width, height } = effectiveDimensions(srcW, srcH, edit);
  return Math.min(width, height);
}

/** Description courte de la résolution choisie. */
export function resolutionLabel(edit: VideoEdit, srcW: number, srcH: number): string {
  const { width, height } = effectiveDimensions(srcW, srcH, edit);
  const short = edit.targetShortSide || naturalShortSide(srcW, srcH, edit);
  const long = Math.round((short * Math.max(width, height)) / Math.min(width, height));
  return `${Math.max(short, long)}×${Math.min(short, long)}`;
}
