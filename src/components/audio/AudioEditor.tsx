/**
 * Éditeur audio GeniusFiles.
 *
 * Espace dédié, non destructif : le clip source décodé n'est jamais
 * modifié. Chaque outil ajoute une opération (paramètres uniquement) à une
 * pile ; le rendu est recomposé de façon incrémentale (voir
 * `@/lib/audio/render`). Undo/Redo déplacent simplement un curseur dans
 * cette pile — aucune copie complète du signal n'est conservée.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  BellRing,
  Check,
  Clipboard,
  Copy,
  Filter,
  Flame,
  Gauge,
  Headphones,
  Layers,
  MicOff,
  Music4,
  Loader2,
  Music2,
  Radio,
  Redo2,
  Repeat2,
  Rewind,
  FastForward,
  Pause,
  Play,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { FileSourcePicker } from "@/components/files/FileSourcePicker";
import type { FileEntry, PathRef } from "@/lib/files/types";
import { BottomSheet, PrimaryButton, TextField } from "@/components/files/BottomSheet";
import { formatSize } from "@/lib/files/format";
import { BACK_PRIORITY, useBackHandler } from "@/lib/navigation/back-stack";
import { tick } from "@/lib/photo/haptics";
import { audioStore } from "@/lib/player/audio-store";

import { AudioEditorError, loadAudioClip, loadAudioClipFromPath } from "@/lib/audio/decode";
import { clearPeakStores } from "@/lib/audio/peaks";
import { applyOp, RenderCache, storeClip } from "@/lib/audio/render";
import { ClipPlayer } from "@/lib/audio/player";
import { keepRange, durationOf, rangeToSamples, sliceClip } from "@/lib/audio/dsp";
import {
  saveEditedAudio,
  suggestedAudioName,
  withFormatExtension,
  type AudioExportFormat,
} from "@/lib/audio/save";
import { MP3_BITRATES } from "@/lib/audio/mp3";
import { SOUNDS, generateSound, type SoundId } from "@/lib/audio/library";
import { opId, type AudioClip, type AudioOp, type TimeRange } from "@/lib/audio/types";
import { mixTracks } from "@/lib/audio/mix";
import {
  editTrack,
  isAudible,
  timelineDuration,
  trackId,
  type ExtraTrack,
} from "@/lib/audio/tracks";
import { CENSOR_DEFAULTS, type CensorStyle } from "@/lib/audio/censor";
import {
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  normalizeBpm,
  planSync,
  stretchWsola,
  type SyncInput,
} from "@/lib/audio/sync";
import { Waveform, type WaveView } from "./Waveform";
import { TrackLanes, type LaneId } from "./TrackLanes";

/* --------------------------------------------------------------- utils */

function fmt(t: number, precise = false): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 100);
  return precise
    ? `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

type ToolId =
  | "select"
  | "cut"
  | "delete"
  | "copy"
  | "paste"
  | "volume"
  | "fade"
  | "speed"
  | "pitch"
  | "normalize"
  | "silence"
  | "reverse"
  | "split"
  | "merge"
  | "sounds"
  | "censor"
  | "tracks"
  | "echo"
  | "reverb"
  | "eq"
  | "filter"
  | "dynamics"
  | "saturate"
  | "stereo";

const TOOLS: { id: ToolId; label: string; icon: LucideIcon }[] = [
  { id: "select", label: "Sélection", icon: Layers },
  { id: "cut", label: "Découper", icon: Scissors },
  { id: "delete", label: "Supprimer", icon: Trash2 },
  { id: "copy", label: "Copier", icon: Copy },
  { id: "paste", label: "Coller", icon: Clipboard },
  { id: "volume", label: "Volume", icon: Volume2 },
  { id: "fade", label: "Fondu", icon: Waves },
  { id: "eq", label: "Égaliseur", icon: SlidersHorizontal },
  { id: "reverb", label: "Réverb", icon: Radio },
  { id: "echo", label: "Écho", icon: Repeat2 },
  { id: "filter", label: "Filtre", icon: Filter },
  { id: "dynamics", label: "Dynamique", icon: Activity },
  { id: "saturate", label: "Saturation", icon: Flame },
  { id: "stereo", label: "Stéréo", icon: Headphones },
  { id: "speed", label: "Vitesse", icon: Gauge },
  { id: "pitch", label: "Hauteur", icon: Music2 },
  { id: "normalize", label: "Normaliser", icon: Sparkles },
  { id: "silence", label: "Silence", icon: VolumeX },
  { id: "reverse", label: "Inverser", icon: ArrowLeftRight },
  { id: "split", label: "Diviser", icon: SquareSplitHorizontal },
  { id: "merge", label: "Fusionner", icon: Layers },
  { id: "sounds", label: "Sons", icon: BellRing },
  { id: "censor", label: "Censure", icon: MicOff },
  { id: "tracks", label: "Pistes", icon: Music4 },
];

/**
 * Compteur de temps isolé : il s'abonne à l'horloge audio dans sa propre
 * boucle d'animation. L'éditeur entier n'est donc jamais re-rendu pendant
 * la lecture — seul ce petit nœud de texte change.
 */
function TimeReadout({
  positionRef,
  getTime,
  playing,
}: {
  positionRef: React.MutableRefObject<number>;
  getTime: (lead?: number) => number | null;
  playing: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let shown = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = getTime() ?? positionRef.current;
      const text = fmt(t, true);
      if (text !== shown && ref.current) {
        shown = text;
        ref.current.textContent = text;
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [getTime, positionRef, playing]);
  return (
    <span ref={ref} className="font-mono text-foreground">
      {fmt(positionRef.current, true)}
    </span>
  );
}

/* --------------------------------------------------------------- écran */

export function AudioEditor({
  parent,
  entry,
  onExit,
}: {
  parent: PathRef;
  entry: FileEntry;
  onExit: () => void;
}) {
  const [source, setSource] = useState<AudioClip | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cacheRef = useRef<RenderCache | null>(null);
  const playerRef = useRef<ClipPlayer | null>(null);
  const positionRef = useRef(0);

  const [ops, setOps] = useState<AudioOp[]>([]);
  const [cursor, setCursor] = useState(0);
  const [savedCursor, setSavedCursor] = useState(0);
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const [selection, setSelection] = useState<TimeRange | null>(null);
  const [position, setPosition] = useState(0);
  const [view, setView] = useState<WaveView>({ from: 0, to: 1 });
  const [playing, setPlaying] = useState(false);
  const [clipboardInfo, setClipboardInfo] = useState<{ id: string; duration: number } | null>(null);

  /* Pistes additionnelles (nombre illimité) : mixées à la lecture et à l'export. */
  const [tracks, setTracks] = useState<ExtraTrack[]>([]);
  const [mainMuted, setMainMuted] = useState(false);
  const [selectedLane, setSelectedLane] = useState<LaneId>("main");
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  /**
   * Synchronisation : piste maître et BPM **manuel** de la piste
   * principale. Les BPM des pistes ajoutées vivent sur la piste elle-même
   * (donc dans l'historique). Aucun BPM n'est jamais détecté.
   */
  const [masterLane, setMasterLane] = useState<LaneId>("main");
  const [mainBpm, setMainBpm] = useState<number>(DEFAULT_BPM);

  /**
   * Historique unifié : chaque étape restaure ensemble l'audio (opérations,
   * pistes) et l'état visuel (curseur, sélection, fenêtre de zoom).
   * `markStructural` demande une étape immédiate (sinon les changements
   * visuels sont regroupés après une courte pause).
   */
  const commitNowRef = useRef(false);
  const markStructural = useCallback(() => {
    commitNowRef.current = true;
  }, []);
  const snapshotTracks = markStructural;

  const [tool, setTool] = useState<ToolId | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<AudioExportFormat>("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [exportMono, setExportMono] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  const activeOps = useMemo(() => ops.slice(0, cursor), [ops, cursor]);
  const ops0 = useMemo(() => activeOps.filter((o) => (o.track ?? 0) === 0), [activeOps]);
  const renderToken = useMemo(() => ops0.map((o) => o.id).join(">"), [ops0]);
  const dirty = cursor !== savedCursor || tracks.length > 0;
  const duration = clip ? durationOf(clip) : 0;
  const totalDuration = timelineDuration(duration, tracks);
  const selectedTrack = useMemo(
    () => (selectedLane === "main" ? null : (tracks.find((t) => t.id === selectedLane) ?? null)),
    [selectedLane, tracks],
  );

  /* ---------- chargement ---------- */
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    // Le lecteur global garde sa file intacte : on le met simplement en
    // pause pour ne pas superposer deux sons.
    try {
      audioStore.pause();
    } catch {
      /* le lecteur peut ne pas être initialisé */
    }
    void loadAudioClip(parent, entry)
      .then((c) => {
        if (cancelled) return;
        cacheRef.current = new RenderCache(c);
        setSource(c);
        setClip(c);
        setView({ from: 0, to: durationOf(c) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(
          e instanceof AudioEditorError ? e.message : "Impossible d'ouvrir ce fichier audio.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [parent, entry]);

  useEffect(() => {
    const p = new ClipPlayer();
    playerRef.current = p;
    p.onEnded = () => {
      // La position finale vient de l'horloge audio : le curseur s'arrête
      // exactement là où le son s'est arrêté.
      positionRef.current = p.lastPosition;
      setPosition(positionRef.current);
      setPlaying(false);
    };
    return () => {
      p.dispose();
      playerRef.current = null;
    };
  }, []);

  /**
   * Référence temporelle unique : l'horloge du moteur audio. Tant qu'un son
   * joue, l'interface lit cette horloge (jamais un compteur parallèle), ce
   * qui rend toute dérive impossible. À l'arrêt, on retombe sur la position
   * figée de l'éditeur.
   */
  const getTime = useCallback((lead = 0) => {
    const live = playerRef.current?.currentTime(lead) ?? null;
    if (live != null) positionRef.current = live;
    return live;
  }, []);

  useEffect(() => {
    if (!playing) positionRef.current = position;
  }, [position, playing]);

  /* ---------- rendu incrémental ---------- */
  useEffect(() => {
    const cache = cacheRef.current;
    if (!cache) return;
    // Rendu synchrone : le cache est incrémental (seule la dernière
    // opération est calculée), donc attendre un timer n'apporterait qu'une
    // latence visible. Le résultat est à l'écran dès la frame suivante.
    try {
      const next = cache.render(ops0);
      setClip(next);
      playerRef.current?.invalidate();
      const dur = durationOf(next);
      setPosition((p) => Math.min(p, dur));
      setSelection((s) =>
        s ? { start: Math.min(s.start, dur), end: Math.min(s.end, dur) } : null,
      );
      setView((v) => {
        const to = Math.min(v.to, dur);
        const from = Math.min(v.from, Math.max(0, to - 0.02));
        return to - from < 0.02 ? { from: 0, to: dur } : { from, to };
      });
    } catch {
      toast.error("Échec du traitement audio");
    } finally {
      setBusy(false);
    }
  }, [ops0]);

  /* ---------- historique ---------- */
  /**
   * Ajoute une ou plusieurs opérations en *une seule* étape d'historique.
   * Le lot est indispensable pour les actions composées (remplacer une
   * sélection = supprimer + insérer) : elles doivent s'annuler d'un coup et
   * ne jamais se marcher dessus.
   *
   * Les effets s'appliquent toujours à la piste principale ; les pistes
   * ajoutées sont éditées directement depuis le panneau « Pistes ».
   */
  const pushOps = useCallback((input: AudioOp | AudioOp[]) => {
    const raw = Array.isArray(input) ? input : [input];
    const group = raw.length > 1 ? `g_${opId()}` : undefined;
    const list = raw.map((op) => ({ ...op, track: 0, group }) as AudioOp);
    if (list.length === 0) return;
    commitNowRef.current = true;
    playerRef.current?.stop(false);
    setPlaying(false);
    setOps((prev) => {
      const next = [...prev.slice(0, cursorRef.current), ...list];
      cursorRef.current = next.length;
      return next;
    });
    setCursor((c) => c + list.length);
    tick();
  }, []);
  const pushOp = pushOps;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  /* ---------- historique unifié (audio + visuel) ---------- */
  type HistoryStep = {
    cursor: number;
    tracks: ExtraTrack[];
    selection: TimeRange | null;
    position: number;
    view: WaveView;
    selectedLane: LaneId;
    masterLane: LaneId;
    mainBpm: number;
  };
  const historyRef = useRef<HistoryStep[]>([]);
  const [hIndex, setHIndex] = useState(0);
  const applyingRef = useRef(false);
  const hIndexRef = useRef(0);
  hIndexRef.current = hIndex;

  const sameStep = useCallback(
    (a: HistoryStep, b: HistoryStep) =>
      a.cursor === b.cursor &&
      a.tracks === b.tracks &&
      a.selectedLane === b.selectedLane &&
      a.masterLane === b.masterLane &&
      a.mainBpm === b.mainBpm &&
      Math.abs(a.position - b.position) < 0.001 &&
      Math.abs(a.view.from - b.view.from) < 0.001 &&
      Math.abs(a.view.to - b.view.to) < 0.001 &&
      (a.selection === b.selection ||
        (!!a.selection &&
          !!b.selection &&
          Math.abs(a.selection.start - b.selection.start) < 0.001 &&
          Math.abs(a.selection.end - b.selection.end) < 0.001)),
    [],
  );

  // Toute modification (audio, piste, curseur, sélection, limites de zoom)
  // devient une étape. Les gestes continus sont regroupés par une courte
  // pause ; les actions structurelles sont enregistrées immédiatement.
  useEffect(() => {
    const step: HistoryStep = {
      cursor,
      tracks,
      selection,
      position,
      view,
      selectedLane,
      masterLane,
      mainBpm,
    };
    if (historyRef.current.length === 0) {
      historyRef.current = [step];
      setHIndex(0);
      return;
    }
    if (applyingRef.current) {
      applyingRef.current = false;
      return;
    }
    const current = historyRef.current[hIndexRef.current];
    if (current && sameStep(current, step)) return;
    const commit = () => {
      const base = historyRef.current.slice(0, hIndexRef.current + 1);
      const top = base[base.length - 1];
      if (top && sameStep(top, step)) return;
      const next = [...base, step].slice(-80);
      historyRef.current = next;
      setHIndex(next.length - 1);
    };
    if (commitNowRef.current) {
      commitNowRef.current = false;
      commit();
      return;
    }
    // Pendant la lecture, la position suit l'horloge : pas d'étape parasite.
    if (playing) return;
    const t = window.setTimeout(commit, 320);
    return () => window.clearTimeout(t);
  }, [
    cursor,
    tracks,
    selection,
    position,
    view,
    selectedLane,
    masterLane,
    mainBpm,
    playing,
    sameStep,
  ]);

  const applyStep = useCallback((s: HistoryStep) => {
    applyingRef.current = true;
    commitNowRef.current = false;
    playerRef.current?.stop(false);
    setPlaying(false);
    setCursor(s.cursor);
    cursorRef.current = s.cursor;
    setTracks(s.tracks);
    setSelection(s.selection);
    setSelectedLane(s.selectedLane);
    setMasterLane(s.masterLane);
    setMainBpm(s.mainBpm);
    positionRef.current = s.position;
    setPosition(s.position);
    setView(s.view);
    playerRef.current?.invalidate();
    tick();
  }, []);

  const canUndo = hIndex > 0;
  const canRedo = hIndex < historyRef.current.length - 1;
  const undo = () => {
    if (hIndexRef.current <= 0) return;
    const i = hIndexRef.current - 1;
    const s = historyRef.current[i];
    if (!s) return;
    setHIndex(i);
    hIndexRef.current = i;
    applyStep(s);
  };
  const redo = () => {
    if (hIndexRef.current >= historyRef.current.length - 1) return;
    const i = hIndexRef.current + 1;
    const s = historyRef.current[i];
    if (!s) return;
    setHIndex(i);
    hIndexRef.current = i;
    applyStep(s);
  };

  /* ---------- aperçu temps réel des effets ---------- */
  // Un effet en cours de réglage est rendu sur un clip temporaire : la
  // forme d'onde et le son suivent les curseurs, sans passer par
  // l'historique et sans bouton « Écouter ».
  const [liveClip, setLiveClip] = useState<AudioClip | null>(null);
  const [liveToken, setLiveToken] = useState<string | null>(null);
  const liveClipRef = useRef<AudioClip | null>(null);
  const liveTokenRef = useRef<string | null>(null);
  const liveOpRef = useRef<AudioOp | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  const liveSeqRef = useRef(0);
  const clipRef = useRef<AudioClip | null>(null);
  const playingRef = useRef(false);
  clipRef.current = clip;
  playingRef.current = playing;

  /* ---------- lecture ---------- */

  /** Pause : le curseur se fige exactement sur la position audio atteinte. */
  const stop = useCallback(() => {
    const p = playerRef.current;
    if (p) {
      const at = p.lastPosition;
      p.stop(false);
      positionRef.current = at;
      setPosition(at);
    }
    setPlaying(false);
  }, []);

  const play = useCallback(
    (from?: number, until?: number, target?: AudioClip, token?: string) => {
      // Sans cible explicite, on joue l'aperçu temps réel s'il existe :
      // ce que l'on entend est exactement ce que « Appliquer » produira.
      const c = target ?? liveClipRef.current ?? clip;
      const p = playerRef.current;
      if (!c || !p) return;
      // Toutes les pistes audibles démarrent sur la même horloge : elles
      // s'entendent ensemble, exactement comme dans l'export.
      const layers = tracks
        .filter((t) => t.clip.length > 0)
        .map((t) => ({
          clip: t.clip,
          token: `${t.id}_${t.clip.length}`,
          offset: t.offset,
          gain: t.gain,
          muted: !isAudible(t, tracks),
        }));
      // `positionRef` est la vérité courante (mise à jour par l'horloge audio
      // et par les gestes) : on ne dépend jamais d'un état React périmé.
      const at = from ?? positionRef.current;
      positionRef.current = at;
      p.play(
        c,
        token ?? (target ? "target" : (liveTokenRef.current ?? renderToken ?? "base") || "base"),
        at,
        until,
        layers,
      );
      setPlaying(true);
    },
    [clip, renderToken, tracks],
  );

  const togglePlay = () => {
    if (playing) {
      stop();
      return;
    }
    if (selection && selection.end - selection.start > 0.02) {
      play(selection.start, selection.end);
    } else {
      const at = positionRef.current;
      play(at >= duration - 0.05 ? 0 : at);
    }
  };

  const nudge = (delta: number) => {
    const t = Math.max(0, Math.min(duration, positionRef.current + delta));
    positionRef.current = t;
    setPosition(t);
    if (playing) play(t);
  };

  const playOriginal = () => {
    if (!source) return;
    stop();
    const p = playerRef.current;
    if (!p) return;
    p.invalidate();
    p.play(source, "__source__", 0);
    setPlaying(true);
  };

  /* ---------- hauteur de la forme d'onde ---------- */
  const waveBoxRef = useRef<HTMLDivElement | null>(null);
  const [waveH, setWaveH] = useState(0);
  useEffect(() => {
    const el = waveBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWaveH(el.clientHeight));
    ro.observe(el);
    setWaveH(el.clientHeight);
    return () => ro.disconnect();
  }, [clip]);

  /* ---------- zoom ---------- */
  // La fenêtre « vivante » suit les gestes et le défilement de lecture sans
  // re-rendre l'éditeur ; les boutons de zoom partent donc d'ici.
  const liveViewRef = useRef<WaveView>(view);
  const zoom = (factor: number) => {
    const v = liveViewRef.current;
    const pos = positionRef.current;
    const center = pos >= v.from && pos <= v.to ? pos : (v.from + v.to) / 2;
    const span = Math.max(0.02, Math.min(duration, (v.to - v.from) * factor));
    let from = center - span / 2;
    let to = from + span;
    if (from < 0) {
      from = 0;
      to = span;
    }
    if (to > duration) {
      to = duration;
      from = Math.max(0, duration - span);
    }
    setView({ from, to });
  };

  const zoomAll = () => setView({ from: 0, to: duration });
  const zoomSelection = () => {
    if (!selection) return;
    const pad = Math.max(0.05, (selection.end - selection.start) * 0.15);
    setView({
      from: Math.max(0, selection.start - pad),
      to: Math.min(duration, selection.end + pad),
    });
  };

  /* ---------- outils ---------- */
  const needSelection = (): TimeRange | null => {
    if (selection && selection.end - selection.start > 0.005) return selection;
    toast.error("Sélectionnez d'abord une portion de la forme d'onde.");
    return null;
  };

  const doCut = () => {
    const r = needSelection();
    if (!r) return;
    pushOp({ id: opId(), type: "keep", range: r });
    setSelection(null);
    setPosition(0);
  };
  const doDelete = () => {
    const r = needSelection();
    if (!r) return;
    pushOp({ id: opId(), type: "delete", range: r });
    setSelection(null);
    setPosition(r.start);
  };
  const doSilence = () => {
    const r = needSelection();
    if (!r) return;
    pushOp({ id: opId(), type: "silence", range: r });
  };
  const doReverse = () => {
    pushOp({ id: opId(), type: "reverse", range: selection ?? undefined });
  };

  /**
   * Aperçu temps réel : l'opération est rendue sur le clip courant sans
   * toucher à l'historique. La forme d'onde affiche le résultat et, si un
   * son joue, la lecture bascule sur ce rendu à la même position — donc
   * plus de bouton « Écouter » : on entend directement ce que produira
   * « Appliquer ».
   */
  const clearLive = useCallback(() => {
    if (liveTimerRef.current != null) {
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    liveOpRef.current = null;
    if (liveClipRef.current) {
      liveClipRef.current = null;
      liveTokenRef.current = null;
      setLiveClip(null);
      setLiveToken(null);
    }
  }, []);

  const playRef = useRef(play);
  playRef.current = play;

  const renderLive = useCallback(() => {
    const op = liveOpRef.current;
    const base = clipRef.current;
    if (!op || !base) return;
    try {
      const next = applyOp(base, op);
      const token = `live_${op.type}_${++liveSeqRef.current}`;
      liveClipRef.current = next;
      liveTokenRef.current = token;
      setLiveClip(next);
      setLiveToken(token);
      // La lecture reprend exactement là où l'horloge audio en est :
      // le temps affiché et le son restent alignés.
      if (playingRef.current) {
        const at = playerRef.current?.currentTime() ?? positionRef.current;
        positionRef.current = at;
        playRef.current(at, undefined, next, token);
      }
    } catch {
      /* effet impossible sur ce fichier : on garde l'audio d'origine */
    }
  }, []);

  const previewOp = useCallback(
    (op: AudioOp) => {
      const base = clipRef.current;
      if (!base) return;
      liveOpRef.current = op;
      if (liveTimerRef.current != null) window.clearTimeout(liveTimerRef.current);
      // Fichiers longs : on espace un peu les rendus pour rester fluide
      // sur mobile, sans jamais recalculer plus d'une fois par geste.
      const heavy = base.length > base.sampleRate * 240;
      liveTimerRef.current = window.setTimeout(
        () => {
          liveTimerRef.current = null;
          renderLive();
        },
        heavy ? 320 : 140,
      );
    },
    [renderLive],
  );

  // L'aperçu disparaît dès qu'un effet est appliqué, qu'on change d'outil
  // ou qu'on annule : la forme d'onde revient à l'état réel de l'audio.
  useEffect(() => {
    clearLive();
  }, [renderToken, tool, clearLive]);

  useEffect(() => () => clearPeakStores(), []);

  const doCopy = (alsoCut: boolean) => {
    const r = needSelection();
    if (!r || !clip) return;
    const { a, b } = rangeToSamples(clip, r);
    const piece = sliceClip(clip, a, b);
    const id = `clip_${opId()}`;
    storeClip(id, piece);
    setClipboardInfo({ id, duration: durationOf(piece) });
    if (alsoCut) pushOps({ id: opId(), type: "delete", range: r });
    toast.success(alsoCut ? "Sélection coupée" : "Sélection copiée");
  };
  const doPaste = () => {
    if (!clipboardInfo) {
      toast.error("Presse-papier audio vide.");
      return;
    }
    pushOp({ id: opId(), type: "insert", at: position, clipId: clipboardInfo.id });
  };
  const doTrim = (side: "start" | "end") => {
    if (!clip) return;
    if (position <= 0.005 || position >= duration - 0.005) {
      toast.error("Placez la tête de lecture à l'endroit du rognage.");
      return;
    }
    const range =
      side === "start" ? { start: 0, end: position } : { start: position, end: duration };
    pushOp({ id: opId(), type: "delete", range });
    setPosition(0);
  };

  /* ---------- diviser / fusionner ---------- */
  const doSplitKeep = (side: "left" | "right") => {
    if (position <= 0.005 || position >= duration - 0.005) {
      toast.error("Placez la tête de lecture au point de division.");
      return;
    }
    const range =
      side === "left" ? { start: 0, end: position } : { start: position, end: duration };
    pushOp({ id: opId(), type: "keep", range });
    setSelection(null);
    setPosition(0);
  };

  const exportSplitBoth = async () => {
    if (!clip) return;
    if (position <= 0.005 || position >= duration - 0.005) {
      toast.error("Placez la tête de lecture au point de division.");
      return;
    }
    setWorking("Export des deux parties…");
    try {
      const left = keepRange(clip, { start: 0, end: position });
      const right = keepRange(clip, { start: position, end: duration });
      const base = entry.name.replace(/\.[^.]+$/, "");
      const a = await saveEditedAudio({
        parent,
        entry,
        clip: left,
        mode: "new",
        name: `${base}-partie1.wav`,
      });
      const b = await saveEditedAudio({
        parent,
        entry,
        clip: right,
        mode: "new",
        name: `${base}-partie2.wav`,
      });
      toast.success(`Deux fichiers créés : ${a.name} et ${b.name}`);
    } catch (e) {
      toast.error(e instanceof AudioEditorError ? e.message : "Export impossible.");
    } finally {
      setWorking(null);
    }
  };

  const doMerge = async (other: FileEntry, absolute: string) => {
    setWorking("Analyse du fichier…");
    try {
      const piece = await loadAudioClipFromPath(absolute);
      const id = `clip_${opId()}`;
      storeClip(id, piece);
      pushOp({ id: opId(), type: "append", clipId: id });
      toast.success(`${other.name} ajouté à la fin`);
    } catch (e) {
      toast.error(e instanceof AudioEditorError ? e.message : "Fichier audio illisible.");
    } finally {
      setWorking(null);
    }
  };

  /* ---------- bibliothèque de sons ---------- */
  const makeSound = useCallback(
    (id: SoundId, seconds: number, gain: number) => {
      if (!clip) return null;
      return generateSound(id, clip.sampleRate, clip.channels.length, seconds, gain);
    },
    [clip],
  );

  const previewSound = useCallback(
    (id: SoundId, seconds: number, gain: number) => {
      const piece = makeSound(id, seconds, gain);
      if (!piece) return;
      stop();
      play(0, undefined, piece, `sound_${id}_${seconds}_${gain}`);
    },
    [makeSound, play, stop],
  );

  const insertSound = useCallback(
    (id: SoundId, seconds: number, gain: number, replaceSelection: boolean) => {
      const piece = makeSound(id, seconds, gain);
      if (!piece) return;
      const clipKey = `clip_${opId()}`;
      storeClip(clipKey, piece);
      const label = SOUNDS.find((s) => s.id === id)?.label ?? "Son";
      if (replaceSelection && selection && selection.end - selection.start > 0.005) {
        const at = Math.min(selection.start, selection.end);
        // Un seul lot : suppression + insertion s'annulent ensemble et se
        // composent dans le bon ordre (plus d'ajout en fin de piste).
        pushOps([
          { id: opId(), type: "delete", range: selection },
          { id: opId(), type: "insert", at, clipId: clipKey },
        ]);
        setSelection(null);
        toast.success(`${label} a remplacé la sélection`);
        return;
      }
      pushOp({ id: opId(), type: "insert", at: position, clipId: clipKey });
      toast.success(`${label} inséré à ${fmt(position, true)}`);
    },
    [makeSound, position, pushOp, pushOps, selection],
  );

  /* ---------- censure ---------- */
  const doCensor = useCallback(
    (params: { freq: number; gain: number; style: CensorStyle; mode: "replace" | "over" }) => {
      const r = selection && selection.end - selection.start > 0.005 ? selection : null;
      if (!r) {
        toast.error("Sélectionnez la portion à censurer.");
        return;
      }
      // Une seule opération : la durée est conservée, la sélection reste
      // valable et l'annulation se fait d'un seul geste.
      pushOps({
        id: opId(),
        type: "censor",
        range: { start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) },
        freq: params.freq,
        gain: params.gain,
        style: params.style,
        fade: CENSOR_DEFAULTS.fade,
        mode: params.mode,
      });
      toast.success("Bip de censure appliqué");
    },
    [pushOps, selection],
  );

  const previewCensor = useCallback(
    (params: { freq: number; gain: number; style: CensorStyle; mode: "replace" | "over" }) => {
      const r = selection && selection.end - selection.start > 0.005 ? selection : null;
      // Aperçu silencieux : sans sélection il n'y a rien à prévisualiser.
      if (!r) return;

      previewOp({
        id: opId(),
        type: "censor",
        range: { start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) },
        freq: params.freq,
        gain: params.gain,
        style: params.style,
        fade: CENSOR_DEFAULTS.fade,
        mode: params.mode,
      });
    },
    [previewOp, selection],
  );

  /* ---------- pistes additionnelles ---------- */
  const addTrack = useCallback(
    async (other: FileEntry, absolute: string) => {
      setWorking("Analyse du fichier…");
      try {
        const piece = await loadAudioClipFromPath(absolute);
        snapshotTracks();
        const id = trackId();
        setTracks((prev) => [
          ...prev,
          { id, name: other.name, clip: piece, offset: 0, gain: 1, muted: false, solo: false },
        ]);
        setSelectedLane(id);
        toast.success(`${other.name} ajouté comme nouvelle piste`);
      } catch (e) {
        toast.error(e instanceof AudioEditorError ? e.message : "Fichier audio illisible.");
      } finally {
        setWorking(null);
      }
    },
    [snapshotTracks],
  );

  const removeTrack = useCallback(
    (id: string) => {
      playerRef.current?.stop(false);
      setPlaying(false);
      snapshotTracks();
      setTracks((prev) => prev.filter((t) => t.id !== id));
      setSelectedLane((s) => (s === id ? "main" : s));
    },
    [snapshotTracks],
  );

  const patchTrack = useCallback((id: string, patch: Partial<ExtraTrack>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /* ---------- synchronisation multipiste (BPM manuel) ---------- */
  /**
   * Le tempo n'est jamais deviné : l'utilisateur saisit le BPM de chaque
   * piste. La synchronisation ré-étire réellement l'audio des pistes
   * cochées (WSOLA, hauteur préservée) depuis leur source d'origine, avec
   * le facteur exact `bpm_piste / bpm_maître`. La lecture partageant une
   * horloge audio unique, les pistes démarrent, avancent, se mettent en
   * pause et se repositionnent ensemble sans dérive possible.
   */
  const [syncTargets, setSyncTargets] = useState<LaneId[]>([]);
  const [syncing, setSyncing] = useState(false);

  /** BPM manuel d'une piste (jamais détecté). */
  const bpmOf = useCallback(
    (id: LaneId): number => {
      if (id === "main") return mainBpm;
      const t = tracks.find((x) => x.id === id);
      return t?.bpm ?? DEFAULT_BPM;
    },
    [mainBpm, tracks],
  );

  const bpmMap = useMemo(() => {
    const map: Record<string, number> = { main: mainBpm };
    for (const t of tracks) map[t.id] = t.bpm ?? DEFAULT_BPM;
    return map;
  }, [mainBpm, tracks]);

  /** Saisie manuelle du BPM : validée puis mémorisée dans l'historique. */
  const setLaneBpm = useCallback(
    (id: LaneId, value: number) => {
      const bpm = normalizeBpm(value);
      if (bpm == null) {
        toast.error(`Le BPM doit être compris entre ${MIN_BPM} et ${MAX_BPM}.`);
        return;
      }
      markStructural();
      if (id === "main") setMainBpm(bpm);
      else setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, bpm } : t)));
    },
    [markStructural],
  );

  // La piste maître supprimée retombe sur la piste principale.
  useEffect(() => {
    if (masterLane !== "main" && !tracks.some((t) => t.id === masterLane)) setMasterLane("main");
    setSyncTargets((prev) => prev.filter((id) => id === "main" || tracks.some((t) => t.id === id)));
  }, [tracks, masterLane]);

  const toggleSyncTarget = useCallback((id: LaneId) => {
    setSyncTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const runSync = useCallback(async () => {
    if (!clip || syncing) return;
    const lanes: LaneId[] = ["main", ...tracks.map((t) => t.id)];
    if (lanes.length < 2) {
      toast.error("Ajoutez au moins deux pistes pour synchroniser.");
      return;
    }
    const targets = syncTargets.filter((id) => id !== masterLane && lanes.includes(id));
    if (targets.length === 0) {
      toast.error("Cochez au moins une piste à synchroniser.");
      return;
    }
    const findTrack = (id: LaneId) => tracks.find((t) => t.id === id) ?? null;
    const sourceClipOf = (id: LaneId): AudioClip | null => {
      if (id === "main") return clip;
      const t = findTrack(id);
      return t ? (t.baseClip ?? t.clip) : null;
    };
    const masterBpm = normalizeBpm(bpmOf(masterLane));
    if (masterBpm == null) {
      toast.error("Renseignez d'abord le BPM de la piste maître.");
      return;
    }
    const masterClip = sourceClipOf(masterLane);
    if (!masterClip || masterClip.length === 0) {
      toast.error("La piste maître est vide.");
      return;
    }

    setSyncing(true);
    setWorking("Alignement des pistes…");
    try {
      const inputs: SyncInput[] = [];
      for (const id of targets) {
        const c = sourceClipOf(id);
        if (!c || c.length === 0) continue;
        const bpm = normalizeBpm(bpmOf(id));
        if (bpm == null) continue;
        const t = findTrack(id);
        inputs.push({ id, offset: id === "main" ? 0 : (t?.baseOffset ?? t?.offset ?? 0), bpm });
      }
      if (inputs.length === 0) {
        toast.error("Renseignez le BPM des pistes à synchroniser.");
        return;
      }
      const plans = planSync({ id: masterLane, offset: 0, bpm: masterBpm }, inputs);
      const byId = new Map(plans.map((p) => [p.id, p]));

      await new Promise((r) => setTimeout(r, 0));

      const nextTracks = tracks.map((t) => {
        const p = byId.get(t.id);
        if (!p) return t;
        const base = t.baseClip ?? t.clip;
        const baseOffset = t.baseOffset ?? t.offset;
        const stretched = Math.abs(p.ratio - 1) < 0.0005 ? base : stretchWsola(base, p.ratio);
        return {
          ...t,
          baseClip: base,
          baseOffset,
          clip: stretched,
          offset: baseOffset,
          bpm: p.sourceBpm,
          sync: {
            sourceBpm: p.sourceBpm,
            targetBpm: p.targetBpm,
            ratio: p.ratio,
            masterId: masterLane,
          },
        } satisfies ExtraTrack;
      });

      playerRef.current?.stop(false);
      setPlaying(false);
      markStructural();
      setTracks(nextTracks);

      // Piste principale synchronisée : vrai changement de tempo, via une
      // opération « vitesse » à hauteur préservée (donc annulable).
      const mainPlan = byId.get("main");
      if (mainPlan && Math.abs(mainPlan.ratio - 1) > 0.0005) {
        pushOps({ id: opId(), type: "speed", factor: 1 / mainPlan.ratio, keepPitch: true });
        setMainBpm(mainPlan.targetBpm);
      }
      playerRef.current?.invalidate();

      toast.success(`${plans.length} piste(s) synchronisée(s) à ${masterBpm} BPM.`);
    } catch {
      toast.error("Synchronisation impossible sur ces pistes.");
    } finally {
      setWorking(null);
      setSyncing(false);
    }
  }, [bpmOf, clip, markStructural, masterLane, pushOps, syncTargets, syncing, tracks]);

  /** Rend leur indépendance aux pistes synchronisées (audio d'origine). */
  const clearSync = useCallback(() => {
    playerRef.current?.stop(false);
    setPlaying(false);
    markStructural();
    setTracks((prev) =>
      prev.map((t) =>
        t.sync
          ? {
              ...t,
              clip: t.baseClip ?? t.clip,
              offset: t.baseOffset ?? t.offset,
              sync: undefined,
              baseClip: undefined,
              baseOffset: undefined,
            }
          : t,
      ),
    );
    playerRef.current?.invalidate();
    toast.success("Pistes désynchronisées.");
  }, [markStructural]);

  /**
   * Un BPM corrigé après coup ne laisse jamais une piste mal alignée :
   * dès que le tempo saisi (piste ou maître) ne correspond plus au facteur
   * appliqué, l'audio est ré-étiré depuis la source. Regroupé par une
   * courte pause pour ne pas recalculer à chaque frappe.
   */
  useEffect(() => {
    const stale = tracks.filter((t) => {
      if (!t.sync) return false;
      const src = t.bpm ?? DEFAULT_BPM;
      const target = bpmMap[t.sync.masterId] ?? t.sync.targetBpm;
      return (
        Math.abs(src - t.sync.sourceBpm) > 0.001 || Math.abs(target - t.sync.targetBpm) > 0.001
      );
    });
    if (stale.length === 0) return;
    const timer = window.setTimeout(() => {
      const ids = new Set(stale.map((t) => t.id));
      setTracks((prev) =>
        prev.map((t) => {
          if (!ids.has(t.id) || !t.sync) return t;
          const src = normalizeBpm(t.bpm ?? DEFAULT_BPM);
          const target = normalizeBpm(bpmMap[t.sync.masterId] ?? t.sync.targetBpm);
          if (src == null || target == null) return t;
          const base = t.baseClip ?? t.clip;
          const baseOffset = t.baseOffset ?? t.offset;
          const ratio = src / target;
          const safe = Number.isFinite(ratio) && ratio > 0.1 && ratio < 10 ? ratio : 1;
          return {
            ...t,
            baseClip: base,
            baseOffset,
            clip: Math.abs(safe - 1) < 0.0005 ? base : stretchWsola(base, safe),
            offset: baseOffset,
            sync: { ...t.sync, sourceBpm: src, targetBpm: target, ratio: safe },
          };
        }),
      );
      playerRef.current?.invalidate();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [bpmMap, tracks]);

  const syncedCount = tracks.filter((t) => t.sync).length;

  /** Coupe / supprime / rend muette la portion sélectionnée sur une piste. */
  const editLane = useCallback(
    (id: LaneId, edit: "delete" | "silence" | "keep") => {
      const r = selection && Math.abs(selection.end - selection.start) > 0.005 ? selection : null;
      if (!r) {
        toast.error("Sélectionnez d'abord une portion.");
        return;
      }
      if (id === "main") {
        pushOp({
          id: opId(),
          type: edit === "keep" ? "keep" : edit === "delete" ? "delete" : "silence",
          range: { start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) },
        });
        if (edit !== "silence") setSelection(null);
        return;
      }
      snapshotTracks();
      setTracks((prev) => prev.map((t) => (t.id === id ? editTrack(t, r, edit) : t)));
      playerRef.current?.invalidate();
      tick();
    },
    [pushOp, selection, snapshotTracks],
  );

  /** Mixage réel de toutes les pistes — utilisé pour l'export. */
  const mixedClip = useCallback((): AudioClip | null => {
    if (!clip) return null;
    if (tracks.length === 0) return mainMuted ? clip : clip;
    return mixTracks([
      { clip, offset: 0, gain: 1, muted: mainMuted },
      ...tracks.map((t) => ({
        clip: t.clip,
        offset: t.offset,
        gain: t.gain,
        muted: !isAudible(t, tracks),
      })),
    ]);
  }, [clip, mainMuted, tracks]);

  /* ---------- enregistrement ---------- */
  const openSave = () => {
    setSaveName(suggestedAudioName(entry.name, exportFormat));
    setSaveOpen(true);
  };

  const chooseFormat = (f: AudioExportFormat) => {
    setExportFormat(f);
    setSaveName((n) => withFormatExtension(n || entry.name, f));
    tick();
  };

  const persist = async (mode: "new" | "replace", name?: string) => {
    const out = mixedClip();
    if (!out) return;
    setWorking(mode === "replace" ? "Remplacement…" : "Enregistrement…");
    setExportProgress(exportFormat === "mp3" ? 0 : null);
    try {
      const res = await saveEditedAudio({
        parent,
        entry,
        clip: out,
        mode,
        name,
        format: exportFormat,
        bitrate,
        mono: exportMono,
        onProgress: (r) => setExportProgress(r),
      });
      setSavedCursor(cursor);
      setSaveOpen(false);
      setReplaceOpen(false);
      toast.success(`${res.name} enregistré (${formatSize(res.size)})`);
    } catch (e) {
      toast.error(e instanceof AudioEditorError ? e.message : "Export impossible.");
    } finally {
      setWorking(null);
      setExportProgress(null);
    }
  };

  /* ---------- sortie ---------- */
  const requestExit = useCallback(() => {
    stop();
    if (dirty) {
      setExitOpen(true);
      return true;
    }
    onExit();
    return true;
  }, [dirty, onExit, stop]);

  useBackHandler(true, requestExit, BACK_PRIORITY.page + 1);

  /* ---------- rendus d'état ---------- */
  if (loadError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <VolumeX className="h-10 w-10 text-muted-foreground" />
        <p className="text-[15px] font-semibold text-foreground">Éditeur audio indisponible</p>
        <p className="text-[13px] text-muted-foreground">{loadError}</p>
        <PrimaryButton onClick={onExit}>Retour</PrimaryButton>
      </div>
    );
  }

  if (!clip || !source) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-[13px] text-muted-foreground">Décodage de l'audio…</p>
      </div>
    );
  }

  const selDuration = selection ? Math.abs(selection.end - selection.start) : 0;
  const format = (entry.ext ?? entry.name.split(".").pop() ?? "").toUpperCase();

  return (
    <div className="flex h-dvh flex-col bg-background pt-safe">
      {/* Barre supérieure */}
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={requestExit}
          aria-label="Retour"
          className="rounded-xl border border-border bg-surface p-2 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-foreground">{entry.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {format || "AUDIO"} · {fmt(duration)} · {clip.sampleRate} Hz ·{" "}
            {clip.channels.length > 1 ? "stéréo" : "mono"}
            {dirty ? " · non enregistré" : ""}
          </p>
        </div>
        <IconBtn label="Annuler" onClick={undo} disabled={!canUndo} icon={Undo2} />
        <IconBtn label="Rétablir" onClick={redo} disabled={!canRedo} icon={Redo2} />
        <button
          type="button"
          onClick={openSave}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-[13px] font-semibold text-primary-foreground active:scale-95"
        >
          <Save className="h-4 w-4" /> Enregistrer
        </button>
      </header>

      {/* Forme d'onde — occupe tout l'espace disponible */}
      <div ref={waveBoxRef} className="relative min-h-[180px] flex-1 px-3">
        <Waveform
          clip={liveClip ?? clip}
          renderToken={liveToken ?? renderToken}
          view={view}
          liveViewRef={liveViewRef}
          selection={selection}
          position={position}
          positionRef={positionRef}
          getTime={getTime}
          playing={playing}
          follow
          height={waveH || undefined}
          secondary={
            selectedTrack
              ? {
                  clip: selectedTrack.clip,
                  token: `${selectedTrack.id}_${selectedTrack.clip.length}`,
                  offset: selectedTrack.offset,
                  muted: !isAudible(selectedTrack, tracks),
                  label: selectedTrack.name,
                }
              : null
          }
          onViewChange={setView}
          onSelectionChange={setSelection}
          onSeek={(t) => {
            // La position part d'abord dans la ref : l'audio et le tracé
            // repartent du nouveau point dans la même frame.
            positionRef.current = t;
            setPosition(t);
            if (playing) play(t);
          }}
          onSeekPlay={(t) => {
            positionRef.current = t;
            setPosition(t);
            play(t);
          }}
        />
        {busy ? (
          <span className="pointer-events-none absolute right-6 top-4 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> traitement
          </span>
        ) : null}
      </div>

      {/* Infos temporelles + zoom */}
      <div className="flex items-center gap-2 px-4 py-2 text-[11px] text-muted-foreground">
        <TimeReadout positionRef={positionRef} getTime={getTime} playing={playing} />

        <span>/ {fmt(duration, true)}</span>
        {selection ? (
          <span className="rounded-full bg-primary-softer px-2 py-0.5 font-mono text-primary">
            {fmt(Math.min(selection.start, selection.end), true)} →{" "}
            {fmt(Math.max(selection.start, selection.end), true)} ({fmt(selDuration, true)})
          </span>
        ) : null}
        {tracks.length > 0 ? (
          <span className="rounded-full border border-border px-2 py-0.5">
            {selectedTrack ? selectedTrack.name : "Piste principale"}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <IconBtn label="Dézoomer" onClick={() => zoom(2)} icon={ZoomOut} small />
          <IconBtn label="Zoomer" onClick={() => zoom(0.5)} icon={ZoomIn} small />
          <button
            type="button"
            onClick={selection ? zoomSelection : zoomAll}
            className="rounded-lg border border-border px-2 py-1 text-[11px]"
          >
            {selection ? "Sélection" : "Tout"}
          </button>
        </span>
      </div>

      {/* Transport */}
      <div className="flex items-center justify-center gap-3 px-4 pb-2">
        <IconBtn label="Reculer" onClick={() => nudge(-5)} icon={Rewind} />
        <button
          type="button"
          onPointerDown={(e) => {
            // Réaction au contact : aucune attente du `click` (≈100 ms sur
            // Android). L'état visuel, l'audio et le curseur basculent
            // ensemble, dès l'appui.
            e.preventDefault();
            togglePlay();
          }}
          aria-label={playing ? "Pause" : "Lecture"}
          className="inline-flex h-14 w-14 touch-manipulation items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition-transform duration-75 active:scale-95"
        >
          {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
        </button>
        <IconBtn label="Avancer" onClick={() => nudge(5)} icon={FastForward} />
        <button
          type="button"
          onClick={playOriginal}
          className="ml-2 rounded-xl border border-border px-3 py-2 text-[12px] text-muted-foreground active:scale-95"
        >
          Original
        </button>
      </div>

      {/* Panneau des pistes */}
      {tool === "tracks" ? (
        <TrackLanes
          mainClip={clip}
          mainName={entry.name}
          mainToken={renderToken || "base"}
          mainMuted={mainMuted}
          tracks={tracks}
          total={Math.max(0.01, totalDuration)}
          selection={selection}
          selected={selectedLane}
          positionRef={positionRef}
          getTime={getTime}
          playing={playing}
          onSelect={setSelectedLane}
          onSeek={(t) => {
            positionRef.current = t;
            setPosition(t);
            if (playing) play(t);
          }}
          onMoveTrack={(id, offset) => patchTrack(id, { offset })}
          onMoveCommit={snapshotTracks}
          onToggleMute={(id) => {
            if (id === "main") {
              setMainMuted((m) => !m);
              return;
            }
            setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)));
          }}
          onToggleSolo={(id) =>
            setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, solo: !t.solo } : t)))
          }
          onRemove={removeTrack}
          onGain={(id, gain) => patchTrack(id, { gain })}
          onGainCommit={snapshotTracks}
          canUndo={canUndo}
          onUndo={undo}
          onEditTrack={editLane}
          onAdd={() => setTrackPickerOpen(true)}
          master={masterLane}
          onMaster={setMasterLane}
          syncTargets={syncTargets}
          onToggleSyncTarget={toggleSyncTarget}
          onSync={() => void runSync()}
          onClearSync={clearSync}
          syncing={syncing}
          bpm={bpmMap}
          onBpm={setLaneBpm}
          syncedCount={syncedCount}
        />
      ) : null}

      {/* Panneau d'outil */}
      {tool && tool !== "tracks" ? (
        <ToolPanel
          tool={tool}
          duration={duration}
          selection={selection}
          hasClipboard={clipboardInfo != null}
          onClose={() => setTool(null)}
          onApply={pushOp}
          onCut={doCut}
          onDelete={doDelete}
          onSilence={doSilence}
          onReverse={doReverse}
          onCopy={doCopy}
          onPaste={doPaste}
          onTrim={doTrim}
          onSelectAll={() => setSelection({ start: 0, end: duration })}
          onClearSelection={() => setSelection(null)}
          onPreviewSelection={() => (selection ? play(selection.start, selection.end) : play(0))}
          onSplitKeep={doSplitKeep}
          onSplitBoth={exportSplitBoth}
          onMerge={() => setMergeOpen(true)}
          onPreview={previewOp}
          onPreviewSound={previewSound}
          onInsertSound={insertSound}
          onCensor={doCensor}
          onPreviewCensor={previewCensor}
          onOpenTracks={() => setTool("tracks")}
        />
      ) : null}

      {/* Barre d'outils */}
      <nav
        className="gf-photo-scroll flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-1"
        aria-label="Outils d'édition audio"
      >
        {TOOLS.map(({ id, label, icon: Icon }) => {
          const active = tool === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                tick();
                setTool(active ? null : id);
              }}
              className={`flex min-w-[64px] flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/50 text-muted-foreground"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </button>
          );
        })}
      </nav>

      {/* Enregistrement */}
      <BottomSheet
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Enregistrer l'audio"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={() => setSaveOpen(false)}>
              Annuler
            </PrimaryButton>
            <PrimaryButton onClick={() => persist("new", saveName)} disabled={working != null}>
              Enregistrer sous
            </PrimaryButton>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-muted-foreground">
          L'original est conservé. Choisissez le format et la qualité de l'export.
        </p>
        <div className="mb-3 flex gap-2" role="group" aria-label="Format d'export">
          {(["mp3", "wav"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => chooseFormat(f)}
              aria-pressed={exportFormat === f}
              className={`flex-1 rounded-2xl border px-3 py-2.5 text-left text-[13px] transition-colors ${
                exportFormat === f
                  ? "border-primary bg-primary-softer text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              <span className="block font-semibold">{f.toUpperCase()}</span>
              <span className="block text-[11px] opacity-80">
                {f === "mp3" ? "compact, universel" : "qualité intégrale"}
              </span>
            </button>
          ))}
        </div>
        {exportFormat === "mp3" ? (
          <div className="mb-3 space-y-2">
            <p className="text-[12px] font-medium text-foreground">Débit</p>
            <div className="flex flex-wrap gap-1.5">
              {MP3_BITRATES.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => {
                    setBitrate(b);
                    tick();
                  }}
                  aria-pressed={bitrate === b}
                  className={`rounded-full border px-3 py-1.5 text-[12px] ${
                    bitrate === b
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {b} kbps
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={exportMono}
                onChange={(e) => setExportMono(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Export mono (fichier deux fois plus léger)
            </label>
          </div>
        ) : null}
        <TextField value={saveName} onChange={setSaveName} placeholder="Nom du fichier" />
        {exportProgress != null ? (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.round(exportProgress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Encodage MP3 — {Math.round(exportProgress * 100)} %
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setReplaceOpen(true)}
          className="mt-4 w-full rounded-2xl border border-destructive/40 px-4 py-3 text-left text-[13px] text-destructive"
        >
          Remplacer le fichier original
        </button>
      </BottomSheet>

      <BottomSheet
        open={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        title="Remplacer l'original ?"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={() => setReplaceOpen(false)}>
              Annuler
            </PrimaryButton>
            <PrimaryButton
              variant="danger"
              onClick={() => persist("replace")}
              disabled={working != null}
            >
              Remplacer
            </PrimaryButton>
          </>
        }
      >
        <p className="text-[14px] text-muted-foreground">
          Le fichier « {entry.name} » sera définitivement remplacé par la version éditée (
          {exportFormat.toUpperCase()}). Cette action est irréversible.
        </p>
      </BottomSheet>

      {/* Sortie avec modifications */}
      <BottomSheet
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Modifications non enregistrées"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={() => setExitOpen(false)}>
              Continuer l'édition
            </PrimaryButton>
            <PrimaryButton
              onClick={() => {
                setExitOpen(false);
                openSave();
              }}
            >
              Enregistrer
            </PrimaryButton>
          </>
        }
      >
        <p className="text-[14px] text-muted-foreground">
          Vos modifications ne sont pas encore exportées.
        </p>
        <button
          type="button"
          onClick={() => {
            setExitOpen(false);
            onExit();
          }}
          className="mt-4 w-full rounded-2xl border border-border px-4 py-3 text-left text-[13px] text-destructive"
        >
          Quitter sans enregistrer
        </button>
      </BottomSheet>

      {trackPickerOpen ? (
        <MergePicker
          title="Ajouter une piste audio"
          onCancel={() => setTrackPickerOpen(false)}
          onPick={(e, abs) => {
            setTrackPickerOpen(false);
            void addTrack(e, abs);
          }}
        />
      ) : null}

      {mergeOpen ? (
        <MergePicker
          onCancel={() => setMergeOpen(false)}
          onPick={(e, abs) => {
            setMergeOpen(false);
            void doMerge(e, abs);
          }}
        />
      ) : null}

      {working ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/70">
          <div className="flex items-center gap-3 rounded-2xl bg-surface px-5 py-4 shadow-soft">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-[13px] text-foreground">{working}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- pièces */

function IconBtn({
  label,
  icon: Icon,
  onClick,
  disabled,
  small,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border border-border bg-surface text-muted-foreground transition-opacity active:scale-95 disabled:opacity-35 ${
        small ? "p-1.5" : "p-2.5"
      }`}
    >
      <Icon className={small ? "h-3.5 w-3.5" : "h-5 w-5"} />
    </button>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Action({
  children,
  onClick,
  variant = "ghost",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "ghost" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-xl px-3 text-[13px] font-medium active:scale-95 ${
        variant === "primary"
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-surface text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  const last = useRef(value);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">
          {value.toFixed(step < 1 ? 2 : 0)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Math.abs(v - last.current) >= step) {
            last.current = v;
            tick();
          }
          onChange(v);
        }}
        className="h-9 w-full accent-primary"
      />
    </div>
  );
}

/** Réglages rapides d'un effet : un appui, tous les curseurs positionnés. */
function Presets({ items }: { items: { label: string; apply: () => void }[] }) {
  return (
    <div className="gf-photo-scroll flex gap-1.5 overflow-x-auto pb-1">
      {items.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => {
            tick();
            p.apply();
          }}
          className="shrink-0 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-[12px] text-foreground active:scale-95"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Bouton « Appliquer » commun à tous les effets. Le rendu de l'effet suit
 * les réglages en temps réel (forme d'onde et lecture), il n'y a donc plus
 * d'aperçu à déclencher à la main.
 */
function EffectActions({
  build,
  label = "Appliquer",
  onApply,
  onPreview,
}: {
  build: () => AudioOp;
  label?: string;
  onApply: (op: AudioOp) => void;
  onPreview: (op: AudioOp) => void;
}) {
  // Aperçu temps réel : dès qu'un réglage change, l'effet est appliqué au
  // rendu provisoire (forme d'onde + son en cours), sans bouton « Écouter ».
  const op = build();
  const { id: _id, ...rest } = op as AudioOp & { id: string };
  const signature = JSON.stringify(rest);
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const first = useRef(true);
  useEffect(() => {
    // À l'ouverture du panneau, rien à prévisualiser : les réglages sont
    // encore ceux d'origine.
    if (first.current) {
      first.current = false;
      return;
    }
    previewRef.current(build());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <Row>
      <Action variant="primary" onClick={() => onApply(build())}>
        <Check className="mr-1 inline h-4 w-4" /> {label}
      </Action>
    </Row>
  );
}

function ToolPanel(props: {
  tool: ToolId;
  duration: number;
  selection: TimeRange | null;
  hasClipboard: boolean;
  onClose: () => void;
  onApply: (op: AudioOp) => void;
  onCut: () => void;
  onDelete: () => void;
  onSilence: () => void;
  onReverse: () => void;
  onCopy: (cut: boolean) => void;
  onPaste: () => void;
  onTrim: (side: "start" | "end") => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onPreviewSelection: () => void;
  onSplitKeep: (side: "left" | "right") => void;
  onSplitBoth: () => void;
  onMerge: () => void;
  /** Écoute l'effet réglé sans l'ajouter à l'historique. */
  onPreview: (op: AudioOp) => void;
  onPreviewSound: (id: SoundId, seconds: number, gain: number) => void;
  onInsertSound: (id: SoundId, seconds: number, gain: number, replaceSelection: boolean) => void;
  onCensor: (p: {
    freq: number;
    gain: number;
    style: CensorStyle;
    mode: "replace" | "over";
  }) => void;
  onPreviewCensor: (p: {
    freq: number;
    gain: number;
    style: CensorStyle;
    mode: "replace" | "over";
  }) => void;
  onOpenTracks: () => void;
}) {
  const { tool, duration, selection } = props;
  const [db, setDb] = useState(0);
  const [fadeIn, setFadeIn] = useState(1.5);
  const [fadeOut, setFadeOut] = useState(1.5);
  const [speed, setSpeed] = useState(1);
  const [keepPitch, setKeepPitch] = useState(true);
  const [semitones, setSemitones] = useState(0);
  const [peakDb, setPeakDb] = useState(-1);

  // Effets
  const [echoDelay, setEchoDelay] = useState(0.28);
  const [echoDecay, setEchoDecay] = useState(0.45);
  const [echoRepeats, setEchoRepeats] = useState(4);
  const [echoMix, setEchoMix] = useState(0.6);
  const [revSize, setRevSize] = useState(0.5);
  const [revDamp, setRevDamp] = useState(0.5);
  const [revMix, setRevMix] = useState(0.35);
  const [lowDb, setLowDb] = useState(0);
  const [midDb, setMidDb] = useState(0);
  const [highDb, setHighDb] = useState(0);
  const [filterMode, setFilterMode] = useState<"low" | "high">("low");
  const [cutoff, setCutoff] = useState(2000);
  const [resonance, setResonance] = useState(0.9);
  const [thresholdDb, setThresholdDb] = useState(-18);
  const [ratio, setRatio] = useState(3);
  const [attackMs, setAttackMs] = useState(10);
  const [releaseMs, setReleaseMs] = useState(150);
  const [makeupDb, setMakeupDb] = useState(2);
  const [gateDb, setGateDb] = useState(-45);
  const [driveDb, setDriveDb] = useState(6);
  const [satMix, setSatMix] = useState(0.6);
  const [width, setWidth] = useState(1);
  const [soundId, setSoundId] = useState<SoundId>("bip");
  const [soundSeconds, setSoundSeconds] = useState(
    SOUNDS.find((s) => s.id === "bip")?.duration ?? 0.12,
  );
  const [soundGain, setSoundGain] = useState(0.7);
  const [censorFreq, setCensorFreq] = useState(CENSOR_DEFAULTS.freq);
  const [censorGain, setCensorGain] = useState(CENSOR_DEFAULTS.gain);
  const [censorStyle, setCensorStyle] = useState<CensorStyle>("continu");
  const [censorMode, setCensorMode] = useState<"replace" | "over">("replace");

  const range = selection && selection.end - selection.start > 0.005 ? selection : undefined;
  const maxFade = Math.max(0.2, Math.min(20, duration));

  // Censure : l'aperçu suit les réglages en direct, sans bouton dédié.
  const censorPreview = props.onPreviewCensor;
  useEffect(() => {
    if (tool !== "censor") return;
    censorPreview({ freq: censorFreq, gain: censorGain, style: censorStyle, mode: censorMode });
  }, [tool, censorFreq, censorGain, censorStyle, censorMode, censorPreview]);

  return (
    <section className="mx-3 mb-2 rounded-2xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground">
          {TOOLS.find((t) => t.id === tool)?.label}
        </p>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Fermer l'outil"
          className="rounded-lg p-1 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {tool === "select" ? (
        <Row>
          <Action onClick={props.onSelectAll}>Tout sélectionner</Action>
          <Action onClick={props.onClearSelection}>Effacer</Action>
          <Action onClick={props.onPreviewSelection}>Écouter la sélection</Action>
        </Row>
      ) : null}

      {tool === "cut" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            Conserve uniquement la sélection, ou rogne depuis la tête de lecture.
          </p>
          <Row>
            <Action variant="primary" onClick={props.onCut}>
              Garder la sélection
            </Action>
            <Action onClick={() => props.onTrim("start")}>Rogner le début</Action>
            <Action onClick={() => props.onTrim("end")}>Rogner la fin</Action>
          </Row>
        </div>
      ) : null}

      {tool === "delete" ? (
        <Row>
          <Action variant="primary" onClick={props.onDelete}>
            Supprimer la sélection
          </Action>
          <Action onClick={props.onPreviewSelection}>Écouter avant</Action>
        </Row>
      ) : null}

      {tool === "copy" ? (
        <Row>
          <Action variant="primary" onClick={() => props.onCopy(false)}>
            Copier
          </Action>
          <Action onClick={() => props.onCopy(true)}>Couper</Action>
        </Row>
      ) : null}

      {tool === "paste" ? (
        <Row>
          <Action variant="primary" onClick={props.onPaste}>
            Coller à la tête de lecture
          </Action>
          {!props.hasClipboard ? (
            <span className="text-[12px] text-muted-foreground">Presse-papier vide</span>
          ) : null}
        </Row>
      ) : null}

      {tool === "volume" ? (
        <div className="space-y-2">
          <ParamSlider
            label={range ? "Gain sur la sélection" : "Gain global"}
            value={db}
            min={-24}
            max={24}
            step={0.5}
            suffix=" dB"
            onChange={setDb}
          />
          <EffectActions
            build={() => ({ id: opId(), type: "gain" as const, db, range })}
            {...props}
          />
        </div>
      ) : null}

      {tool === "fade" ? (
        <div className="space-y-2">
          <ParamSlider
            label="Fondu entrant"
            value={fadeIn}
            min={0.1}
            max={maxFade}
            step={0.1}
            suffix=" s"
            onChange={setFadeIn}
          />
          <ParamSlider
            label="Fondu sortant"
            value={fadeOut}
            min={0.1}
            max={maxFade}
            step={0.1}
            suffix=" s"
            onChange={setFadeOut}
          />
          <Row>
            <Action
              variant="primary"
              onClick={() => props.onApply({ id: opId(), type: "fadeIn", duration: fadeIn })}
            >
              Appliquer l'entrée
            </Action>
            <Action
              onClick={() => props.onApply({ id: opId(), type: "fadeOut", duration: fadeOut })}
            >
              Appliquer la sortie
            </Action>
          </Row>
        </div>
      ) : null}

      {tool === "speed" ? (
        <div className="space-y-2">
          <ParamSlider
            label="Vitesse"
            value={speed}
            min={0.5}
            max={2}
            step={0.05}
            suffix="×"
            onChange={setSpeed}
          />
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={keepPitch}
              onChange={(e) => setKeepPitch(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Conserver la hauteur du son
          </label>
          <Row>
            <Action
              variant="primary"
              onClick={() => props.onApply({ id: opId(), type: "speed", factor: speed, keepPitch })}
            >
              Appliquer
            </Action>
          </Row>
        </div>
      ) : null}

      {tool === "pitch" ? (
        <div className="space-y-2">
          <ParamSlider
            label="Hauteur"
            value={semitones}
            min={-12}
            max={12}
            step={1}
            suffix=" demi-tons"
            onChange={setSemitones}
          />
          <Row>
            <Action
              variant="primary"
              onClick={() => props.onApply({ id: opId(), type: "pitch", semitones })}
            >
              Appliquer
            </Action>
          </Row>
        </div>
      ) : null}

      {tool === "normalize" ? (
        <div className="space-y-2">
          <ParamSlider
            label="Niveau crête cible"
            value={peakDb}
            min={-12}
            max={0}
            step={0.5}
            suffix=" dBFS"
            onChange={setPeakDb}
          />
          <Row>
            <Action
              variant="primary"
              onClick={() => props.onApply({ id: opId(), type: "normalize", peakDb })}
            >
              Normaliser
            </Action>
          </Row>
        </div>
      ) : null}

      {tool === "silence" ? (
        <Row>
          <Action variant="primary" onClick={props.onSilence}>
            Remplacer la sélection par du silence
          </Action>
        </Row>
      ) : null}

      {tool === "reverse" ? (
        <Row>
          <Action variant="primary" onClick={props.onReverse}>
            {range ? "Inverser la sélection" : "Inverser tout"}
          </Action>
        </Row>
      ) : null}

      {tool === "echo" ? (
        <div className="space-y-2">
          <Presets
            items={[
              {
                label: "Slap",
                apply: () => (
                  setEchoDelay(0.12),
                  setEchoDecay(0.3),
                  setEchoRepeats(2),
                  setEchoMix(0.5)
                ),
              },
              {
                label: "Salle",
                apply: () => (
                  setEchoDelay(0.28),
                  setEchoDecay(0.45),
                  setEchoRepeats(4),
                  setEchoMix(0.6)
                ),
              },
              {
                label: "Canyon",
                apply: () => (
                  setEchoDelay(0.6),
                  setEchoDecay(0.62),
                  setEchoRepeats(8),
                  setEchoMix(0.75)
                ),
              },
            ]}
          />
          <ParamSlider
            label="Retard"
            value={echoDelay}
            min={0.02}
            max={1.2}
            step={0.01}
            suffix=" s"
            onChange={setEchoDelay}
          />
          <ParamSlider
            label="Décroissance"
            value={echoDecay}
            min={0.1}
            max={0.85}
            step={0.05}
            suffix=""
            onChange={setEchoDecay}
          />
          <ParamSlider
            label="Répétitions"
            value={echoRepeats}
            min={1}
            max={10}
            step={1}
            suffix=""
            onChange={setEchoRepeats}
          />
          <ParamSlider
            label="Dosage"
            value={echoMix}
            min={0.1}
            max={1}
            step={0.05}
            suffix=""
            onChange={setEchoMix}
          />
          <EffectActions
            build={() => ({
              id: opId(),
              type: "echo" as const,
              range,
              delay: echoDelay,
              decay: echoDecay,
              repeats: echoRepeats,
              mix: echoMix,
            })}
            {...props}
          />
        </div>
      ) : null}

      {tool === "reverb" ? (
        <div className="space-y-2">
          <Presets
            items={[
              {
                label: "Petite pièce",
                apply: () => (setRevSize(0.25), setRevDamp(0.6), setRevMix(0.25)),
              },
              { label: "Studio", apply: () => (setRevSize(0.5), setRevDamp(0.5), setRevMix(0.35)) },
              {
                label: "Cathédrale",
                apply: () => (setRevSize(0.95), setRevDamp(0.25), setRevMix(0.55)),
              },
            ]}
          />
          <ParamSlider
            label="Taille de la pièce"
            value={revSize}
            min={0.05}
            max={1}
            step={0.05}
            suffix=""
            onChange={setRevSize}
          />
          <ParamSlider
            label="Amortissement"
            value={revDamp}
            min={0}
            max={0.95}
            step={0.05}
            suffix=""
            onChange={setRevDamp}
          />
          <ParamSlider
            label="Dosage"
            value={revMix}
            min={0.05}
            max={1}
            step={0.05}
            suffix=""
            onChange={setRevMix}
          />
          <EffectActions
            build={() => ({
              id: opId(),
              type: "reverb" as const,
              range,
              size: revSize,
              damping: revDamp,
              mix: revMix,
            })}
            {...props}
          />
        </div>
      ) : null}

      {tool === "eq" ? (
        <div className="space-y-2">
          <Presets
            items={[
              { label: "Voix claire", apply: () => (setLowDb(-3), setMidDb(4), setHighDb(3)) },
              { label: "Basses +", apply: () => (setLowDb(6), setMidDb(-1), setHighDb(0)) },
              { label: "Neutre", apply: () => (setLowDb(0), setMidDb(0), setHighDb(0)) },
            ]}
          />
          <ParamSlider
            label="Graves"
            value={lowDb}
            min={-15}
            max={15}
            step={0.5}
            suffix=" dB"
            onChange={setLowDb}
          />
          <ParamSlider
            label="Médiums"
            value={midDb}
            min={-15}
            max={15}
            step={0.5}
            suffix=" dB"
            onChange={setMidDb}
          />
          <ParamSlider
            label="Aigus"
            value={highDb}
            min={-15}
            max={15}
            step={0.5}
            suffix=" dB"
            onChange={setHighDb}
          />
          <EffectActions
            build={() => ({ id: opId(), type: "eq" as const, range, lowDb, midDb, highDb })}
            {...props}
          />
        </div>
      ) : null}

      {tool === "filter" ? (
        <div className="space-y-2">
          <Row>
            <Action
              variant={filterMode === "low" ? "primary" : "ghost"}
              onClick={() => setFilterMode("low")}
            >
              Passe-bas
            </Action>
            <Action
              variant={filterMode === "high" ? "primary" : "ghost"}
              onClick={() => setFilterMode("high")}
            >
              Passe-haut
            </Action>
          </Row>
          <ParamSlider
            label="Fréquence de coupure"
            value={cutoff}
            min={80}
            max={12000}
            step={20}
            suffix=" Hz"
            onChange={setCutoff}
          />
          <ParamSlider
            label="Résonance"
            value={resonance}
            min={0.4}
            max={6}
            step={0.1}
            suffix=""
            onChange={setResonance}
          />
          <EffectActions
            build={() => ({
              id: opId(),
              type: "filter" as const,
              range,
              mode: filterMode,
              cutoff,
              q: resonance,
            })}
            {...props}
          />
        </div>
      ) : null}

      {tool === "dynamics" ? (
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Compresseur : réduit les écarts de niveau. Porte : supprime le souffle des passages
            silencieux.
          </p>
          <Presets
            items={[
              {
                label: "Voix",
                apply: () => (
                  setThresholdDb(-20),
                  setRatio(4),
                  setAttackMs(8),
                  setReleaseMs(120),
                  setMakeupDb(3)
                ),
              },
              {
                label: "Musique",
                apply: () => (
                  setThresholdDb(-14),
                  setRatio(2.5),
                  setAttackMs(20),
                  setReleaseMs(250),
                  setMakeupDb(1.5)
                ),
              },
              {
                label: "Limiteur",
                apply: () => (
                  setThresholdDb(-6),
                  setRatio(20),
                  setAttackMs(1),
                  setReleaseMs(80),
                  setMakeupDb(0)
                ),
              },
            ]}
          />
          <ParamSlider
            label="Seuil"
            value={thresholdDb}
            min={-48}
            max={0}
            step={0.5}
            suffix=" dB"
            onChange={setThresholdDb}
          />
          <ParamSlider
            label="Taux"
            value={ratio}
            min={1}
            max={20}
            step={0.5}
            suffix=" : 1"
            onChange={setRatio}
          />
          <ParamSlider
            label="Attaque"
            value={attackMs}
            min={0.5}
            max={100}
            step={0.5}
            suffix=" ms"
            onChange={setAttackMs}
          />
          <ParamSlider
            label="Relâchement"
            value={releaseMs}
            min={20}
            max={800}
            step={10}
            suffix=" ms"
            onChange={setReleaseMs}
          />
          <ParamSlider
            label="Gain de sortie"
            value={makeupDb}
            min={0}
            max={18}
            step={0.5}
            suffix=" dB"
            onChange={setMakeupDb}
          />
          <EffectActions
            build={() => ({
              id: opId(),
              type: "compress" as const,
              range,
              thresholdDb,
              ratio,
              attackMs,
              releaseMs,
              makeupDb,
            })}
            {...props}
          />
          <div className="border-t border-border pt-3">
            <ParamSlider
              label="Seuil de la porte de bruit"
              value={gateDb}
              min={-70}
              max={-20}
              step={1}
              suffix=" dB"
              onChange={setGateDb}
            />
            <EffectActions
              label="Appliquer la porte"
              build={() => ({
                id: opId(),
                type: "gate" as const,
                range,
                thresholdDb: gateDb,
                attackMs: 5,
                releaseMs: 120,
              })}
              {...props}
            />
          </div>
        </div>
      ) : null}

      {tool === "saturate" ? (
        <div className="space-y-2">
          <ParamSlider
            label="Chaleur"
            value={driveDb}
            min={0}
            max={24}
            step={0.5}
            suffix=" dB"
            onChange={setDriveDb}
          />
          <ParamSlider
            label="Dosage"
            value={satMix}
            min={0.05}
            max={1}
            step={0.05}
            suffix=""
            onChange={setSatMix}
          />
          <EffectActions
            build={() => ({ id: opId(), type: "saturate" as const, range, driveDb, mix: satMix })}
            {...props}
          />
        </div>
      ) : null}

      {tool === "stereo" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            0 = mono, 1 = inchangé, 2 = très large. Sans effet sur un fichier mono.
          </p>
          <ParamSlider
            label="Largeur stéréo"
            value={width}
            min={0}
            max={2}
            step={0.05}
            suffix="×"
            onChange={setWidth}
          />
          <EffectActions
            build={() => ({ id: opId(), type: "stereo" as const, width })}
            {...props}
          />
        </div>
      ) : null}

      {tool === "split" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">Division à la tête de lecture.</p>
          <Row>
            <Action variant="primary" onClick={() => props.onSplitKeep("left")}>
              Garder avant
            </Action>
            <Action onClick={() => props.onSplitKeep("right")}>Garder après</Action>
            <Action onClick={props.onSplitBoth}>Exporter les deux</Action>
          </Row>
        </div>
      ) : null}

      {tool === "merge" ? (
        <Row>
          <Action variant="primary" onClick={props.onMerge}>
            Ajouter un fichier audio à la fin
          </Action>
        </Row>
      ) : null}

      {tool === "sounds" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            Sons générés à la volée, à la fréquence de votre fichier. Insertion à la tête de lecture
            ou à la place de la sélection.
          </p>
          <div className="gf-photo-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {SOUNDS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSoundId(s.id);
                  setSoundSeconds(s.duration);
                  props.onPreviewSound(s.id, s.duration, soundGain);
                }}
                aria-pressed={soundId === s.id}
                className={`shrink-0 rounded-xl border px-3 py-2 text-[12px] ${
                  soundId === s.id
                    ? "border-primary bg-primary-softer text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <ParamSlider
            label="Durée"
            value={soundSeconds}
            min={0.05}
            max={10}
            step={0.05}
            suffix=" s"
            onChange={setSoundSeconds}
          />
          <ParamSlider
            label="Volume"
            value={soundGain}
            min={0.05}
            max={1}
            step={0.05}
            suffix=""
            onChange={setSoundGain}
          />
          <Row>
            <Action onClick={() => props.onPreviewSound(soundId, soundSeconds, soundGain)}>
              Écouter
            </Action>
            <Action
              variant="primary"
              onClick={() => props.onInsertSound(soundId, soundSeconds, soundGain, false)}
            >
              <Check className="mr-1 inline h-4 w-4" /> Insérer
            </Action>
            {selection && selection.end - selection.start > 0.005 ? (
              <Action onClick={() => props.onInsertSound(soundId, soundSeconds, soundGain, true)}>
                Remplacer la sélection
              </Action>
            ) : null}
          </Row>
        </div>
      ) : null}

      {tool === "censor" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            Le bip remplace exactement la sélection : la durée du fichier ne change pas et rien
            n'est ajouté à la fin.
          </p>
          <Presets
            items={[
              {
                label: "Radio 1 kHz",
                apply: () => {
                  setCensorFreq(1000);
                  setCensorStyle("continu");
                  setCensorMode("replace");
                },
              },
              {
                label: "TV double",
                apply: () => {
                  setCensorFreq(1200);
                  setCensorStyle("double");
                  setCensorMode("replace");
                },
              },
              {
                label: "Grave discret",
                apply: () => {
                  setCensorFreq(500);
                  setCensorGain(0.5);
                  setCensorStyle("continu");
                  setCensorMode("over");
                },
              },
            ]}
          />
          <ParamSlider
            label="Fréquence"
            value={censorFreq}
            min={200}
            max={2000}
            step={20}
            suffix=" Hz"
            onChange={setCensorFreq}
          />
          <ParamSlider
            label="Niveau"
            value={censorGain}
            min={0.1}
            max={1}
            step={0.05}
            suffix=""
            onChange={setCensorGain}
          />
          <Row>
            {(["continu", "double", "triple"] as CensorStyle[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setCensorStyle(st);
                  tick();
                }}
                aria-pressed={censorStyle === st}
                className={`min-h-9 rounded-xl border px-3 text-[12px] ${
                  censorStyle === st
                    ? "border-primary bg-primary-softer text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {st}
              </button>
            ))}
          </Row>
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={censorMode === "over"}
              onChange={(e) => setCensorMode(e.target.checked ? "over" : "replace")}
              className="h-4 w-4 accent-primary"
            />
            Garder la voix en fond (très atténuée)
          </label>
          <Row>
            <Action
              variant="primary"
              onClick={() =>
                props.onCensor({
                  freq: censorFreq,
                  gain: censorGain,
                  style: censorStyle,
                  mode: censorMode,
                })
              }
            >
              <Check className="mr-1 inline h-4 w-4" /> Censurer la sélection
            </Action>
          </Row>
        </div>
      ) : null}
    </section>
  );
}

/** Sélecteur de fichier pour la fusion (chargé à la demande). */
function MergePicker({
  title = "Choisir un fichier audio",
  onCancel,
  onPick,
}: {
  title?: string;
  onCancel: () => void;
  onPick: (entry: FileEntry, absolute: string) => void;
}) {
  return (
    <FileSourcePicker
      open
      title={title}
      extensions={["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac"]}
      multi={false}
      onCancel={onCancel}
      onConfirm={(paths, entries) => {
        const e = entries[0];
        const abs = paths[0];
        if (!e || !abs) {
          onCancel();
          return;
        }
        // Le chemin absolu est utilisé tel quel : le reconstruire à partir
        // d'une racine supposée produisait des chemins invalides.
        onPick(e, abs);
      }}
    />
  );
}
