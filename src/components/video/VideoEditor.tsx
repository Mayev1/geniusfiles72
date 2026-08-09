/**
 * Éditeur vidéo GeniusFiles — coquille de l'espace de création.
 *
 * Étape 1 : la vidéo réelle du fichier reçu, un transport précis (lecture,
 * pause, retour au début, saut ±5 s) et une vérification honnête de la
 * capacité d'édition. Aucun outil n'est affiché tant que son rendu réel
 * n'existe pas : l'interface ne promet que ce que l'export sait produire.
 *
 * Étape 8 : undo/redo couvrant montage, réglages, calques et pistes audio,
 * via un historique immuable de snapshots `{ history.project, edit: history.edit }`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  SquareStack,
  Layers as LayersIcon,
  Undo2,
  AlertTriangle,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import type { FileEntry, PathRef } from "@/lib/files/types";
import { sourceUrlOf, absolutePathOf } from "@/lib/viewer/source";
import { toAbsolutePath } from "@/lib/files/fs";
import { peekThumbnail, resolveThumbnail } from "@/lib/native/thumbnails";
import { inspectEditability, canExportHere } from "@/lib/video/capabilities";
import { DEFAULT_EDIT, type VideoEdit } from "@/lib/video/edit";
import { extractVideoAudio } from "@/lib/video/export";
import { fmtTime } from "@/components/player/format";
import { VideoTimeline } from "./VideoTimeline";
import { MontageBar } from "./MontageBar";
import { ExportSheet } from "./ExportSheet";
import { saveVideoExport, type SaveMode } from "@/lib/video/save";
import { VideoExportCancelled, type ExportHandle } from "@/lib/video/export";
import {
  createProject,
  cutAfter,
  cutBefore,
  exportSegments,
  nextPlayable,
  removeSegment,
  removedRanges,
  segmentAt,
  splitAt,
  totalLength,
  type VideoProject,
} from "@/lib/video/project";
import { useVideoHistory } from "@/lib/video/history";
import { VideoGlPreview } from "./VideoGlPreview";
import { LayerOverlay } from "./LayerOverlay";
import { LayersSheet } from "./LayersSheet";
import { pickLocalFile } from "@/lib/video/pick";
import {
  layerLabel,
  makeDrawLayer,
  makeEffectLayer,
  makeImageLayer,
  makeTextLayer,
  nextLayerId,
  type AudioClip,
  type LayerKind,
  type VideoLayer,
} from "@/lib/video/layers";
import { TransformSheet } from "./TransformSheet";
import { AdjustmentsSheet } from "./AdjustmentsSheet";

export function VideoEditor({
  parent,
  entry,
  startAt = 0,
  onExit,
}: {
  parent: PathRef;
  entry: FileEntry;
  startAt?: number;
  onExit: () => void;
}) {
  const src = useMemo(() => sourceUrlOf(parent, entry), [parent, entry]);
  const absPath = useMemo(() => absolutePathOf(parent, entry), [parent, entry]);
  const report = useMemo(() => inspectEditability(entry), [entry]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mountedVideo, setMountedVideo] = useState<HTMLVideoElement | null>(null);
  const [glActive, setGlActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(startAt);
  const [dur, setDur] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [poster, setPoster] = useState<string | null>(() => peekThumbnail(absPath, 640));

  /* Montage non destructif : la source n'est jamais modifiée avant
     l'enregistrement explicite. L'historique empile des snapshots
     immuables `{ project, edit }` pour un undo/redo couvrant toutes
     les actions de l'étape 8. */
  const history = useVideoHistory({ project: createProject(0), edit: DEFAULT_EDIT });
  const { setEdit, setProject } = history;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exact, setExact] = useState(true);
  const [transformOpen, setTransformOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [extractingAudio, setExtractingAudio] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const handleRef = useRef<ExportHandle<unknown> | null>(null);

  const selectedLayerRef = useRef(selectedLayer);
  selectedLayerRef.current = selectedLayer;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  const gaps = useMemo(() => removedRanges(history.project), [history.project]);
  const kept = useMemo(() => totalLength(history.project), [history.project]);
  const exportable = report.editable && canExportHere() && dur > 0 && kept > 0.05;

  /* Validation des sélections quand l'historique bouge (undo/redo). */
  useEffect(() => {
    setActiveId((id) => (history.project.segments.some((s) => s.id === id) ? id : null));
  }, [history.project]);

  useEffect(() => {
    setSelectedLayer((id) => (history.edit.layers.some((l) => l.id === id) ? id : null));
    if (drawingRef.current) {
      const selected = history.edit.layers.find((l) => l.id === selectedLayerRef.current);
      if (selected?.kind !== "draw") setDrawing(false);
    }
  }, [history.edit.layers]);

  /* ---- Calques (étape 7) ---- */
  const setLayers = useCallback(
    (fn: (l: VideoLayer[]) => VideoLayer[]) =>
      setEdit((prev) => ({ ...prev, layers: fn(prev.layers) })),
    [setEdit],
  );

  const addLayer = useCallback(
    (kind: LayerKind, mode?: "blur" | "mosaic") => {
      const atMs = pos * 1000;
      const boundMs = (dur || 0) * 1000;
      if (kind === "image") {
        void pickLocalFile("image/*")
          .then((file) => {
            setEdit((prev) => {
              const id = nextLayerId(prev.layers, "image");
              const layer = makeImageLayer(id, atMs, boundMs, file);
              setSelectedLayer(id);
              return { ...prev, layers: [...prev.layers, layer] };
            });
          })
          .catch((e: unknown) => toast.error((e as Error).message || "Import impossible"));
        return;
      }
      setEdit((prev) => {
        const id = nextLayerId(prev.layers, kind);
        const layer =
          kind === "text"
            ? makeTextLayer(id, atMs, boundMs)
            : kind === "draw"
              ? makeDrawLayer(id, atMs, boundMs)
              : makeEffectLayer(id, atMs, boundMs, mode ?? "blur");
        setSelectedLayer(id);
        if (kind === "draw") setDrawing(true);
        return { ...prev, layers: [...prev.layers, layer] };
      });
    },
    [pos, dur, setEdit],
  );

  const changeLayer = useCallback(
    (id: string, patch: Partial<VideoLayer>) =>
      setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as VideoLayer) : l))),
    [setLayers],
  );

  const removeLayer = useCallback(
    (id: string) => {
      setLayers((ls) => ls.filter((l) => l.id !== id));
      setSelectedLayer((cur) => (cur === id ? null : cur));
      setDrawing(false);
    },
    [setLayers],
  );

  const addStroke = useCallback(
    (stroke: { points: number[]; color: string; width: number }) =>
      setLayers((ls) =>
        ls.map((l) =>
          l.id === selectedLayer && l.kind === "draw"
            ? { ...l, strokes: [...l.strokes, stroke] }
            : l,
        ),
      ),
    [setLayers, selectedLayer],
  );

  const addAudioTrack = useCallback(() => {
    void pickLocalFile("audio/*")
      .then((file) => {
        setEdit((prev) => {
          const id = nextLayerId(prev.audioTracks, "audio");
          const clip: AudioClip = {
            id,
            path: file.path,
            name: file.name,
            startMs: Math.round(pos * 1000),
            offsetMs: 0,
            durationMs: 0,
            volume: 1,
          };
          return { ...prev, audioTracks: [...prev.audioTracks, clip] };
        });
      })
      .catch((e: unknown) => toast.error((e as Error).message || "Import impossible"));
  }, [pos, setEdit]);

  const changeAudio = useCallback(
    (id: string, patch: Partial<AudioClip>) =>
      setEdit((prev) => ({
        ...prev,
        audioTracks: prev.audioTracks.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      })),
    [setEdit],
  );

  const removeAudio = useCallback(
    (id: string) =>
      setEdit((prev) => ({
        ...prev,
        audioTracks: prev.audioTracks.filter((a) => a.id !== id),
      })),
    [setEdit],
  );

  const runExport = useCallback(
    (mode: SaveMode) => {
      setExporting(true);
      setProgress(0);
      const handle = saveVideoExport({
        parent,
        entry,
        segments: exportSegments(history.project),
        exact,
        edit: history.edit,
        mode,
        onProgress: setProgress,
      });
      handleRef.current = handle;
      handle.promise
        .then((res) => {
          toast.success(
            mode === "replace" ? "Vidéo d'origine remplacée" : `Enregistré sous « ${res.name} »`,
          );
          setExportOpen(false);
        })
        .catch((e: unknown) => {
          if (e instanceof VideoExportCancelled) toast.message("Export annulé");
          else toast.error((e as Error).message || "Export impossible");
        })
        .finally(() => {
          handleRef.current = null;
          setExporting(false);
        });
    },
    [parent, entry, history.project, exact, history.edit],
  );

  const runExtractAudio = useCallback(() => {
    if (!canExportHere()) {
      toast.error("L'extraction audio nécessite l'application Android.");
      return;
    }
    setExtractingAudio(true);
    const handle = extractVideoAudio(
      {
        path: absPath,
        outputDir: toAbsolutePath(parent),
        outputName: `${entry.name.replace(/\.[^.]+$/, "")}-audio.m4a`,
        segments: exportSegments(history.project),
        edit: history.edit,
      },
      setProgress,
    );
    handleRef.current = handle;
    handle.promise
      .then((res) => {
        toast.success(`Bande son extraite : ${res.name}`);
        setAdjustOpen(false);
      })
      .catch((e: unknown) => {
        if (e instanceof VideoExportCancelled) toast.message("Extraction annulée");
        else toast.error((e as Error).message || "Extraction impossible");
      })
      .finally(() => {
        handleRef.current = null;
        setExtractingAudio(false);
      });
  }, [absPath, parent, entry, history.project, history.edit]);

  useEffect(() => () => handleRef.current?.cancel(), []);

  useEffect(() => {
    if (poster) return;
    let alive = true;
    void resolveThumbnail(absPath, 640).then((u) => {
      if (alive && u) setPoster(u);
    });
    return () => {
      alive = false;
    };
  }, [absPath, poster]);

  /* Position réelle du média comme unique source de vérité : on lit
     `currentTime` à chaque frame d'affichage plutôt qu'à un intervalle
     arbitraire, pour un curseur sans décalage cumulatif. */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        /* L'aperçu obéit au montage : les portions retirées sont sautées
           exactement comme le fera le fichier exporté. */
        const t = v.currentTime;
        if (history.project.duration > 0 && !segmentAt(history.project, t)) {
          const jump = nextPlayable(history.project, t);
          if (jump === null) {
            v.pause();
            const last = history.project.segments[history.project.segments.length - 1];
            if (last) {
              v.currentTime = last.end;
              setPos(last.end);
            }
          } else if (Math.abs(jump - t) > 0.02) {
            v.currentTime = jump;
            setPos(jump);
          }
        } else {
          setPos(t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, history.project]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(v.duration || 0, t));
    v.currentTime = next;
    setPos(next);
  }, []);

  /* Scrub depuis la timeline : on met à jour l'image le plus vite possible
     (fastSeek quand le décodeur le propose) et on met la lecture en pause
     le temps du geste, comme les monteurs natifs. */
  const scrubbing = useRef(false);
  const onScrub = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (!scrubbing.current) {
      scrubbing.current = true;
      if (!v.paused) v.pause();
    }
    setPos(t);
    const clamped = Math.max(0, Math.min(v.duration || 0, t));
    if (typeof v.fastSeek === "function") v.fastSeek(clamped);
    else v.currentTime = clamped;
  }, []);
  const onScrubEnd = useCallback((t: number) => {
    scrubbing.current = false;
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground">
      {/* En-tête */}
      <header
        className="flex items-center gap-2 border-b border-border/60 bg-background px-2 py-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      >
        <button
          type="button"
          onClick={onExit}
          aria-label="Quitter l'éditeur"
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight">{entry.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">Éditeur vidéo</p>
        </div>
        <button
          type="button"
          disabled={!history.canUndo || exporting}
          onClick={() => history.undo()}
          aria-label="Annuler"
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground active:scale-95 disabled:opacity-35"
        >
          <Undo2 className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          disabled={!history.canRedo || exporting}
          onClick={() => history.redo()}
          aria-label="Rétablir"
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground active:scale-95 disabled:opacity-35"
        >
          <Redo2 className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          disabled={!exportable || exporting}
          onClick={() => setExportOpen(true)}
          className="ml-1 flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-semibold text-primary-foreground active:scale-95 disabled:opacity-40"
        >
          <Check className="h-4 w-4" />
          Exporter
        </button>
      </header>

      {/* Aperçu réel */}
      <div className="relative min-h-0 flex-1 bg-black/90">
        {src && !failed ? (
          <>
            <video
              ref={(v) => {
                videoRef.current = v;
                setMountedVideo(v);
              }}
              src={src}
              poster={poster ?? undefined}
              playsInline
              className={`h-full w-full object-contain ${glActive ? "opacity-0" : ""}`}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setDur(v.duration || 0);
                setProject((prev) => (prev.duration > 0 ? prev : createProject(v.duration || 0)), {
                  history: false,
                });
                setReady(true);
                if (startAt > 0) {
                  v.currentTime = Math.min(startAt, v.duration || startAt);
                  setPos(v.currentTime);
                }
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => {
                if (!playing) setPos(e.currentTarget.currentTime);
              }}
              onError={() => setFailed(true)}
              onClick={toggle}
            />
            <VideoGlPreview
              video={mountedVideo}
              edit={history.edit}
              disabled={!ready}
              onReady={() => setGlActive(true)}
              onFail={() => setGlActive(false)}
            />
            <LayerOverlay
              video={mountedVideo}
              edit={history.edit}
              layers={history.edit.layers}
              positionMs={pos * 1000}
              selectedId={selectedLayer}
              onSelect={setSelectedLayer}
              onChange={changeLayer}
              drawing={drawing}
              onStroke={addStroke}
            />
            {/* Boutons d'édition flottants */}
            <div className="absolute right-3 top-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setTransformOpen(true)}
                disabled={exporting || extractingAudio}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-background/90 text-foreground shadow-soft backdrop-blur-sm active:scale-95 disabled:opacity-40"
                aria-label="Recadrage et rotation"
              >
                <SquareStack className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setAdjustOpen(true)}
                disabled={exporting || extractingAudio}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-background/90 text-foreground shadow-soft backdrop-blur-sm active:scale-95 disabled:opacity-40"
                aria-label="Image et son"
              >
                <SlidersHorizontal className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setLayersOpen(true)}
                disabled={exporting || extractingAudio}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-background/90 text-foreground shadow-soft backdrop-blur-sm active:scale-95 disabled:opacity-40"
                aria-label="Calques"
              >
                <LayersIcon className="h-5 w-5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-8 text-center">
            <AlertTriangle className="h-6 w-6 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">
              {failed
                ? "Cette vidéo ne peut pas être décodée sur cet appareil."
                : "Aperçu vidéo indisponible dans le navigateur."}
            </p>
          </div>
        )}
      </div>

      {/* Avertissements honnêtes : jamais d'outil affiché comme actif s'il
          ne peut pas produire un résultat réel. */}
      {!report.editable ? (
        <Notice
          tone="danger"
          title={report.reason}
          detail={"hint" in report ? report.hint : undefined}
        />
      ) : !canExportHere() ? (
        <Notice
          tone="muted"
          title="L'export vidéo nécessite l'application Android."
          detail="L'aperçu fonctionne ici, mais l'encodage réel utilise les codecs matériels de l'appareil."
        />
      ) : null}

      {report.editable && dur > 0 ? (
        <MontageBar
          project={history.project}
          position={pos}
          activeId={activeId}
          disabled={exporting}
          onCutBefore={() => setProject((p) => cutBefore(p, pos))}
          onCutAfter={() => setProject((p) => cutAfter(p, pos))}
          onSplit={() => setProject((p) => splitAt(p, pos))}
          onDeleteActive={() => activeId && setProject((p) => removeSegment(p, activeId))}
          onReset={() => {
            setActiveId(null);
            setProject(() => createProject(dur));
          }}
        />
      ) : null}

      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        originalName={entry.name}
        keptLength={kept}
        segmentCount={history.project.segments.length}
        exact={exact}
        onExactChange={setExact}
        busy={exporting}
        progress={progress}
        onExport={runExport}
        onCancelExport={() => handleRef.current?.cancel()}
      />

      <TransformSheet
        open={transformOpen}
        onClose={() => setTransformOpen(false)}
        edit={history.edit}
        onChange={(next) => setEdit(() => next)}
        srcW={dur > 0 && mountedVideo?.videoWidth ? mountedVideo.videoWidth : 1920}
        srcH={dur > 0 && mountedVideo?.videoHeight ? mountedVideo.videoHeight : 1080}
      />

      <LayersSheet
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        layers={history.edit.layers}
        audioTracks={history.edit.audioTracks}
        selectedId={selectedLayer}
        positionMs={pos * 1000}
        durationMs={(dur || 0) * 1000}
        drawing={drawing}
        onSelect={setSelectedLayer}
        onAdd={addLayer}
        onChange={changeLayer}
        onRemove={removeLayer}
        onToggleDrawing={() => setDrawing((d) => !d)}
        onAddAudio={addAudioTrack}
        onAudioChange={changeAudio}
        onAudioRemove={removeAudio}
      />

      <AdjustmentsSheet
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        edit={history.edit}
        onChange={(next) => setEdit(() => next)}
        onExtractAudio={runExtractAudio}
      />

      {/* Transport */}
      <footer
        className="border-t border-border/60 bg-background px-4 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <div className="-mx-4 mb-3">
          <VideoTimeline
            src={src}
            duration={dur}
            position={pos}
            playing={playing}
            segments={history.project.segments}
            removed={gaps}
            activeSegmentId={activeId}
            onSelectSegment={setActiveId}
            layers={history.edit.layers.map((l) => ({
              id: l.id,
              start: l.startMs / 1000,
              end: l.endMs / 1000,
              label: layerLabel(l),
            }))}
            activeLayerId={selectedLayer}
            onSelectLayer={(id) => {
              setSelectedLayer(id);
              setLayersOpen(true);
            }}
            onScrub={onScrub}
            onScrubEnd={onScrubEnd}
          />
        </div>
        <div className="mb-2 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{fmtTime(pos)}</span>
          <span>{dur > 0 ? fmtTime(dur) : "--:--"}</span>
        </div>
        <div className="flex items-center justify-center gap-3">
          <TransportButton label="Retour au début" onPress={() => seekTo(0)}>
            <RotateCcw className="h-[18px] w-[18px]" />
          </TransportButton>
          <TransportButton label="Reculer de 5 secondes" onPress={() => seekTo(pos - 5)}>
            <span className="text-[12px] font-semibold">-5s</span>
          </TransportButton>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              toggle();
            }}
            disabled={!ready}
            aria-label={playing ? "Pause" : "Lecture"}
            className="flex h-14 w-14 touch-manipulation items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition-transform duration-75 active:scale-95 disabled:opacity-40"
          >
            {playing ? (
              <Pause className="h-6 w-6" fill="currentColor" />
            ) : (
              <Play className="ml-0.5 h-6 w-6" fill="currentColor" />
            )}
          </button>
          <TransportButton label="Avancer de 5 secondes" onPress={() => seekTo(pos + 5)}>
            <span className="text-[12px] font-semibold">+5s</span>
          </TransportButton>
          <TransportButton label="Aller à la fin" onPress={() => seekTo(dur)}>
            <RotateCcw className="h-[18px] w-[18px] -scale-x-100" />
          </TransportButton>
        </div>
      </footer>
    </div>
  );
}

function Notice({
  tone,
  title,
  detail,
}: {
  tone: "danger" | "muted";
  title: string;
  detail?: string;
}) {
  return (
    <div
      className={`mx-3 mb-2 mt-2 rounded-xl border px-3 py-2 ${
        tone === "danger"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-surface-2/60 text-muted-foreground"
      }`}
    >
      <p className="text-[12.5px] font-medium leading-snug">{title}</p>
      {detail ? <p className="mt-0.5 text-[11.5px] leading-snug opacity-80">{detail}</p> : null}
    </div>
  );
}

function TransportButton({
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
      className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-secondary/60 text-foreground transition-transform duration-75 active:scale-95"
    >
      {children}
    </button>
  );
}
