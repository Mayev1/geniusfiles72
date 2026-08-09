# Rapport de comparaison — Clone de `Mayev1/geniusfiles60`

Date : 2026-08-08
Source de référence : https://github.com/Mayev1/geniusfiles60.git (clone `--depth 1`, branche par défaut)
Méthode : copie intégrale fichier par fichier (`rsync -a`), sans refactorisation, sans modification de code.

## 1. Éléments reproduits (identiques à l'octet près)

- `src/` complet : `routes/` (toutes les pages et `api/`), `components/` (analysis, assistant, audio, brand, common, files, home, jobs, navigation, organizer, pdf, photo, player, settings, transfer, ui, vault, viewer), `hooks/`, `lib/`, `types/`, `assets/`, `styles.css`, `router.tsx`, `server.ts`, `start.ts`
- Design system, animations, états, navigation, parcours utilisateur : inchangés (aucun fichier de style ou composant modifié)
- Règles métier et comportements : code source copié tel quel, aucune correction automatique appliquée
- Configuration : `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `components.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `bunfig.toml`, `.env.example`
- Dépendances : `package.json` + `bun.lock` identiques (751 paquets installés)
- Mobile / APK / AAB : `capacitor.config.ts`, `ANDROID_BUILD.md`, `android-overrides/app/**`, `scripts/build-mobile.mjs`, `scripts/apply-android-overrides.mjs`, `scripts/generate-app-icons.mjs`, `.github/workflows/android-build.yml`, `resources/source-logo.png`, `public/brand/**`, ainsi que les scripts npm `build:mobile`, `android:init/sync/overrides/icons/apk/aab/build`
- Documentation existante : `AGENTS.md`, `README.md`, `RAPPORT_CLONE.md`, `RAPPORT_CLONE_FIDELE.md`, `RAPPORT_COMPARAISON.md`, `RAPPORT_COPIE_FIDELE.md`

## 2. Différences détectées

| Élément | Différence | Impact |
|---|---|---|
| `src/routeTree.gen.ts` | Régénéré automatiquement par le plugin TanStack Router au démarrage | Aucun — fichier généré, mêmes routes |
| `.lovable/project.json` | Conserve la révision de template du projet courant | Aucun sur l'exécution |
| `dist-mobile/` | Absent du dépôt source (dossier de build ignoré par git) | Aucun — recréé par `bun run build:mobile` |
| Artefacts locaux (`.tanstack/`, `tsconfig.tsbuildinfo`, `node_modules/`) | Générés par l'installation/exécution | Aucun |

Vérification : `diff -rq` entre le dépôt source et le projet ne remonte que ces éléments.

## 3. Éléments impossibles à reproduire exactement

- **Base de données** : le dépôt source ne contient aucune intégration backend (aucune référence Supabase/Lovable Cloud, aucun dossier `supabase/`, aucune migration). L'application est **100 % locale/client** (stockage via `@capacitor/preferences`, filesystem, état côté navigateur). Il n'y a donc **aucun schéma, relation ou contrainte à répliquer** : la structure de données est celle du code TypeScript (`src/types/`, `src/lib/`), copiée intégralement.
- **Binaires d'images** : les assets sont référencés via des fichiers `*.asset.json` (CDN Lovable). Ils sont copiés tels quels et se résolvent correctement au rendu, mais les fichiers PNG bruts ne résident pas dans le dépôt.
- **Dossier natif `android/`** : non versionné dans la source ; il est régénéré par `npx cap add android` (déjà prévu par le script `android:build`).

## 4. Éléments nécessitant une action manuelle

1. **Variables d'environnement** : copier `.env.example` vers `.env` et renseigner les clés (notamment celles de l'assistant IA) — aucune valeur secrète n'existe dans le dépôt source.
2. **Build APK/AAB** : nécessite un environnement Android (JDK + SDK), non disponible ici. Lancer `bun run android:build` en local ou via le workflow `.github/workflows/android-build.yml`.
3. **Tests** : `vitest` est configuré mais le dépôt source ne contient aucun fichier `src/**/*.test.ts` — rien à exécuter.

## 5. Vérification d'exécution

- Serveur de développement : HTTP 200 sur `/`
- Rendu navigateur (390×844) : page d'accueil « Bonjour » complète (stockages, catégories, fichiers récents, outils, barre de navigation) — **0 erreur console**
- Titre du document : `GeniusFiles`

**Conclusion : clone fidèle, stable et exécutable, strictement identique au projet source hors fichiers générés.**
