/**
 * Widgets Android — fondations.
 *
 * Ce module décrit les widgets possibles (id, tailles supportées, résumé
 * dynamique) et expose une couche de prévisualisation web utilisée dans
 * le centre de personnalisation. L'intégration Capacitor / AppWidgets
 * viendra plus tard sans modifier cette surface.
 */
import type { WidgetId } from "./types";

export type WidgetSize = "1x1" | "2x1" | "2x2" | "4x1" | "4x2";

export type WidgetDefinition = {
  id: WidgetId;
  label: string;
  description: string;
  supportedSizes: WidgetSize[];
  /** Route ouverte par un tap sur le widget. */
  route: string;
};

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    id: "storage-summary",
    label: "Espace de stockage",
    description: "Aperçu de l'espace utilisé, disponible et par catégorie.",
    supportedSizes: ["2x1", "2x2", "4x1"],
    route: "/",
  },
  {
    id: "favorites-shortcuts",
    label: "Dossiers favoris",
    description: "Ouverture directe de vos dossiers marqués comme favoris.",
    supportedSizes: ["2x1", "4x1", "4x2"],
    route: "/",
  },
  {
    id: "cleaner",
    label: "Nettoyeur intelligent",
    description: "Espace récupérable et lancement rapide de l'analyse.",
    supportedSizes: ["2x1", "2x2"],
    route: "/nettoyeur",
  },
  {
    id: "quick-search",
    label: "Recherche rapide",
    description: "Champ de recherche compact toujours accessible.",
    supportedSizes: ["4x1"],
    route: "/recherche",
  },
  {
    id: "quick-actions",
    label: "Actions rapides",
    description: "Vos actions préférées sur l'écran d'accueil du système.",
    supportedSizes: ["4x1", "4x2"],
    route: "/",
  },
];

export function getWidgetDefinition(id: WidgetId): WidgetDefinition | undefined {
  return WIDGET_DEFINITIONS.find((w) => w.id === id);
}
