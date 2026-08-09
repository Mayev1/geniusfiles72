# Rapport de comparaison — Clone de `eliascous/geniusfiles42`

Date : 31/07/2026
Source de référence : https://github.com/eliascous/geniusfiles42.git (clone `--depth 1`, branche par défaut)

## 1. Éléments reproduits à l'identique

Copie fichier par fichier (rsync, sans transformation) de la totalité du dépôt source :

- **Code applicatif** : `src/` complet — `routes/` (index, applications, assistant, automatisations + historique, categorie.$kind, coffre-fort, corbeille, diagnostic-clavier, fichiers-recents, nettoyeur, organisation, outils, parametres, pdf-outils, recherche, transfert, `api/`, `__root.tsx`), `components/` (analysis, assistant, brand, common, files, home, jobs, organizer, pdf, player, settings, transfer, ui, vault, viewer, AppShell, PermissionGate), `lib/` (ai, analysis, apps, automations, cleaner, copy, engine, errors, files, fs, index, jobs, native, navigation, organizer, pdf, personalization, player, recents, search, transfer, vault, viewer…), `hooks/`, `types/`, `assets/`, `styles.css`, `router.tsx`, `server.ts`, `start.ts`.
- **Design & états** : aucune modification du CSS, des tokens, des variantes de composants, des animations ni des thèmes (script anti-flash `gf.prefs.v1` / cookie `gf_theme` inclus).
- **Navigation & routes** : mêmes fichiers de routes, mêmes URL, mêmes métadonnées `head()`.
- **Configuration** : `package.json` (dépendances et scripts identiques, y compris `build:mobile`, `android:*`), `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `components.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `bunfig.toml`, `bun.lock`, `.env.example`.
- **Mobile / APK-AAB** : `capacitor.config.ts`, `ANDROID_BUILD.md`, `android-overrides/app/**`, `.github/workflows/android-build.yml`, `scripts/build-mobile.mjs`, `scripts/apply-android-overrides.mjs`, `scripts/generate-app-icons.mjs`, `resources/source-logo.png`, `public/brand/geniusfiles-logo.png`, `public/favicon.ico`.
- **Documentation** : `README.md`, `AGENTS.md`, `RAPPORT_COMPARAISON.md`, `.lovable/plan.md`.

Aucun refactor, aucune simplification, aucune « correction » automatique n'a été appliquée.

## 2. Vérifications effectuées

- `bun install` : 741 paquets installés sans erreur.
- Serveur de dev : démarre, `/` répond 200.
- Routes testées : `/`, `/outils`, `/parametres`, `/coffre-fort` → 200, rendu SSR conforme (logo, AppShell, listes d'outils).
- `vitest run` : aucun fichier de test dans le dépôt source (`src/**/*.test.ts` vide) — identique à la source.

## 3. Différences détectées

| Élément | Détail |
|---|---|
| `.lovable/project.json` | Non copié : contient l'identifiant du projet Lovable courant. Le remplacer casserait le lien du projet. Sans impact fonctionnel. |
| `.git/` | Non copié (historique du dépôt source). |
| `dist-mobile/` | **Absent du dépôt source** (ignoré par `.gitignore`) : c'est un artefact de build produit par `bun run build:mobile`. Rien à copier ; il sera régénéré identiquement par le script. |
| `android/` | Idem : dossier généré par `npx cap add android`, non versionné en amont. |
| `src/routeTree.gen.ts` | Copié tel quel, puis régénéré automatiquement par le plugin TanStack Router (contenu équivalent). |
| Versions de paquets | `bun.lock` copié, mais quelques versions en `^` peuvent se résoudre à un patch plus récent (ex. react 19.2.5) selon le registre. Aucune rupture observée. |

## 4. Éléments impossibles à reproduire exactement

- **Base de données** : le dépôt source ne contient **aucun backend Supabase / Lovable Cloud** (pas de dossier `supabase/`, pas de migrations, pas de `src/integrations/`). L'application est 100 % locale : persistance via `localStorage`, `Capacitor Preferences` et le système de fichiers de l'appareil. Il n'y a donc ni schéma, ni relations, ni contraintes à reproduire — la « structure de données » est celle du code (`src/lib/**`), copiée à l'identique.
- **Authentification / commandes / licences / analytics serveur** : aucun de ces modules n'existe dans le dépôt source ; il s'agit d'un gestionnaire de fichiers Android. Rien n'a été inventé.
- **Historique Git et identifiants de projet** : propres au dépôt/projet d'origine.
- **Asset externalisé** `src/assets/geniusfiles-logo.asset.json` : pointe vers le CDN du projet source (`project_id: 7852a4f0-…`). Le logo réellement utilisé à l'exécution est `public/brand/geniusfiles-logo.png`, copié en binaire — le rendu est donc identique.

## 5. Actions manuelles nécessaires

1. **Variables d'environnement** : copier `.env.example` en `.env` et définir `VITE_API_BASE_URL` si l'APK doit pointer vers un domaine autre que `https://geniusfiles42.lovable.app` (par défaut : passerelle IA du projet source).
2. **Clé IA** : les fonctions serveur `src/lib/ai-gateway.server.ts` utilisent `LOVABLE_API_KEY` côté serveur ; elle doit exister dans l'environnement de ce projet pour l'assistant.
3. **Build Android** (hors sandbox, requiert JDK + SDK Android) :
   ```
   bun run build:mobile
   npx cap add android
   npx cap sync android
   bun run android:icons && bun run android:overrides
   cd android && ./gradlew assembleDebug bundleDebug
   ```
   ou déclencher le workflow `.github/workflows/android-build.yml`.
4. **Signature release** : keystore/secrets non versionnés à fournir pour un AAB signé.
