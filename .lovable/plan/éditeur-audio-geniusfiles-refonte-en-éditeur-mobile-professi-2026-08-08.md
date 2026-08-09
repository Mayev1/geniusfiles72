# Éditeur audio GeniusFiles — refonte en éditeur mobile professionnel

Livraison en 3 étapes. L'étape 1 est le cœur du travail demandé (waveform, timeline, sélection) ; les étapes 2 et 3 suivent immédiatement après validation visuelle.

Base conservée : le modèle non destructif existant (`AudioOp[]` + `RenderCache`), le décodage réel via `AudioContext`, le lecteur `ClipPlayer`. Rien de fonctionnel n'est supprimé.

## Étape 1 — Waveform, timeline, sélection, lecture

### Hauteur et proportions
- Waveform compacte à hauteur fixe (≈ 132 px mono, ≈ 168 px en stéréo deux pistes) au lieu du `flex-1` actuel qui l'étire sur tout l'écran.
- Espace récupéré redistribué : timeline en haut, bandeau d'infos temporelles, outils et effets dessous.
- Stéréo : canal gauche et canal droit tracés dans deux couloirs séparés avec un fin séparateur ; mono sur un seul couloir centré.

### Règle temporelle
- Bande de graduations au-dessus de la waveform, avec pas adaptatif au zoom (heures / minutes / secondes / dixièmes / centièmes).
- Graduations majeures étiquetées, mineures non étiquetées, libellés lisibles à petite taille.

### Couleurs
- Nouveaux tokens sémantiques dédiés dans `src/styles.css`, déclinés clair et sombre : corps de l'onde, onde hors sélection (atténuée), onde dans la sélection, fond de sélection, playhead, graduations, libellés, poignées.
- Palette sobre et contrastée, dérivée de l'identité GeniusFiles, sans saturation agressive. Plus aucune couleur codée en dur dans le canvas.

### Interaction
- Zoom continu et stable : pincement à deux doigts et molette, ancrés sur le point touché, avec facteur exponentiel (pas de saut).
- Boutons zoom +/− et « tout afficher », ancrés au centre visible.
- Glissement horizontal de la timeline (drag sur la règle) sans perte de position ni clignotement.
- Appui simple = déplacement de la playhead ; glissement sur la waveform = sélection.
- Cache de crêtes multi-résolution par niveau de zoom : un déplacement horizontal réutilise les crêtes déjà calculées, seules les colonnes nouvellement visibles sont calculées. Redessin en une frame via `requestAnimationFrame`.

### Suivi de lecture
- Playhead animée en continu pendant la lecture, synchronisée sur l'horloge du contexte audio.
- Défilement automatique de la fenêtre quand la playhead approche du bord (mode « page » doux, sans à-coup).
- Le défilement auto se suspend dès que l'utilisateur touche la waveform, et reprend après un court délai.

### Sélection
- Deux poignées tactiles (zone de saisie ≈ 28 px, visuel plus discret), déplacement du début, de la fin, ou de la sélection entière.
- Bandeau permanent : début, fin, durée sélectionnée, position courante, avec édition numérique précise (entrée/sortie temporelle).
- Actions : lecture en boucle de la sélection, pré-écoute, tout sélectionner, désélectionner.

### Haptique
- Impulsions légères et **anti-répétition** (jamais plus d'une par pas de graduation) sur : accroche d'une poignée à une graduation majeure, atteinte du début/fin du fichier, franchissement d'un palier de zoom, validation d'une sélection.

## Étape 2 — Effets réels et outils pro

Tous les effets sont de nouvelles opérations `AudioOp` traitant réellement les échantillons, donc automatiquement couvertes par Undo/Redo et par l'export.

- Dynamique / niveau : gain, normalisation, compresseur, limiteur, inversion de phase.
- Temps : réverbération (taille, decay, mix), écho, delay (temps, feedback, mix), chorus, flanger.
- Spectre : filtre passe-bas, passe-haut, égaliseur 5 bandes.
- Saturation : distorsion, overdrive.
- Stéréo : balance gauche/droite, mono ↔ stéréo.
- Silences : détection, suppression, silence auto, fondu auto.
- Outil censure « bip » : plusieurs timbres, fréquence, volume, durée, aperçu, appliqué uniquement sur la sélection.
- Édition : couper, copier, coller, dupliquer, rogner, découper, déplacer une portion, fusionner.
- Analyse : niveau crête / RMS, détection de pics, marqueurs et repères.
- Aperçu temps réel avec distinction nette Aperçu / Appliquer / Annuler : le paramètre s'écoute avant d'être validé, aucune écriture définitive à chaque mouvement de curseur.

## Étape 3 — Import, sons intégrés, export

- Import audio depuis l'appareil (MP3, WAV, M4A/AAC, OGG, FLAC, Opus) via l'explorateur GeniusFiles existant ; utilisable comme insertion, son de censure, musique ou effet.
- Bibliothèque de sons générée à la demande par le moteur audio (bips, transitions, impacts, notifications, ambiances, bruitages) : aucun fichier embarqué, fonctionne hors-ligne.
- Export : WAV (sans perte) et MP3 avec choix du bitrate (128 / 192 / 320), encodeur chargé à la demande.
- Écran d'export récapitulatif : durée, format, qualité, taille estimée, choix nouveau fichier ou remplacement. L'export part toujours du rendu édité.

## Détails techniques

- `src/lib/audio/peaks.ts` : passage à un cache par niveau de zoom (pyramide de crêtes), calcul incrémental par colonnes, indexé par `renderToken`.
- `src/components/audio/Waveform.tsx` : réécriture du rendu (règle + couloirs par canal + calque de sélection + playhead), boucle de dessin unique en `requestAnimationFrame`, lecture des couleurs depuis les tokens CSS.
- Nouveaux modules : `src/lib/audio/effects.ts` (DSP des effets), `src/lib/audio/tone.ts` (générateurs de bips et de sons), `src/lib/audio/mp3.ts` (encodeur MP3), `src/lib/audio/haptics.ts` (haptique à seuils).
- `src/lib/audio/types.ts` et `render.ts` étendus avec les nouveaux types d'opérations ; `OP_LABEL` complété pour l'historique Undo/Redo.
- `src/components/audio/AudioEditor.tsx` réorganisé : barre supérieure (nom, Undo/Redo, Export), waveform + règle, infos temporelles, transport, puis outils/effets en panneaux catégorisés.
- Vérification sur un vrai fichier audio via Playwright : concordance waveform/audio, synchronisation de lecture, défilement auto, zoom, sélection, effets audibles, Undo/Redo, export, fluidité sur fichier long.
