# Rapport de comparaison — Clone fidèle de `eliascous/geniusfiles48`

Date : 2026-08-01
Source de référence : https://github.com/eliascous/geniusfiles48.git (branche par défaut, clone `--depth 1`)
Méthode : copie intégrale du dépôt (rsync `--delete`), sans réécriture, refactorisation, ni « correction » de code.

## 1. Vérification d'identité

`diff -rq` entre le dépôt source et le projet (hors `.git`, `node_modules`) ne relève **aucune** différence de contenu.
Seuls apparaissent côté projet des artefacts générés localement : `.tanstack/`, `tsconfig.tsbuildinfo` (non versionnés).

## 2. Éléments reproduits (à l'identique)

### Application web
- `src/routes/` — 18 routes + `__root.tsx` + `api/` : `index`, `applications`, `assistant`, `automatisations`, `automatisations.historique`, `categorie.$kind`, `coffre-fort`, `corbeille`, `diagnostic-clavier`, `fichiers-recents`, `nettoyeur`, `organisation`, `outils`, `parametres`, `pdf-outils`, `recherche`, `transfert`.
- `src/components/` — l'intégralité des composants (UI, lecteur, feuilles, dialogues), aucun remplacement.
- `src/lib/` — tous les modules métier : `ai`, `analysis`, `apps`, `automations`, `cleaner`, `copy`, `engine`, `errors`, `files`, `fs`, `index`, `jobs`, `native`, `navigation`, `organizer`, `pdf`, `personalization`, `player`, `recents`, `search`, `transfer`, `vault`, `viewer`, `ai-gateway.server.ts`.
- `src/hooks/`, `src/types/`, `src/assets/`, `src/router.tsx`, `src/server.ts`, `src/start.ts`, `src/routeTree.gen.ts`.
- `src/styles.css` — design system, tokens, thème sombre inchangés. Aucune modification visuelle, d'animation, d'état ou de parcours utilisateur.
- `public/`, `resources/`.

### Configuration
- `package.json` (dépendances et scripts identiques, y compris `build:mobile`, `android:*`, `test`), `bun.lock`, `bunfig.toml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `components.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`, `AGENTS.md`, `README.md`.
- `.lovable/plan.md` conservé. `.lovable/project.json` conserve l'identifiant du projet courant (métadonnée de plateforme, sans effet fonctionnel).

### Chaîne APK / AAB (demande explicite)
- `capacitor.config.ts` (webDir `dist-mobile`, appId `app.geniusfiles.mobile`).
- `ANDROID_BUILD.md`.
- `.github/workflows/android-build.yml`.
- `scripts/build-mobile.mjs`, `scripts/apply-android-overrides.mjs`, `scripts/generate-app-icons.mjs`.
- `android-overrides/` complet : `AndroidManifest.xml`, `app/debug.keystore`, `res/` (`drawable-anydpi-v26`, `values`, `values-v31`, `xml`) et les sources Kotlin `AudioPlaybackService.kt`, `AutomationAlarmReceiver.kt`, `AutomationAlarmScheduler.kt`, `AutomationBootReceiver.kt`, `GeniusFilesNativePlugin.kt`, `GeniusFilesTransferPlugin.kt`, `MainActivity.kt`, `TransferActionReceiver.kt`, `TransferForegroundService.kt`.
- `resources/` (sources d'icônes/splash pour `@capacitor/assets`).

### Rapports d'origine
- `RAPPORT_CLONE.md` et `RAPPORT_COMPARAISON.md` du dépôt source ont été copiés tels quels.

## 3. Base de données

Le dépôt source **ne contient aucun backend de base de données** : pas de dossier `supabase/`, aucune migration SQL, aucun client `src/integrations/supabase/*`. La persistance est entièrement locale/native (système de fichiers, `@capacitor/preferences`, stockage navigateur).
Conséquence : schéma, relations, contraintes et organisation des données sont reproduits par définition — il n'y a rien à recréer côté serveur. Aucune base n'a été ajoutée, conformément à la consigne de ne pas réinventer l'architecture.

## 4. Validation d'exécution

- `bun install` : 741 paquets installés, sans erreur.
- Serveur de dev : démarre, `GET /` → 200.
- Routes testées : `/`, `/outils`, `/parametres`, `/transfert`, `/assistant`, `/coffre-fort` → toutes 200.
- Typecheck TypeScript : aucune erreur.
- Rendu navigateur (390×844) : interface identique au design source, aucune erreur console.
- `vitest run` : « No test files found » — le dépôt source déclare un script `test` mais ne contient aucun fichier `src/**/*.test.ts`. Comportement identique à la source, non « corrigé ».

## 5. Différences détectées

| Élément | Nature | Impact |
|---|---|---|
| `.tanstack/`, `tsconfig.tsbuildinfo` | artefacts de build locaux | aucun |
| `.lovable/project.json` (`revision`) | métadonnée de plateforme propre au projet | aucun |
| Versions résolues de dépendances | `bun install` a résolu certains ranges `^` vers des patchs plus récents (ex. `tailwindcss` 4.2.4, `react` 19.2.5) | aucun ; le `bun.lock` source est présent, `bun install --frozen-lockfile` restaure les versions exactes |

Aucune différence de code applicatif, de design, de route, de composant, de règle métier ou d'état.

## 6. Éléments impossibles à reproduire exactement ici

- **Dossier `android/`** : absent du dépôt source (généré par `npx cap add android`). Il ne peut pas être copié ; il est reconstruit par `bun run android:build`.
- **`dist-mobile/`** : absent du dépôt source également — c'est la sortie de `scripts/build-mobile.mjs`, produite au moment du build mobile.
- **Compilation APK/AAB** : impossible dans cet environnement (pas de SDK Android ni de JDK/Gradle). Le workflow GitHub Actions `android-build.yml` copié couvre ce besoin.
- **Historique Git de la source** : clone superficiel (`--depth 1`), seul l'état final est repris.

## 7. Actions manuelles requises

1. **Build Android** : exécuter `bun run android:build` sur une machine avec JDK 21 + Android SDK, ou déclencher le workflow `.github/workflows/android-build.yml`.
2. **Variables d'environnement** : copier `.env.example` en `.env` si un `VITE_API_BASE_URL` personnalisé est souhaité pour le build natif.
3. **Clé IA** : `LOVABLE_API_KEY` est déjà présente dans ce projet — l'assistant (`/api/public/chat`) fonctionne sans configuration supplémentaire.
4. **Signature de release** : `android-overrides/app/debug.keystore` est une clé de debug ; fournir un keystore de release pour une publication Play Store.

## 8. Conclusion

Clone fidèle, stable et exécutable. Contenu strictement identique au dépôt de référence, hors artefacts de build non versionnés.
