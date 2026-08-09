# Éditeur audio — refonte fluidité, précision et effets réels

Objectif : transformer l'éditeur en véritable timeline audio mobile — waveform compacte et lisible, curseur parfaitement fluide, sélection facile au doigt, effets réellement appliqués au bon endroit, bip de censure, deuxième piste, undo/redo complet.

## Ce qui est déjà correct (à conserver)

- Waveform 100 % canvas avec pyramide de crêtes multi-résolution : pan/zoom ne relit jamais tout le signal. Les crêtes sont calculées à partir de l'audio réel décodé — aucune waveform fictive.
- Modèle non destructif `AudioOp[]` + cache de rendu incrémental : Undo/Redo déjà exact et bon marché.
- Effets réels (écho, réverb, EQ, filtre, compresseur, gate, saturation, stéréo, vitesse, hauteur) implémentés en DSP, pas en simulation visuelle.
- Export WAV/MP3 réel.

## Bug confirmé (cause identifiée)

Dans `insertSound`, le mode « remplacer la sélection » enchaîne deux `pushOp` dans le même tick. `pushOp` tronque l'historique avec `cursorRef.current`, qui n'est mis à jour qu'au rendu suivant : le second appel écrase le premier. Résultat : la suppression de la sélection est perdue et **le son est ajouté à la position au lieu de remplacer la sélection** — exactement le symptôme « le bip s'ajoute après le mot ». Même défaut potentiel pour toute action composée.

## Travaux

### 1. Historique fiable
- `pushOp` accepte une ou plusieurs opérations en un seul commit atomique (une entrée d'historique = une action utilisateur), via un updater fonctionnel qui n'utilise plus une ref périmée.
- Toutes les actions composées (remplacement, couper+coller, bip sur sélection) passent par ce commit unique.
- Étendre l'historique aux changements de sélection significatifs et aux paramètres d'effets, avec libellé d'action lisible ; les micro-déplacements de curseur restent hors historique (sinon Undo devient inutilisable).

### 2. Waveform : lisibilité et densité
- Réduire fortement l'écart vertical L/R : couloirs accolés avec un séparateur discret (ligne fine + étiquettes « L » / « R »), comme sur les captures de référence.
- Hauteur de la zone waveform augmentée (part dominante de l'écran), commandes compactées en dessous.
- Palette retravaillée en tokens sémantiques, contrastée en thème clair et sombre, sans couleur agressive ; rendu des crêtes en tracé rempli continu (plus lisse que les colonnes de 1 px) avec enveloppe RMS légère derrière les crêtes pour la profondeur.

### 3. Curseur et défilement continus
- Suppression du défilement par sauts : pendant la lecture, la fenêtre glisse en continu (mode « rails ») en s'ancrant sur la tête de lecture, sans repositionnement brutal ni clignotement.
- Position lue directement depuis l'horloge du contexte audio à chaque frame (déjà le cas), avec interpolation pour un rendu strictement monotone.
- Reprise douce du suivi après un geste manuel (transition amortie, jamais un saut).

### 4. Gestes
- Appui simple : positionner le curseur. Double appui : placer + lire depuis ce point. Appui long : mode sélection. Glissement : déplacement précis du curseur. Deux doigts : pincer pour zoomer, glisser pour naviguer. Double appui sur un marqueur : y revenir.
- Aucun magnétisme contraignant : le curseur ne s'accroche jamais ; les repères (début/fin d'audio, bornes de sélection, points de découpe, marqueurs) déclenchent seulement une **vibration légère**, avec anti-répétition.

### 5. Cadre de sélection
- Poignées redessinées : zone de saisie large (≥ 44 px), visibles même sur une sélection très courte, poignées repoussées vers l'extérieur quand la sélection est trop étroite.
- Bandeau de sélection : début, fin, durée, position actuelle, avec ajustement fin (±10 ms) et boutons « sélection → vue » / « tout ».
- Déplacement continu, jamais bloqué, synchronisé au pixel avec la waveform.

### 6. Effets réellement appliqués sur la sélection
- Vérifier et corriger le routage `range` pour chaque effet : le traitement s'applique exactement de `start` à `end`, jamais après.
- Trois modes explicites quand une sélection existe : appliquer **sur** la sélection, **remplacer** la sélection, **insérer** au curseur.
- Pré-écoute = vrai rendu du traitement (déjà le cas) ; la validation commet l'opération dans l'état d'édition, annulable.

### 7. Bip de censure
- Entrée dédiée « Bip de censure » agissant directement sur la sélection : durée calée automatiquement sur la sélection, remplacement (ou recouvrement) exact de la zone.
- Réglages : tonalité, volume, type (simple/double/continu), fondu entrée/sortie. Un seul pas d'Undo.

### 8. Import audio
- Fiabiliser la lecture du fichier : essai chemin absolu, puis URI de contenu, puis flux du lecteur, avant de déclarer une erreur ; message d'erreur seulement en cas d'échec réel, avec cause distincte (permission / format / corrompu).
- Étendre la reconnaissance des extensions audio dans le sélecteur de fichiers.

### 9. Deuxième piste (multipiste simple)
- Modèle étendu : un projet = liste de pistes, chacune avec son propre `AudioOp[]`, un décalage temporel, un volume, mute et solo. La piste active reçoit les éditions.
- Deux waveforms empilées et compactes partageant la même timeline, le même zoom et le même curseur.
- Lecture simultanée mixée en temps réel ; bandeau par piste : volume, mute, solo, activer, déplacer, remplacer, supprimer.
- Déplacement d'une piste sans affecter l'autre ; export mixant les pistes selon leurs décalages et volumes.

### 10. Interface
- Réorganisation : barre supérieure (fermer, titre, undo/redo, enregistrer), waveform agrandie, transport, puis actions principales en rangée défilante et actions secondaires en feuilles thématiques (édition, effets, pistes, export).

### 11. Performance
- Aucun recalcul complet à chaque frame : crêtes en pyramide, tracé limité aux colonnes visibles, mémoïsation par piste, pré-écoutes en rendu partiel sur la seule plage concernée.

## Détails techniques

- Fichiers principaux : `src/components/audio/Waveform.tsx`, `src/components/audio/AudioEditor.tsx`, `src/lib/audio/{types,render,player,dsp,effects,library,peaks,decode}.ts`.
- Nouveaux modules : `src/lib/audio/tracks.ts` (modèle multipiste + mixage), `src/lib/audio/markers.ts` (repères + haptique), `src/lib/audio/censor.ts` (bip).
- `ClipPlayer` évolue en lecteur multi-source (un `AudioBufferSourceNode` + `GainNode` par piste, démarrage sur une même base d'horloge) pour garantir la synchronisation.
- Tokens de couleur waveform ajoutés dans `src/styles.css` pour les deux thèmes.
- Aucune dépendance ajoutée ; aucun backend requis (tout reste local, compatible WebView Android).

## Vérification finale

Parcours testés : import MP3 → waveform conforme → lecture sans saut → curseur manuel → zoom/dézoom → sélection précise → bip de censure remplaçant exactement la sélection → Undo/Redo → deuxième piste → lecture simultanée → décalage et volume de piste → effet sur une seule piste → export MP3 → réimport et contrôle du résultat.
