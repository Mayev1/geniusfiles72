/**
 * Détection des capacités d'analyse disponibles selon l'environnement.
 *
 * Tout est probing léger — pas de télémétrie, pas de blocage : les
 * fonctions demandant un modèle non embarqué retournent `available: false`
 * et le moteur propose alors l'alternative locale la plus proche.
 */
import { isAndroidNative } from "@/lib/native/geniusfiles-native";
import type { Capability } from "./types";

let cache: Capability[] | null = null;

export function listCapabilities(): Capability[] {
  if (cache) return cache;
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const native = isAndroidNative();
  cache = [
    { id: "text", label: "Lecture texte / code / CSV", available: true, needsOnline: false },
    {
      id: "pdf",
      label: "Extraction texte PDF",
      // Extraction native : dépend d'un chargement dynamique de pdf.js
      // effectué au premier usage. On l'annonce comme disponible : l'échec
      // au runtime est capturé et remonté proprement.
      available: true,
      needsOnline: false,
      fallback: "Ouverture dans le Lecteur universel",
    },
    {
      id: "ocr",
      label: "OCR (images & documents numérisés)",
      // Le moteur OCR est chargé à la demande depuis un CDN sur mobile.
      // Sans connexion et sans cache, on retombe sur l'extraction basique.
      available: true,
      needsOnline: !native,
      fallback: "Analyse visuelle sans OCR",
    },
    {
      id: "image",
      label: "Analyse visuelle & regroupement",
      available: true,
      needsOnline: false,
    },
    {
      id: "media_meta",
      label: "Métadonnées audio / vidéo",
      available: true,
      needsOnline: false,
    },
    // Réservations — activables sans changement d'UI :
    {
      id: "face",
      label: "Reconnaissance faciale locale",
      available: false,
      needsOnline: false,
      fallback: "Regroupement par similarité visuelle",
    },
    {
      id: "transcription",
      label: "Transcription audio",
      available: false,
      needsOnline: true,
      fallback: "Métadonnées et écoute manuelle",
    },
    {
      id: "video_summary",
      label: "Résumé intelligent de vidéos",
      available: false,
      needsOnline: true,
      fallback: "Miniatures + métadonnées",
    },
    {
      id: "translation",
      label: "Traduction automatique",
      available: false,
      needsOnline: true,
      fallback: "Détection de langue locale",
    },
    {
      id: "visual_dedup",
      label: "Détection avancée des doublons visuels",
      available: true,
      needsOnline: false,
    },
    {
      id: "multimodal",
      label: "Recherche multimodale",
      available: false,
      needsOnline: true,
      fallback: "Recherche par contenu + tags locaux",
    },
  ];
  // Ajuster selon la connectivité
  cache = cache.map((c) => (c.needsOnline && !online ? { ...c, available: false } : c));
  return cache;
}

export function capabilityAvailable(id: Capability["id"]): boolean {
  return listCapabilities().some((c) => c.id === id && c.available);
}

export function refreshCapabilities() {
  cache = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", refreshCapabilities);
  window.addEventListener("offline", refreshCapabilities);
}
