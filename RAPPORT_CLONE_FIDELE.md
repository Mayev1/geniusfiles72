# Rapport de comparaison — Clone de `eliascous/geniusfiles54`

Source : https://github.com/eliascous/geniusfiles54.git (clone `--depth 1`, branche par défaut)
Méthode : copie fichier par fichier (rsync) de l'intégralité du dépôt, hors `.git` et `.lovable`
(métadonnées d'identité du projet Lovable courant).

## 1. Éléments reproduits à l'identique

- `src/` complet : 342 fichiers (routes, composants, hooks, lib, types, assets, `styles.css`,
  `router.tsx`, `start.ts`, `server.ts`, `routeTree.gen.ts`).
- Routes identiques : `/`, `applications`, `assistant`, `automatisations`,
  `automatisations.historique`, `categorie.$kind`, `coffre-fort`, `corbeille`,
  `diagnostic-clavier`, `fichiers-recents`, `nettoyeur`, `organisation`, `outils`,
  `parametres`, `pdf-outils`, `recherche`, `transfert`, plus `api/public/chat`.
- Design system, tokens, animations, navigation, états, parcours utilisateur : inchangés
  (aucune retouche, aucun refactor, aucune « correction » automatique).
- Configuration : `package.json` (dépendances et scripts identiques), `vite.config.ts`,
  `vitest.config.ts`, `tsconfig.json`, `components.json`, `eslint.config.js`, `.prettierrc`,
  `.prettierignore`, `.gitignore`, `bunfig.toml`, `bun.lock`, `AGENTS.md`, `README.md`.
- Chaîne mobile Android complète : `capacitor.config.ts`, `ANDROID_BUILD.md`,
  `android-overrides/app/**`, `.github/workflows/android-build.yml`,
  `scripts/build-mobile.mjs`, `scripts/apply-android-overrides.mjs`,
  `scripts/generate-app-icons.mjs`, `resources/source-logo.png`, `public/**`.
- Rapports d'origine conservés : `RAPPORT_CLONE.md`, `RAPPORT_COMPARAISON.md`,
  `RAPPORT_COPIE_FIDELE.md`.
- `.env.example` conservé tel quel.

## 2. Base de données

Le dépôt source ne contient **aucun backend base de données** : pas de dossier `supabase/`,
pas de migrations, pas de client Supabase, pas de schéma SQL. Toute la persistance est locale
(navigateur / `@capacitor/preferences` / système de fichiers). Il n'y a donc **aucun schéma,
relation ou contrainte à reproduire** — la compatibilité et la cohérence des données sont
intégralement conservées par la copie du code de persistance locale.

## 3. Différences détectées

- `.lovable/project.json` : conservé celui du projet courant (identifiant du projet Lovable).
  Le remplacer casserait l'association du projet ; aucun impact fonctionnel ou visuel.
- `bun install` a résolu certaines versions en plage `^` légèrement plus récentes que le
  lockfile source (React 19.2.5, Tailwind 4.2.4, etc.). Les plages déclarées dans
  `package.json` sont identiques au source.

## 4. Éléments impossibles à reproduire exactement

- `dist-mobile/` et `android/` : absents du dépôt source (artefacts de build ignorés par Git).
  Ils sont régénérés par `bun run build:mobile` puis `bun run android:build`.
- Historique Git, issues, secrets et variables d'environnement du dépôt d'origine : non
  transférables.

## 5. Actions manuelles requises

1. **Clé IA** : la route `src/routes/api/public/chat.ts` utilise l'AI Gateway ; définir
   `LOVABLE_API_KEY` côté serveur pour activer l'assistant.
2. **APK/AAB** : exécuter localement ou via le workflow GitHub Actions
   `.github/workflows/android-build.yml` :
   `bun run build:mobile && bun run android:build` (Android SDK + JDK requis, indisponibles
   dans l'environnement Lovable).
3. **Signature de l'app** : fournir le keystore de release pour un AAB publiable.
4. Optionnel : créer un `.env` à partir de `.env.example` pour surcharger `VITE_API_BASE_URL`
   avant le build natif.

## 6. Vérification

- Serveur de développement démarré, page `/` rendue sans erreur console, titre `GeniusFiles`.
- Rendu visuel conforme au design source (accueil, catégories, fichiers récents, outils,
  barre de navigation flottante).
