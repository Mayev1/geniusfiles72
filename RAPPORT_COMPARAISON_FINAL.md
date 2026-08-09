# Rapport de comparaison — clone de `Mayev1/geniusfiles66`

Source de vérité : `https://github.com/Mayev1/geniusfiles66.git` (branche par défaut, clone `--depth 1`).
Méthode : copie fichier par fichier (rsync) de la totalité du dépôt, sans refactor, sans simplification, sans modification de design.

## Éléments reproduits à l'identique

- `src/` complet : `routes/` (toutes les pages : index, applications, assistant, automatisations(+historique), categorie.$kind, coffre-fort, corbeille, diagnostic-clavier, editeur-audio, editeur-video, fichiers-recents, nettoyeur, organisation, outils, parametres, pdf-outils, recherche, transfert), `routes/api/public/`, `__root.tsx`, `components/`, `hooks/`, `lib/`, `types/`, `assets/`, `router.tsx`, `server.ts`, `start.ts`, `styles.css`, `routeTree.gen.ts`
- Design system intégral (`src/styles.css`, tokens, animations) — aucune valeur modifiée
- `public/` (brand, favicons, robots.txt, assets statiques)
- Chaîne mobile APK/AAB : `capacitor.config.ts`, `android-overrides/app/**`, `ANDROID_BUILD.md`, `.github/workflows/android-build.yml`, `scripts/build-mobile.mjs`, `scripts/apply-android-overrides.mjs`, `scripts/generate-app-icons.mjs`, `resources/source-logo.png`
- Configuration : `package.json` (dépendances + scripts identiques, y compris `build:mobile`, `android:*`), `bun.lock`, `bunfig.toml`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `components.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`
- Documentation et mémoire projet : `AGENTS.md`, `README.md`, `src/routes/README.md`, `.lovable/plan/*` (3 plans archivés), rapports existants (`RAPPORT_CLONE.md`, `RAPPORT_CLONE_FIDELE.md`, `RAPPORT_COMPARAISON.md`, `RAPPORT_COMPARAISON_CLONE.md`, `RAPPORT_COPIE_FIDELE.md`)

## Base de données

Le dépôt source ne contient **aucun backend** : pas de migration SQL, pas de dossier `supabase/`, aucune référence à Supabase/Lovable Cloud dans `src/` ou `package.json`. La persistance est locale (stockage navigateur / Capacitor Preferences / Filesystem). Il n'y a donc aucun schéma, relation ou contrainte à reproduire — la structure de données est celle définie dans `src/types/` et `src/lib/`, copiée à l'identique.

## Différences détectées

- `.lovable/project.json` : conservé celui de ce projet (identifiant de projet propre à la plateforme). Aucun impact fonctionnel.
- `dist-mobile/` absent du dépôt source (sortie de build, ignorée par git). Il est régénéré par `bun run build:mobile`.
- `node_modules` réinstallé depuis `bun.lock` ; quelques versions patch résolues plus récemment (semver `^`), conformément au lockfile/ranges d'origine.
- Répertoire `android/` absent du source (généré par `npx cap add android`), comme prévu par le workflow de build.

## Éléments impossibles à reproduire exactement

- Historique Git du dépôt source (clone superficiel), branches et tags.
- Historique de conversation Lovable du projet d'origine (seuls les plans archivés dans `.lovable/plan/` existent dans le dépôt).
- Secrets/variables d'environnement : seul `.env.example` est versionné ; les valeurs réelles ne figurent pas dans le dépôt.

## Actions manuelles requises

1. Renseigner les variables listées dans `.env.example` (ex. clés d'API de l'assistant) si les fonctionnalités correspondantes doivent être actives.
2. Pour l'APK/AAB : exécuter `bun run android:build` (nécessite JDK + Android SDK), ou déclencher le workflow `.github/workflows/android-build.yml`.
3. Reconnecter les intégrations GitHub/déploiement de ce nouveau projet si un push vers un dépôt est souhaité.

## Vérifications

- Serveur de dev : démarre, `/` répond en SSR (`lang="fr"`, splash brand préchargé).
- Typecheck TypeScript : aucune erreur.
- Tests : aucun fichier de test présent dans le dépôt source (`src/**/*.test.ts` vide) — statu quo conservé.
