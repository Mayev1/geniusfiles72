# Rapport de comparaison — Clone de `eliascous/geniusfiles36`

Date : 29 juillet 2026
Source de référence : https://github.com/eliascous/geniusfiles36.git (branche par défaut, clone `--depth 1`)

## 1. Méthode

Copie fichier par fichier de l'intégralité du dépôt source vers ce projet (`cp -a`), sans
réécriture, sans refactorisation, sans reformatage. Aucun fichier n'a été régénéré à la main.
Vérification finale par `diff -rq` récursif entre le dépôt source et ce projet.

**Résultat du diff : aucune différence** (hors répertoires d'exécution locaux `node_modules/`,
`.git/`, `.tanstack/`, `.workspace/`, `tsconfig.tsbuildinfo`, et ce rapport).

## 2. Éléments reproduits

### Application (324 fichiers)

- `src/routes/` — 18 routes + `__root.tsx` + `api/public/` : accueil, applications, assistant,
  automatisations (+ historique), categorie.$kind, coffre-fort, corbeille, diagnostic-clavier,
  galerie, nettoyeur, organisation, outils, parametres, pdf-outils, recherche, transfert.
- `src/components/` — 16 dossiers : analysis, brand, common, files, gallery, jobs, organizer,
  pdf, player, settings, transfer, ui, vault, viewer…
- `src/lib/` — 22 modules métier : ai (+ tools), analysis, apps, automations, cleaner, engine
  (+ handlers), files, fs, gallery, index, jobs, native, navigation, organizer, pdf,
  personalization, player, search…
- `src/hooks/`, `src/types/`, `src/assets/`, `src/router.tsx`, `src/server.ts`, `src/start.ts`,
  `src/routeTree.gen.ts`.
- **Design system** : `src/styles.css` copié à l'identique (tokens, thèmes, densités, tailles de
  texte, animations). Aucune valeur modifiée.
- **États/comportements** : attributs `data-theme`, `data-theme-mode`, `data-text-size`,
  `data-density`, `data-animations`, `data-reduce-motion` appliqués comme dans la source.

### Build mobile Android (APK / AAB) — copié intégralement

- `capacitor.config.ts`
- `ANDROID_BUILD.md`
- `.github/workflows/android-build.yml`
- `scripts/build-mobile.mjs`, `scripts/apply-android-overrides.mjs`, `scripts/generate-app-icons.mjs`
- `android-overrides/` complet : `app/debug.keystore`, `AndroidManifest.xml`,
  `res/` (drawable-anydpi-v26, values, values-v31, xml) et sources Kotlin
  `app/geniusfiles/mobile/` : `AudioPlaybackService.kt`, `AutomationAlarmReceiver.kt`,
  `AutomationAlarmScheduler.kt`, `AutomationBootReceiver.kt`, `GeniusFilesNativePlugin.kt`, etc.
- `resources/source-logo.png` (source des icônes générées), `public/brand/geniusfiles-logo.png`.
- Scripts npm identiques : `build:mobile`, `android:init`, `android:sync`, `android:apk`,
  `android:aab`, `android:overrides`, `android:icons`, `android:build`.

### Configuration

`package.json` (dépendances **et** versions à l'identique), `bun.lock`, `vite.config.ts`,
`vitest.config.ts`, `tsconfig.json`, `components.json`, `eslint.config.js`, `.prettierrc`,
`.prettierignore`, `.gitignore`, `.env.example`, `bunfig.toml`, `AGENTS.md`, `README.md`.

### Vérifications d'exécution

- `bun install` : 560 paquets installés, sans erreur.
- Typecheck TypeScript : **0 erreur**.
- Serveur de dev : démarre, répond sur `/`.
- Navigation testée : `/`, `/galerie`, `/parametres`, `/outils` — rendu et titres de page
  conformes (« GeniusFiles — Gestionnaire de fichiers », « Galerie — GeniusFiles », etc.).

## 3. Différences détectées

| Élément                      | Détail                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `public/robots.txt`          | Présent dans le template Lovable de départ, **absent** du dépôt source. Supprimé pour parité stricte. |
| Anciens fichiers du template | `src/routes/index.tsx` placeholder et `src/styles.css` par défaut : remplacés par ceux de la source.  |

Aucune autre différence. Le design, la structure, les pages, les composants, les règles métier,
la navigation, les animations et les états sont ceux du dépôt source, octet pour octet.

## 4. Base de données

**Le projet source ne contient aucune base de données.** Vérifications effectuées :

- pas de dossier `supabase/`, pas de migrations SQL, pas de `src/integrations/supabase/` ;
- `.env.example` indique explicitement : « Aucune variable n'est actuellement requise :
  GeniusFiles fonctionne entièrement en local, sans dépendance externe » ;
- la persistance passe par le stockage local / `@capacitor/preferences` / `@capacitor/filesystem`
  et les modules `src/lib/fs`, `src/lib/index`, `src/lib/jobs`.

Il n'y a donc **ni schéma, ni relations, ni contraintes** à reproduire. La structure de données
(types et modèles) est reproduite via `src/types/` et `src/lib/`, à l'identique.
La compatibilité et la cohérence des données locales sont préservées : mêmes clés de stockage,
mêmes formats de sérialisation, mêmes versions de schéma applicatif.

## 5. Éléments impossibles à reproduire exactement

| Élément                             | Raison                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `dist-mobile/`                      | Dossier de **build généré**, absent du dépôt source (gitignoré). Il est recréé par `bun run build:mobile`. Rien à copier. |
| `android/` (projet natif Capacitor) | Généré par `npx cap add android`, non versionné dans la source. Recréé par `bun run android:build`.                       |
| APK / AAB signés en release         | `android-overrides/app/debug.keystore` est copié, mais une signature **release** exige un keystore privé absent du dépôt. |
| Historique Git / branches           | Clone `--depth 1` : seul l'état courant du code est reproduit, pas l'historique des commits.                              |
| Données utilisateur locales         | Le contenu du stockage de l'appareil (fichiers indexés, coffre-fort, historique) est propre à chaque installation.        |

## 6. Éléments nécessitant une action manuelle

1. **Générer l'APK / AAB** — le build Android natif ne peut pas s'exécuter dans cet environnement
   (Android SDK + JDK + Gradle requis). En local ou via le workflow GitHub Actions fourni :
   ```bash
   bun run android:build   # build web + cap add/sync + icônes + overrides + assembleDebug/bundleDebug
   ```
2. **Signature release** — fournir votre propre keystore et configurer
   `android/app/build.gradle` (le dépôt source ne contient qu'un keystore de debug).
3. **Workflow GitHub Actions** — `.github/workflows/android-build.yml` est copié ; il ne
   s'exécutera qu'après connexion de ce projet à un dépôt GitHub.
4. **Variables d'environnement** — aucune n'est requise ; copier `.env.example` en `.env` si vous
   en ajoutez plus tard.
5. **Avertissements console d'hydratation** — présents à l'identique dans la source (le thème est
   appliqué côté client sur `<html>`). **Non corrigés volontairement**, conformément à la
   consigne de ne rien modifier.

## 7. Conclusion

Clone **fidèle, stable et exécutable**. Parité fichier par fichier confirmée par `diff -rq`,
typecheck sans erreur, application fonctionnelle en prévisualisation. Aucune simplification,
modernisation, refactorisation ni correction automatique n'a été appliquée.
