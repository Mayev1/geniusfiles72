/**
 * Bandeau de suggestions Genius AI.
 *
 * Défilement automatique continu vers la gauche (rAF, sans saccade) avec
 * boucle infinie via duplication de la liste. L'utilisateur peut faire
 * défiler manuellement : l'animation se met en pause puis reprend.
 */
import { useEffect, useRef } from "react";
import { TEMPLATES } from "./templates";

const SPEED = 22; // px / seconde

export function TemplateMarquee({ onPick }: { onPick: (text: string) => void }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let last = performance.now();
    let pausedUntil = 0;

    const step = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const half = el.scrollWidth / 2;
      if (half > 0 && now >= pausedUntil) {
        el.scrollLeft += (SPEED * dt) / 1000;
      }
      if (half > 0 && el.scrollLeft >= half) el.scrollLeft -= half;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const pause = () => {
      pausedUntil = performance.now() + 2200;
    };
    el.addEventListener("pointerdown", pause);
    el.addEventListener("touchstart", pause, { passive: true });
    el.addEventListener("wheel", pause, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", pause);
      el.removeEventListener("touchstart", pause);
      el.removeEventListener("wheel", pause);
    };
  }, []);

  const items = [...TEMPLATES, ...TEMPLATES];

  return (
    <div
      ref={scrollerRef}
      className="gf-no-scrollbar -mx-1 flex gap-2 overflow-x-auto scroll-smooth px-1 py-1"
      style={{ scrollbarWidth: "none" }}
      aria-label="Suggestions"
    >
      {items.map((t, i) => (
        <button
          key={`${i}-${t}`}
          type="button"
          onClick={() => onPick(t)}
          className="shrink-0 whitespace-nowrap rounded-full border border-border/70 bg-surface px-3.5 py-2 text-[12.5px] leading-none text-muted-foreground transition-colors duration-150 active:scale-[0.98] hover:border-primary/40 hover:text-foreground"
        >
          {t}
        </button>
      ))}
    </div>
  );
}
