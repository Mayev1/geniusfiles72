/**
 * Extraction de vraies images de la vidéo pour la timeline.
 *
 * Aucune vignette fictive : chaque case de la piste est l'image réellement
 * présente à l'instant demandé, décodée par le lecteur puis peinte dans un
 * canvas hors écran. Les demandes sont sérialisées (un seul `seek` à la
 * fois) pour ne jamais saturer le décodeur, mises en cache par instant
 * arrondi, et limitées en nombre pour garder la mémoire plate même sur une
 * vidéo de plusieurs heures.
 */
const MAX_CACHE = 240;
/** Précision du cache : deux demandes à moins de 100 ms partagent l'image. */
const QUANTUM = 0.1;

export class FrameSource {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private cache = new Map<number, string>();
  private queue: Array<{ t: number; resolve: (v: string | null) => void }> = [];
  private busy = false;
  private disposed = false;
  private readyPromise: Promise<boolean> | null = null;

  constructor(
    private src: string,
    private height = 56,
  ) {}

  /** Image déjà connue, sans aucun travail — utilisable pendant le rendu. */
  peek(t: number): string | null {
    return this.cache.get(this.key(t)) ?? null;
  }

  async frame(t: number): Promise<string | null> {
    if (this.disposed || !this.src) return null;
    const hit = this.cache.get(this.key(t));
    if (hit) return hit;
    const ok = await this.ready();
    if (!ok || this.disposed) return null;
    return new Promise<string | null>((resolve) => {
      this.queue.push({ t, resolve });
      void this.pump();
    });
  }

  dispose() {
    this.disposed = true;
    this.queue.splice(0).forEach((q) => q.resolve(null));
    this.cache.clear();
    if (this.video) {
      this.video.removeAttribute("src");
      try {
        this.video.load();
      } catch {
        /* ignore */
      }
      this.video = null;
    }
    this.canvas = null;
  }

  private key(t: number): number {
    return Math.round(Math.max(0, t) / QUANTUM);
  }

  private ready(): Promise<boolean> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<boolean>((resolve) => {
      if (typeof document === "undefined") return resolve(false);
      const v = document.createElement("video");
      v.src = this.src;
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.crossOrigin = "anonymous";
      const done = (ok: boolean) => {
        v.onloadeddata = null;
        v.onerror = null;
        resolve(ok);
      };
      v.onloadeddata = () => {
        this.video = v;
        done(true);
      };
      v.onerror = () => done(false);
      // Certains conteneurs n'émettent `loadeddata` qu'après un seek.
      try {
        v.load();
      } catch {
        done(false);
      }
    });
    return this.readyPromise;
  }

  private async pump() {
    if (this.busy || this.disposed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    const url = await this.grab(job.t);
    this.busy = false;
    job.resolve(url);
    if (this.queue.length) void this.pump();
  }

  private grab(t: number): Promise<string | null> {
    const v = this.video;
    if (!v) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (url: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.removeEventListener("seeked", onSeeked);
        resolve(url);
      };
      const onSeeked = () => {
        try {
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) return finish(null);
          const cw = Math.max(1, Math.round((this.height * w) / h));
          const canvas = this.canvas ?? document.createElement("canvas");
          this.canvas = canvas;
          canvas.width = cw;
          canvas.height = this.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null);
          ctx.drawImage(v, 0, 0, cw, this.height);
          const url = canvas.toDataURL("image/jpeg", 0.6);
          this.remember(t, url);
          finish(url);
        } catch {
          finish(null);
        }
      };
      const timer = setTimeout(() => finish(null), 4000);
      v.addEventListener("seeked", onSeeked);
      try {
        v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
      } catch {
        finish(null);
      }
    });
  }

  private remember(t: number, url: string) {
    const k = this.key(t);
    this.cache.set(k, url);
    if (this.cache.size > MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}
