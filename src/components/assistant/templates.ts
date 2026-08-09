/**
 * Suggestions de requêtes affichées dans le bandeau Genius AI.
 *
 * Isolé du composant `TemplateMarquee` pour que le rechargement à chaud
 * ne concerne qu'un fichier de composants (règle react-refresh).
 */
export const TEMPLATES: string[] = [
  "Classe toutes les photos par année puis par mois.",
  "Déplace toutes les vidéos de plus de 500 Mo vers un dossier Vidéos volumineuses.",
  "Recherche tous les PDF modifiés durant les 30 derniers jours.",
  "Affiche les dossiers occupant le plus d'espace sur le stockage interne.",
  "Recherche toutes les vidéos enregistrées cette semaine.",
  "Range le dossier Téléchargements par type de fichier.",
  "Renomme toutes les images en utilisant leur date de prise de vue.",
  "Déplace tous les documents de travail dans un dossier Archives.",
  "Trouve les fichiers inutilisés depuis plus de deux ans.",
  "Analyse tout mon stockage et explique ce qui occupe le plus d'espace.",
  "Liste tous les fichiers audio de moins de deux minutes.",
  "Recherche toutes les captures d'écran prises aujourd'hui.",
  "Compresse le dossier Documents dans une archive ZIP.",
  "Combien de fichiers PDF ai-je sur mon téléphone ?",
];
