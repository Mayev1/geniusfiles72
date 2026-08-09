/**
 * Pont vers le moteur d'export vidéo natif.
 *
 * Toute la transformation réelle se passe côté Android (MediaCodec +
 * OpenGL + MediaMuxer). Hors Android il n'y a pas de codec matériel
 * accessible : l'export est refusé explicitement, jamais simulé.
 */
import { isAndroidNative, nativePlugin } from "@/lib/native/geniusfiles-native";
import { toNativeEdit, type VideoEdit } from "@/lib/video/edit";

export type VideoExportRequest = {
  /** Chemin absolu du fichier source (jamais modifié). */
  path: string;
  /** Dossier de destination absolu. */
  outputDir: string;
  outputName: string;
  /** Portions conservées, dans l'ordre du montage (concaténées à l'export). */
  segments: Array<{ startMs: number; endMs: number }>;
  /** Coupe à l'image près (réencodage) plutôt que coupe sans perte. */
  exact: boolean;
  overwrite: boolean;
  /** Transformations image et son (étapes 5 et 6). */
  edit?: VideoEdit;
};

export type VideoExportResult = {
  id: string;
  path: string;
  name: string;
  size: number;
  durationMs: number;
};

type NativeVideoExportRequest = Omit<VideoExportRequest, "edit"> & {
  id: string;
  edit?: Record<string, unknown>;
};

type Plugin = {
  videoExport?: (o: NativeVideoExportRequest) => Promise<VideoExportResult>;
  videoExtractAudio?: (o: {
    path: string;
    outputDir: string;
    outputName: string;
    id: string;
    segments?: Array<{ startMs: number; endMs: number }>;
    edit?: Record<string, unknown>;
  }) => Promise<VideoExtractAudioResult>;
  videoExportCancel?: (o: { id: string }) => Promise<{ cancelled: boolean }>;
  addListener?: (
    event: string,
    cb: (payload: { id: string; progress: number }) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
};

function plugin(): Plugin | null {
  return nativePlugin() as unknown as Plugin | null;
}

export class VideoExportCancelled extends Error {
  constructor() {
    super("Export annulé");
  }
}

export type ExportHandle<T = VideoExportResult> = {
  id: string;
  promise: Promise<T>;
  cancel: () => void;
};

function newId(): string {
  return `vx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Démarre l'export et rend un handle : progression réelle diffusée par le
 * moteur (jamais une animation décorative) et annulation coopérative.
 */
export function startVideoExport(
  req: VideoExportRequest,
  onProgress?: (p: number) => void,
): ExportHandle {
  const id = newId();
  const p = plugin();
  if (!isAndroidNative() || !p?.videoExport) {
    return {
      id,
      promise: Promise.reject(
        new Error("L'export vidéo nécessite l'application Android (codecs matériels)."),
      ),
      cancel: () => undefined,
    };
  }

  let detach: (() => void) | null = null;
  if (onProgress && p.addListener) {
    const handle = p.addListener("videoExportProgress", (payload) => {
      if (payload?.id === id) onProgress(Math.max(0, Math.min(1, payload.progress)));
    });
    void Promise.resolve(handle).then((h) => {
      detach = () => void h.remove();
    });
  }

  const promise = p
    .videoExport({ ...req, id, edit: req.edit ? toNativeEdit(req.edit) : undefined })
    .then((res) => {
      detach?.();
      onProgress?.(1);
      return res;
    })
    .catch((e: unknown) => {
      detach?.();
      const msg = (e as { message?: string })?.message ?? "";
      const code = (e as { code?: string })?.code ?? "";
      if (code === "CANCELLED" || /annul/i.test(msg)) throw new VideoExportCancelled();
      throw new Error(msg || "Export impossible");
    });

  return {
    id,
    promise,
    cancel: () => {
      void p.videoExportCancel?.({ id });
    },
  };
}

export type VideoExtractAudioRequest = {
  path: string;
  outputDir: string;
  outputName: string;
  segments?: Array<{ startMs: number; endMs: number }>;
  edit?: VideoEdit;
};

export type VideoExtractAudioResult = {
  id: string;
  path: string;
  name: string;
  size: number;
};

/**
 * Extrait la bande son de la vidéo vers un M4A autonome, avec les réglages
 * de montage, vitesse et volume appliqués.
 */
export function extractVideoAudio(
  req: VideoExtractAudioRequest,
  onProgress?: (p: number) => void,
): ExportHandle<VideoExtractAudioResult> {
  const id = newId();
  const p = plugin();
  if (!isAndroidNative() || !p?.videoExtractAudio) {
    return {
      id,
      promise: Promise.reject(new Error("L'extraction audio nécessite l'application Android.")),
      cancel: () => undefined,
    };
  }

  let detach: (() => void) | null = null;
  if (onProgress && p.addListener) {
    const handle = p.addListener("videoExportProgress", (payload) => {
      if (payload?.id === id) onProgress(Math.max(0, Math.min(1, payload.progress)));
    });
    void Promise.resolve(handle).then((h) => {
      detach = () => void h.remove();
    });
  }

  const promise = p
    .videoExtractAudio({
      ...req,
      id,
      segments: req.segments ?? [{ startMs: 0, endMs: 0 }],
      edit: req.edit ? toNativeEdit(req.edit) : undefined,
    })
    .then((res) => {
      detach?.();
      onProgress?.(1);
      return res as VideoExtractAudioResult;
    })
    .catch((e: unknown) => {
      detach?.();
      const msg = (e as { message?: string })?.message ?? "";
      const code = (e as { code?: string })?.code ?? "";
      if (code === "CANCELLED" || /annul/i.test(msg)) throw new VideoExportCancelled();
      if (code === "NO_AUDIO" || /NO_AUDIO/i.test(msg)) {
        throw new Error("Cette vidéo n'a pas de piste audio exploitable.");
      }
      throw new Error(msg || "Extraction impossible");
    });

  return {
    id,
    promise,
    cancel: () => {
      void p.videoExportCancel?.({ id });
    },
  };
}
