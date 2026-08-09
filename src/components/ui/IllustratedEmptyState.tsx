import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  EMPTY_ILLUSTRATION_SRC,
  EMPTY_ILLUSTRATION_FRAME,
  emptyIllustrationCopy,
  type EmptyIllustrationId,
} from "@/lib/copy/empty-illustrations";

/**
 * État vide illustré « premium ».
 *
 * L'illustration officielle (PNG à fond transparent) est posée telle
 * quelle : aucune carte, aucun cadre, aucun fond, aucun filtre. Le fond
 * de l'application traverse l'image, donc le rendu est identique en
 * thème clair et en thème sombre, y compris lors d'un changement à chaud.
 *
 * Le bloc illustration + texte est centré horizontalement et placé
 * légèrement au-dessus du centre optique de la zone de contenu.
 */
export function IllustratedEmptyState({
  id,
  title,
  description,
  action,
  tone = "default",
  className = "",
}: {
  id: EmptyIllustrationId;
  /** Surcharge facultative (chaînes déjà localisées). */
  title?: string;
  description?: string;
  action?: ReactNode;
  /** « inverted » : posé sur un fond sombre de lecteur (contraste inversé). */
  tone?: "default" | "inverted";
  className?: string;
}) {
  const copy = useMemo(() => emptyIllustrationCopy(id), [id]);
  const baseSrc = EMPTY_ILLUSTRATION_SRC[id];
  const fallbackSrc = EMPTY_ILLUSTRATION_SRC.files;
  const frame = EMPTY_ILLUSTRATION_FRAME[id];

  // Certains états n'ont volontairement plus d'illustration (allègement de
  // l'APK) : la mise en page se rééquilibre alors d'elle-même, le bloc
  // texte + actions restant parfaitement centré.
  const hasIllustration = Boolean(baseSrc && frame);

  // Filet de sécurité d'affichage : si le décodage échoue (cache Android
  // corrompu, ressource momentanément illisible), on retente une fois avec
  // un paramètre de cache-bust, puis on bascule sur l'illustration
  // générique. L'utilisateur ne voit jamais un cadre vide.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [id]);

  const src = !hasIllustration
    ? null
    : attempt === 0
      ? baseSrc
      : attempt === 1
        ? `${baseSrc}?r=1`
        : attempt === 2
          ? fallbackSrc
          : null;

  return (
    <div
      className={`flex min-h-[42vh] w-full flex-col items-center justify-center px-6 pb-[8vh] pt-6 text-center sm:min-h-[58vh] sm:pb-[12vh] ${className}`}
    >
      {/* Illustration : fondu + très légère montée.
          Les PNG officiels comportent une large zone transparente autour
          du robot ; on la recadre par une fenêtre carrée (aucun filtre,
          aucune déformation, ratio d'origine préservé) pour que le robot
          attire immédiatement le regard. La taille est bornée à la fois par
          la largeur et la hauteur utiles pour ne jamais rogner le robot. */}
      {hasIllustration ? (
        <div className="gf-empty-illustration relative shrink-0 aspect-square w-[min(58vw,32vh,208px)] overflow-hidden">
          {src ? (
            <img
              key={src}
              src={src}
              alt={copy.alt}
              width={1024}
              height={1536}
              decoding="async"
              draggable={false}
              onError={() => setAttempt((a) => (a < 3 ? a + 1 : a))}
              style={{
                left: `${frame!.left}%`,
                top: `${frame!.top}%`,
                width: `${frame!.width}%`,
              }}
              className="pointer-events-none absolute h-auto max-w-none select-none"
            />
          ) : null}
        </div>
      ) : null}

      {/* Texte : apparaît juste après l'illustration. */}
      <div
        className={`gf-empty-copy flex shrink-0 max-w-[320px] flex-col items-center gap-1.5 ${
          hasIllustration ? "mt-4" : ""
        }`}
      >
        <p
          className={`text-[17px] font-semibold leading-snug ${
            tone === "inverted" ? "text-reader-backdrop-foreground" : "text-foreground"
          }`}
        >
          {title ?? copy.title}
        </p>
        <p
          className={`text-[13.5px] leading-relaxed ${
            tone === "inverted" ? "text-reader-backdrop-foreground/70" : "text-muted-foreground"
          }`}
        >
          {description ?? copy.description}
        </p>
        {action ? <div className="pt-3">{action}</div> : null}
      </div>
    </div>
  );
}
