/**
 * Static catalogs for the Automatisations editor.
 */
import type { ActionKind, ConditionKind, TriggerKind } from "./types";

export type CatalogEntry<K extends string> = {
  kind: K;
  label: string;
  description: string;
  soon?: boolean;
};

export const TRIGGER_CATALOG: CatalogEntry<TriggerKind>[] = [
  {
    kind: "scheduled_time",
    label: "À une heure programmée",
    description: "Une seule fois à l'heure choisie",
  },
  { kind: "daily", label: "Tous les jours", description: "Chaque jour à l'heure choisie" },
  { kind: "weekly", label: "Certains jours de la semaine", description: "Jours et heure au choix" },
  {
    kind: "app_open",
    label: "À l'ouverture de GeniusFiles",
    description: "Dès que l'application démarre",
  },
  {
    kind: "file_added",
    label: "Nouveau fichier dans un dossier",
    description: "Surveille un dossier",
  },
  {
    kind: "folder_changed",
    label: "Un dossier est modifié",
    description: "Ajout, suppression ou renommage",
  },
  { kind: "storage_low", label: "Stockage faible", description: "Sous un pourcentage libre" },
  {
    kind: "device_connected",
    label: "Périphérique connecté",
    description: "Clé USB, carte SD, etc.",
  },
];

export const CONDITION_CATALOG: CatalogEntry<ConditionKind>[] = [
  { kind: "file_type", label: "Type de fichier", description: "Images, vidéos, documents…" },
  { kind: "size_min", label: "Taille minimale", description: "Au-dessus d'une valeur" },
  { kind: "size_max", label: "Taille maximale", description: "En-dessous d'une valeur" },
  { kind: "name_contains", label: "Nom contenant", description: "Filtre par mot-clé" },
  { kind: "location", label: "Emplacement", description: "Dossier ciblé" },
  { kind: "created_after", label: "Créé après", description: "Date de création minimale" },
  { kind: "modified_after", label: "Modifié après", description: "Date de modification minimale" },
  {
    kind: "storage_available",
    label: "Espace disponible",
    description: "Au moins X octets libres",
  },
];

export const ACTION_CATALOG: CatalogEntry<ActionKind>[] = [
  {
    kind: "copy",
    label: "Copier",
    description: "Sélectionne des éléments et les copie vers un dossier",
  },
  {
    kind: "move",
    label: "Déplacer",
    description: "Sélectionne des éléments et les déplace vers un dossier",
  },
  { kind: "rename", label: "Renommer", description: "Applique un modèle avec variables" },
  {
    kind: "trash",
    label: "Envoyer à la Corbeille",
    description: "Sélection à supprimer (réversible)",
  },
  { kind: "compress", label: "Compresser", description: "Créer une archive ZIP" },
  { kind: "extract", label: "Décompresser", description: "Extraire une archive" },
  { kind: "backup", label: "Sauvegarder", description: "Copie vers un dossier de sauvegarde" },
  { kind: "mkdir", label: "Créer un dossier", description: "Emplacement puis nom" },
  {
    kind: "organize",
    label: "Organiser des fichiers",
    description: "Classe le dossier source par règle",
  },
  { kind: "cleaner_scan", label: "Analyse du Nettoyeur", description: "Lance un scan intelligent" },
  { kind: "notify", label: "Envoyer une notification", description: "Message personnalisé" },
  {
    kind: "open_module",
    label: "Ouvrir un module",
    description: "Fichiers, Nettoyeur, Corbeille…",
  },
];

export const OPENABLE_MODULES: { route: string; label: string }[] = [
  { route: "/", label: "Fichiers" },
  { route: "/nettoyeur", label: "Nettoyeur" },
  { route: "/corbeille", label: "Corbeille" },
  { route: "/pdf-outils", label: "Outils PDF" },
  { route: "/transfert", label: "Transfert" },
  { route: "/coffre-fort", label: "Coffre-fort" },
];

export const WEEK_DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
