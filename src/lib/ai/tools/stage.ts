/**
 * Étape d'exécution en cours du moteur — canal minimal et unidirectionnel.
 *
 * Le pont IA→moteur publie un libellé humain (jamais de chemin, jamais de
 * nom de fichier, jamais de vocabulaire technique) que l'interface affiche
 * dans sa ligne d'activité. Aucune donnée de fichier ne transite ici : ce
 * n'est qu'un texte d'état, remis à `null` dès la fin de la commande.
 */
type Listener = () => void;

let current: string | null = null;
const listeners = new Set<Listener>();

export function setEngineStage(label: string | null): void {
  if (current === label) return;
  current = label;
  for (const l of listeners) l();
}

export function getEngineStage(): string | null {
  return current;
}

export function subscribeEngineStage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Libellés de démarrage par type de commande moteur. */
export const ENGINE_STAGE_LABELS: Record<string, string> = {
  list_storage_roots: "Lecture des emplacements…",
  list: "Lecture de vos dossiers…",
  search: "Recherche des fichiers…",
  analyze: "Analyse du stockage…",
  properties: "Lecture des informations…",
  create: "Création du dossier…",
  rename: "Renommage en cours…",
  delete: "Suppression en cours…",
  copy: "Copie des fichiers…",
  move: "Déplacement des fichiers…",
  organize: "Rangement des fichiers…",
  compress: "Compression en cours…",
  extract: "Extraction en cours…",
  share: "Préparation du partage…",
  sort: "Tri des fichiers…",
  filter: "Filtrage des fichiers…",
};

export function engineStageLabel(type: string): string {
  return ENGINE_STAGE_LABELS[type] ?? "Le moteur d'exécution traite votre demande…";
}

/**
 * Étape enrichie de la progression réelle du moteur. On n'expose qu'un
 * compteur : ni nom de fichier, ni dossier parcouru.
 */
export function engineProgressLabel(type: string, processed: number, total: number): string {
  const base = engineStageLabel(type);
  if (!Number.isFinite(processed) || processed <= 0) return base;
  const n = processed.toLocaleString("fr-FR");
  switch (type) {
    case "search":
      return `Recherche des fichiers… ${n} trouvé${processed > 1 ? "s" : ""}`;
    case "analyze":
      return `Analyse du stockage… ${n} élément${processed > 1 ? "s" : ""} lu${processed > 1 ? "s" : ""}`;
    case "copy":
    case "move":
    case "organize":
    case "delete":
    case "compress":
    case "extract": {
      const suffix = total > 0 ? `${n} / ${total.toLocaleString("fr-FR")}` : n;
      return `${base.replace(/…$/, "")} ${suffix}…`;
    }
    default:
      return base;
  }
}
