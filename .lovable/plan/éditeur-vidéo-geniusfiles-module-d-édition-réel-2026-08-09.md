# Éditeur vidéo GeniusFiles — module d'édition réel

## Constat technique préalable

J'ai inspecté le projet : il n'existe aujourd'hui **aucun moteur de traitement vidéo**
(pas de FFmpeg, pas de MediaCodec, pas de MediaMuxer). Le plugin natif sait lire des
métadonnées vidéo et générer des vignettes, rien de plus.

Conséquence directe, et c'est le point le plus important de ce plan :
un export vidéo **réel** (trim, rotation, recadrage, filtres, vitesse, volume, texte,
flou) exige d'écrire un vrai pipeline d'encodage natif Android. Sans ça, tout ce que
je pourrais livrer serait exactement ce que vous refusez : une interface qui fait
semblant.

Je propose donc un pipeline natif Kotlin :
`MediaExtractor → MediaCodec (décodeur) → surface OpenGL ES (shaders) → MediaCodec
(encodeur H.264) → MediaMuxer`, plus un chemin audio séparé.
Pas de binaire FFmpeg embarqué : accéléré matériellement, APK léger, pas de licence.

Contrepartie honnête : **l'export ne fonctionnera que dans la build Android**, pas dans
l'aperçu web. L'éditeur détectera l'environnement et désactivera clairement l'export
hors Android au lieu de faire croire à un succès.

## Livraison par étapes

Chaque étape est autonome, testée, et ne casse pas l'existant (lecteur, gestionnaire,
catégories). Je ne livre une fonction dans l'UI que quand son rendu réel existe.

### Étape 1 — Fondations et points d'entrée
- Route `/editeur-video` recevant racine + dossier + nom de fichier.
- Entrée depuis le lecteur vidéo : « Modifier la vidéo » dans le menu Plus d'options,
  ouverture directe sur la vidéo en cours, position de lecture conservée.
- Entrée depuis le gestionnaire et les catégories : action « Modifier » dans le menu
  contextuel des fichiers vidéo (aucun sélecteur intermédiaire, aucun « Ouvrir avec »).
- Écran éditeur : aperçu vidéo réel, lecture / pause / retour début, thème clair et
  sombre, portrait d'abord.
- Détection de format : si la vidéo n'est pas décodable par l'appareil, message clair
  et édition refusée plutôt que promesse non tenue.

### Étape 2 — Timeline réelle
- Extraction native de vignettes aux instants réels de la vidéo, à la demande et en
  cache disque (jamais de vignette fictive, jamais toute la vidéo en mémoire).
- Piste défilable, zoomable, curseur synchronisé sur la position de lecture réelle
  (même approche que celle déjà validée sur l'éditeur audio : horloge du moteur comme
  source de vérité, pas de setInterval).
- Recherche tactile immédiate : toucher → position → image affichée.

### Étape 3 — Moteur d'export natif (le cœur)
- Nouveau module Kotlin de transcodage : décodage, rendu OpenGL, encodage, muxing.
- Progression réelle, annulation, échec propre (original jamais touché).
- Première capacité branchée dessus : **trim** (début / fin), export sans perte quand
  aucune transformation d'image n'est demandée.
- Enregistrement : « Nouveau fichier » par défaut, « Remplacer l'original » avec
  confirmation explicite ; le résultat apparaît immédiatement dans les listes.

### Étape 4 — Montage
- Suppression d'une portion au milieu, division au curseur, segments manipulables,
  concaténation réelle à l'export.

### Étape 5 — Transformations
- Rotation 90 / 180 / 270, recadrage (original, libre, 1:1, 4:3, 16:9, 9:16),
  résolution de sortie (jamais d'upscale présenté comme une amélioration), avec
  affichage de l'impact taille / qualité.

### Étape 6 — Image et son
- Réglages réels via shaders : luminosité, contraste, exposition, saturation,
  température, teinte, netteté. Aperçu = exactement le shader d'export.
- Filtres construits sur ces mêmes shaders (naturel, chaud, froid, N&B, cinéma,
  vintage, dramatique, doux).
- Vitesse 0,25× → 2× (vidéo et audio traités ensemble), volume et muet réels,
  extraction de la piste audio vers un fichier utilisable par GeniusFiles.

### Étape 7 — Calques
- Texte, images / stickers, dessin, flou et mosaïque de zone, chacun avec une durée
  d'apparition visible et modifiable sur la timeline, tous composés dans le shader
  d'export.
- Piste audio importée : position, durée, volume, suppression, déplacement.

### Étape 8 — Finition
- Undo / Redo couvrant **toutes** les actions (modèle de projet immuable, chaque
  opération = une entrée d'historique).
- Passage complet du parcours de vérification demandé, contrôle de non-régression sur
  lecteur, catégories, gestionnaire, recherche, thèmes.

## Détails techniques

- Modèle d'édition non destructif : un objet `VideoProject` (segments + transformations
  + calques) rendu à l'export ; le fichier source n'est jamais modifié avant validation.
- Aperçu et export partagent les mêmes shaders GLSL, ce qui garantit que ce qui est vu
  correspond à ce qui est écrit.
- Traitement hors thread principal, en service premier plan pour survivre à la mise en
  arrière-plan, avec notification de progression (le projet a déjà ce mécanisme pour
  les transferts).
- Vignettes et rendus intermédiaires en cache disque, jamais en mémoire.

## Ce que je propose de faire maintenant

Démarrer par l'**étape 1**, puis enchaîner les étapes en vous montrant le résultat
à chaque palier.
