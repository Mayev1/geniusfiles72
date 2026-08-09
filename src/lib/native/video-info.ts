/**
 * Métadonnées vidéo natives (largeur, hauteur, rotation, durée).
 *
 * Lues via `MediaMetadataRetriever` côté Android, donc disponibles
 * *avant* que le décodeur ne produise la première image : le lecteur peut
 * dimensionner sa scène immédiatement au lieu d'attendre `loadedmetadata`
 * (ce qui provoquait un saut de mise en page et une vidéo mal placée).
 */
import { isAndroidNative, nativePlugin } from "./geniusfiles-native";

export type VideoInfo = {
  width: number;
  height: number;
  /** 0 | 90 | 180 | 270 */
  rotation: number;
  durationMs: number;
};

type Plugin = {
  getVideoInfo?: (o: { path: string }) => Promise<VideoInfo>;
};

const cache = new Map<string, VideoInfo>();
const inflight = new Map<string, Promise<VideoInfo | null>>();

/** Accès synchrone à une info déjà résolue. */
export function peekVideoInfo(path: string): VideoInfo | null {
  return cache.get(path) ?? null;
}

export async function getVideoInfo(path: string): Promise<VideoInfo | null> {
  if (!isAndroidNative() || !path) return null;
  const hit = cache.get(path);
  if (hit) return hit;
  const pending = inflight.get(path);
  if (pending) return pending;

  const p = nativePlugin() as unknown as Plugin | null;
  if (!p?.getVideoInfo) return null;

  const task = (async () => {
    try {
      const info = await p.getVideoInfo!({ path });
      cache.set(path, info);
      return info;
    } catch {
      return null;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, task);
  return task;
}
