/**
 * Contrat unique entre Genius AI et le moteur d'exécution local.
 *
 * Un SEUL outil est exposé au modèle : `run_engine_command`. Le modèle
 * produit une commande structurée `{ type, params }` ; le moteur seul
 * touche au stockage et renvoie le résultat réel.
 *
 * Règles pour les schémas Zod exposés au modèle (voir knowledge
 * `ai-sdk-agent-patterns`) : pas de `.min()`/`.max()`, pas d'énumération
 * volumineuse. Les contraintes réelles sont validées par le moteur, qui
 * reste la source de vérité unique.
 */
import { tool } from "ai";
import { z } from "zod";

export const engineTools = {
  run_engine_command: tool({
    description:
      "Exécute RÉELLEMENT une commande sur le moteur de fichiers local de GeniusFiles (vraies API Android, vrais fichiers). Seul canal autorisé pour agir sur le stockage : lister, rechercher, analyser, lire les propriétés, créer un dossier, renommer, déplacer, copier, supprimer, ranger, compresser, extraire, partager, trier, filtrer. Appelle cet outil immédiatement dès qu'un ordre est donné, sans demander confirmation — sauf suppression définitive ou écrasement de données. N'invente JAMAIS un résultat : seule la sortie de cet outil reflète l'état réel du stockage.",
    inputSchema: z.object({
      type: z
        .string()
        .describe(
          "Type de commande : `list_storage_roots`, `list`, `search`, `analyze`, `properties`, `create`, `rename`, `delete`, `copy`, `move`, `organize`, `compress`, `extract`, `share`, `sort`, `filter`.",
        ),
      params: z
        .unknown()
        .describe(
          "Paramètres. Un chemin est toujours { rootId, segments: string[] } (segments vide = racine). Racines internes : internal, documents, downloads, pictures, movies, music ; externes : sdcard ou ext:XXXX-XXXX. " +
            "`list` : { path }. " +
            "`search` : { query?, roots: path[], limit?, kind?: 'image'|'video'|'audio'|'document'|'pdf'|'text'|'code'|'apk'|'archive'|'folder', exts?: string[] (sans le point), size?, date? }. " +
            "`analyze` : { roots: path[] }. " +
            "`properties` : { parent, name }. " +
            "`create` : { parent, name }. " +
            "`rename` : { parent, oldName, newName }. " +
            "`delete` : { parent, names: string[] }. " +
            "`copy`/`move` : { source, destination, names: string[] } ou { source, destination, all: true }. " +
            "`organize` : { folder, rule?: 'type'|'date' }. " +
            "`compress` : { parent, names: string[], destination?, archiveName, format?: 'zip'|'tar'|'tar.gz' }. " +
            "`extract` : { parent, name, destination? }. " +
            "`share` : { parent, names: string[] }.",
        ),
    }),
  }),
} as const;

export type EngineToolName = keyof typeof engineTools;
