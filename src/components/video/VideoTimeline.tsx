/**
 * Timeline vidéo — piste d'images réelles, défilement continu sous un
 * curseur fixe (convention des monteurs mobiles).
 *
 * - Les cases sont des images réellement extraites de la vidéo, chargées
 *   uniquement pour la portion visible et relâchées ensuite : la mémoire
 *   ne dépend pas de la durée du film.
 * - Le défilement est natif (donc parfaitement fluide et inertiel) ; la
 *   position temporelle en découle directement, sans arrondi ni aimantation.
 * - Pendant la lecture, la piste se recale sur la position réelle du média
 *   image par image, sans jamais contrarier un geste en cours.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { FrameSource } from "@/lib/video/frames";
import { fmtTime } from "@/components/player/format";

const THUMB_H = 44;
const THUMB_W = 60;
const MIN_PPS = 4;
const MAX_PPS = 240;

export function VideoTimeline({
  src,
  duration,
  position,
  playing,
  onScrub,
  onScrubEnd,
  segments = [],
  removed = [],
  activeSegmentId,
  onSelectSegment,
  layers = [],
  activeLayerId,
  onSelectLayer,
}: {
  src: string;
  duration: number;
  position: number;
  playing: boolean;
  /** Portions conservées du montage, en secondes. */
  segments?: Array<{ id: string; start: number; end: number }>;
  /** Portions retirées, affichées grisées plutôt que masquées. */
  removed?: Array<{ start: number; end: number }>;
  activeSegmentId?: string | null;
  onSelectSegment?: (id: string) => void;
  /** Calques : durée d'apparition visible sous la piste (secondes). */
  layers?: Array<{ id: string; start: number; end: number; label: string }>;
  activeLayerId?: string | null;
  onSelectLayer?: (id: string) => void;
  /** Appelé en continu pendant le geste : la position doit suivre le doigt. */
  onScrub: (t: number) => void;
  onScrubEnd?: (t: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pps, setPps] = useState(30);
  const [viewW, setViewW] = useState(0);
  const [, forceRender] = useState(0);
  const userScrolling = useRef(false);
  const programmatic = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const frames = useMemo(() => (src ? new FrameSource(src, THUMB_H * 2) : null), [src]);
  useEffect(() => () => frames?.dispose(), [frames]);

  /* Largeur réelle de la piste — recalculée à chaque rotation d'écran. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const contentW = Math.max(1, duration * pps);
  const pad = viewW / 2;

  /* Recalage pendant la lecture : jamais pendant un geste utilisateur. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolling.current) return;
    const target = position * pps;
    if (Math.abs(el.scrollLeft - target) < 0.5) return;
    programmatic.current = true;
    el.scrollLeft = target;
  }, [position, pps, viewW]);

  const onScrollHandler = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    userScrolling.current = true;
    const t = Math.max(0, Math.min(duration, el.scrollLeft / pps));
    onScrub(t);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      userScrolling.current = false;
      onScrubEnd?.(t);
    }, 140);
  }, [duration, pps, onScrub, onScrubEnd]);

  /* Cases visibles uniquement. */
  const slots = useMemo(() => {
    if (!duration || !viewW) return [] as Array<{ index: number; t: number }>;
    const start = Math.max(0, Math.floor((position * pps - viewW) / THUMB_W));
    const end = Math.min(
      Math.ceil(contentW / THUMB_W),
      Math.ceil((position * pps + viewW) / THUMB_W) + 1,
    );
    const out: Array<{ index: number; t: number }> = [];
    for (let i = start; i < end; i++) out.push({ index: i, t: (i * THUMB_W) / pps });
    return out;
  }, [duration, viewW, position, pps, contentW]);

  /* Chargement paresseux des images manquantes de la fenêtre visible. */
  useEffect(() => {
    if (!frames) return;
    let alive = true;
    (async () => {
      for (const s of slots) {
        if (!alive) return;
        if (frames.peek(s.t)) continue;
        const url = await frames.frame(s.t);
        if (!alive) return;
        if (url) forceRender((n) => n + 1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slots, frames]);

  const zoom = (dir: 1 | -1) =>
    setPps((p) => Math.max(MIN_PPS, Math.min(MAX_PPS, dir > 0 ? p * 1.6 : p / 1.6)));

  return (
    <div className="relative select-none">
      <div className="mb-1 flex items-center justify-between px-3">
        <span className="text-[11px] font-medium tabular-nums text-foreground">
          {fmtTime(position)}
        </span>
        <div className="flex items-center gap-1">
          <ZoomBtn label="Dézoomer" onPress={() => zoom(-1)}>
            <Minus className="h-3.5 w-3.5" />
          </ZoomBtn>
          <ZoomBtn label="Zoomer" onPress={() => zoom(1)}>
            <Plus className="h-3.5 w-3.5" />
          </ZoomBtn>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScrollHandler}
          className="gf-no-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain"
          style={{ scrollbarWidth: "none" }}
        >
          <div
            className="relative flex items-center"
            style={{
              width: contentW + viewW,
              height: THUMB_H + (layers.length ? 18 : 0),
              paddingLeft: pad,
              paddingRight: pad,
            }}
          >
            <div
              className="relative"
              style={{ width: contentW, height: THUMB_H + (layers.length ? 18 : 0) }}
            >
              {/* Portions retirées : assombries, jamais masquées, pour que
                  l'utilisateur voie exactement ce qu'il enlève. */}
              {removed.map((r, i) => (
                <div
                  key={`gap-${i}`}
                  aria-hidden
                  className="absolute inset-y-0 z-10 bg-background/75"
                  style={{ left: r.start * pps, width: Math.max(0, (r.end - r.start) * pps) }}
                />
              ))}
              {/* Segments conservés : chacun sélectionnable pour être
                  supprimé du montage. */}
              {segments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  aria-label={`Segment ${seg.id}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectSegment?.(seg.id);
                  }}
                  className={`absolute inset-y-0 z-20 rounded-[3px] border-y-2 ${
                    activeSegmentId === seg.id
                      ? "border-primary bg-primary/10"
                      : "border-primary/50"
                  }`}
                  style={{ left: seg.start * pps, width: Math.max(0, (seg.end - seg.start) * pps) }}
                />
              ))}
              {slots.map((s) => {
                const url = frames?.peek(s.t) ?? null;
                return (
                  <div
                    key={s.index}
                    className="absolute top-0 overflow-hidden bg-surface-2"
                    style={{ left: s.index * THUMB_W, width: THUMB_W, height: THUMB_H }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                );
              })}
              {/* Calques : chaque barre montre la durée d'apparition réelle. */}
              {layers.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  aria-label={`Calque ${l.label}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectLayer?.(l.id);
                  }}
                  className={`absolute z-30 truncate rounded-[3px] px-1 text-[9px] font-medium leading-[14px] ${
                    activeLayerId === l.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                  style={{
                    top: THUMB_H + 2,
                    height: 14,
                    left: l.start * pps,
                    width: Math.max(10, (l.end - l.start) * pps),
                    opacity: i % 2 === 0 ? 1 : 0.85,
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Curseur de lecture — fixe, la piste défile dessous. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary"
        >
          <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-primary" />
        </div>
      </div>

      <p className="mt-1 px-3 text-[10.5px] text-muted-foreground">
        {playing ? "Lecture en cours" : "Faites glisser la piste pour vous déplacer"}
      </p>
    </div>
  );
}

function ZoomBtn({
  children,
  label,
  onPress,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className="flex h-7 w-7 touch-manipulation items-center justify-center rounded-full bg-secondary/60 text-foreground active:scale-95"
    >
      {children}
    </button>
  );
}
