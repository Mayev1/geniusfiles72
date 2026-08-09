/**
 * Composition des calques dans l'aperçu — étape 7.
 *
 * Cette couche affiche exactement ce que le moteur natif écrira dans le
 * fichier : mêmes coordonnées normalisées, même fenêtre d'apparition, même
 * ordre d'empilement. Elle porte aussi les gestes (déplacement,
 * redimensionnement, dessin), et se cale précisément sur l'image visible,
 * recadrage et rotation compris.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoEdit } from "@/lib/video/edit";
import type { Stroke, VideoLayer } from "@/lib/video/layers";
import { isVisibleAt } from "@/lib/video/layers";

type Box = { left: number; top: number; width: number; height: number };

export function LayerOverlay({
  video,
  edit,
  layers,
  positionMs,
  selectedId,
  onSelect,
  onChange,
  drawing,
  drawColor,
  drawWidth,
  onStroke,
}: {
  video: HTMLVideoElement | null;
  edit: VideoEdit;
  layers: VideoLayer[];
  positionMs: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<VideoLayer>) => void;
  /** Mode dessin : les gestes tracent au lieu de déplacer. */
  drawing?: boolean;
  drawColor?: string;
  drawWidth?: number;
  onStroke?: (stroke: Stroke) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* Cadre réellement occupé par l'image, identique à l'aperçu WebGL. */
  const box: Box = useMemo(() => {
    const srcW = video?.videoWidth || 16;
    const srcH = video?.videoHeight || 9;
    const swap = edit.rotation === 90 || edit.rotation === 270;
    const cw = srcW * edit.crop.w;
    const ch = srcH * edit.crop.h;
    const outW = swap ? ch : cw;
    const outH = swap ? cw : ch;
    const ratio = outW / Math.max(outH, 1);
    const boxRatio = size.w / Math.max(size.h, 1);
    let width = size.w;
    let height = size.h;
    if (ratio > boxRatio) height = size.w / Math.max(ratio, 0.0001);
    else width = size.h * ratio;
    return {
      left: (size.w - width) / 2,
      top: (size.h - height) / 2,
      width,
      height,
    };
  }, [video?.videoWidth, video?.videoHeight, edit.rotation, edit.crop.w, edit.crop.h, size]);

  const visible = layers.filter((l) => isVisibleAt(l, positionMs));

  /* ---- Dessin ---- */
  const strokeRef = useRef<number[] | null>(null);
  const [livePath, setLivePath] = useState<string>("");

  const toNorm = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const el = hostRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - r.left - box.left) / Math.max(box.width, 1))),
        y: Math.max(0, Math.min(1, (e.clientY - r.top - box.top) / Math.max(box.height, 1))),
      };
    },
    [box],
  );

  const onDrawDown = (e: React.PointerEvent) => {
    if (!drawing) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toNorm(e);
    strokeRef.current = [p.x, p.y];
    setLivePath(`M ${p.x * box.width} ${p.y * box.height}`);
  };
  const onDrawMove = (e: React.PointerEvent) => {
    if (!drawing || !strokeRef.current) return;
    const p = toNorm(e);
    strokeRef.current.push(p.x, p.y);
    setLivePath((d) => `${d} L ${p.x * box.width} ${p.y * box.height}`);
  };
  const onDrawUp = () => {
    if (!drawing || !strokeRef.current) return;
    const pts = strokeRef.current;
    strokeRef.current = null;
    setLivePath("");
    if (pts.length >= 4) {
      onStroke?.({ points: pts, color: drawColor ?? "#ff3b30", width: drawWidth ?? 0.012 });
    }
  };

  return (
    <div
      ref={hostRef}
      className={`absolute inset-0 ${drawing ? "touch-none" : "pointer-events-none"}`}
      onPointerDown={drawing ? onDrawDown : undefined}
      onPointerMove={drawing ? onDrawMove : undefined}
      onPointerUp={drawing ? onDrawUp : undefined}
      onPointerCancel={drawing ? onDrawUp : undefined}
    >
      <div className="absolute" style={box}>
        {visible.map((layer) => (
          <LayerView
            key={layer.id}
            layer={layer}
            box={box}
            video={video}
            selected={selectedId === layer.id}
            interactive={!drawing}
            onSelect={() => onSelect(layer.id)}
            onChange={(patch) => onChange(layer.id, patch)}
          />
        ))}
        {drawing && livePath ? (
          <svg
            className="pointer-events-none absolute inset-0"
            width={box.width}
            height={box.height}
          >
            <path
              d={livePath}
              stroke={drawColor ?? "#ff3b30"}
              strokeWidth={(drawWidth ?? 0.012) * box.height}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

function LayerView({
  layer,
  box,
  video,
  selected,
  interactive,
  onSelect,
  onChange,
}: {
  layer: VideoLayer;
  box: Box;
  video: HTMLVideoElement | null;
  selected: boolean;
  interactive: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<VideoLayer>) => void;
}) {
  const style: React.CSSProperties = {
    left: layer.x * box.width,
    top: layer.y * box.height,
    width: layer.w * box.width,
    height: layer.h * box.height,
    opacity: layer.opacity,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
  };

  const drag = useRef<{
    x: number;
    y: number;
    lx: number;
    ly: number;
    mode: "move" | "size";
  } | null>(null);

  const start = (e: React.PointerEvent, mode: "move" | "size") => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelect();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      lx: mode === "move" ? layer.x : layer.w,
      ly: mode === "move" ? layer.y : layer.h,
      mode,
    };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / Math.max(box.width, 1);
    const dy = (e.clientY - d.y) / Math.max(box.height, 1);
    if (d.mode === "move") {
      onChange({
        x: clamp(d.lx + dx, -0.5, 1.5 - layer.w),
        y: clamp(d.ly + dy, -0.5, 1.5 - layer.h),
      } as Partial<VideoLayer>);
    } else {
      onChange({
        w: clamp(d.lx + dx, 0.05, 2),
        h: clamp(d.ly + dy, 0.03, 2),
      } as Partial<VideoLayer>);
    }
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div
      className={`absolute ${interactive ? "pointer-events-auto touch-none" : "pointer-events-none"} ${
        selected ? "outline outline-2 outline-primary" : ""
      }`}
      style={style}
      onPointerDown={(e) => start(e, "move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {layer.kind === "text" ? (
        <div
          className="flex h-full w-full items-center px-1"
          style={{
            justifyContent:
              layer.align === "left"
                ? "flex-start"
                : layer.align === "right"
                  ? "flex-end"
                  : "center",
            background: layer.background || "transparent",
          }}
        >
          <span
            style={{
              color: layer.color,
              fontSize: layer.fontSize * box.height,
              fontWeight: layer.bold ? 800 : 500,
              lineHeight: 1.1,
              textAlign: layer.align,
              whiteSpace: "pre-wrap",
            }}
          >
            {layer.text}
          </span>
        </div>
      ) : null}

      {layer.kind === "image" ? (
        <img
          src={layer.previewUrl}
          alt=""
          draggable={false}
          className="h-full w-full object-contain"
        />
      ) : null}

      {layer.kind === "draw" ? (
        <svg
          className="pointer-events-none absolute inset-0"
          width={layer.w * box.width}
          height={layer.h * box.height}
        >
          {layer.strokes.map((s, i) => (
            <path
              key={i}
              d={pathOf(s.points, layer.w * box.width, layer.h * box.height)}
              stroke={s.color}
              strokeWidth={s.width * box.height}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </svg>
      ) : null}

      {layer.kind === "effect" ? (
        layer.mode === "blur" ? (
          <div
            className="h-full w-full"
            style={{
              backdropFilter: `blur(${(2 + layer.strength * 22).toFixed(1)}px)`,
              WebkitBackdropFilter: `blur(${(2 + layer.strength * 22).toFixed(1)}px)`,
            }}
          />
        ) : (
          <MosaicPatch video={video} layer={layer} box={box} />
        )
      ) : null}

      {selected && interactive ? (
        <span
          role="presentation"
          onPointerDown={(e) => start(e, "size")}
          onPointerMove={move}
          onPointerUp={end}
          className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full border-2 border-background bg-primary"
        />
      ) : null}
    </div>
  );
}

/**
 * Aperçu réel de la mosaïque : la zone est réellement rééchantillonnée à
 * très basse résolution puis réagrandie sans lissage, comme le fera le
 * shader d'export.
 */
function MosaicPatch({
  video,
  layer,
  box,
}: {
  video: HTMLVideoElement | null;
  layer: { x: number; y: number; w: number; h: number; strength: number };
  box: Box;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !video) return;
    let raf = 0;
    const tick = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const blocks = Math.max(3, Math.round(40 - layer.strength * 34));
        canvas.width = blocks;
        canvas.height = Math.max(
          2,
          Math.round((blocks * layer.h * box.height) / Math.max(layer.w * box.width, 1)),
        );
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            video,
            layer.x * vw,
            layer.y * vh,
            Math.max(1, layer.w * vw),
            Math.max(1, layer.h * vh),
            0,
            0,
            canvas.width,
            canvas.height,
          );
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, layer.x, layer.y, layer.w, layer.h, layer.strength, box.width, box.height]);

  return (
    <canvas
      ref={ref}
      className="h-full w-full"
      style={{ imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}

function pathOf(points: number[], w: number, h: number): string {
  if (points.length < 4) return "";
  let d = `M ${points[0] * w} ${points[1] * h}`;
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i] * w} ${points[i + 1] * h}`;
  return d;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
