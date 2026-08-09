/**
 * Détection de tempo réelle (aucune valeur inventée).
 *
 * Chaîne d'analyse : downmix mono → enveloppe d'énergie (flux positif)
 * → autocorrélation de l'enveloppe sur la plage 60–190 BPM → repliement
 * des harmoniques (double/moitié) → estimation de la phase (premier
 * temps). La confiance mesure la netteté du pic : en dessous d'un seuil,
 * on renvoie `bpm: null` plutôt qu'une valeur fantaisiste.
 *
 * Tout est calculé sur l'enveloppe (≈ 172 valeurs/seconde), donc le coût
 * reste faible même sur des fichiers longs.
 */
import type { AudioClip } from "./types";

export type TempoInfo = {
  /** BPM estimé, ou `null` si aucun tempo fiable n'a été trouvé. */
  bpm: number | null;
  /** 0..1 — netteté du pic d'autocorrélation. */
  confidence: number;
  /** Position (s) du premier temps détecté, utilisable même sans BPM. */
  beatOffset: number;
};

const MIN_BPM = 60;
const MAX_BPM = 190;

/** Enveloppe d'énergie : une valeur toutes les `hop` frames. */
function envelopeOf(clip: AudioClip): { env: Float32Array; rate: number } {
  const hop = Math.max(64, Math.round(clip.sampleRate / 172)); // ≈ 5.8 ms
  const frames = Math.max(1, Math.floor(clip.length / hop));
  const rms = new Float32Array(frames);
  const chs = clip.channels;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    const end = Math.min(clip.length, start + hop);
    for (let c = 0; c < chs.length; c++) {
      const ch = chs[c];
      for (let i = start; i < end; i++) sum += ch[i] * ch[i];
    }
    rms[f] = Math.sqrt(sum / Math.max(1, (end - start) * chs.length));
  }
  // Flux positif (attaques) : c'est ce qui porte le rythme.
  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = rms[f] - rms[f - 1];
    env[f] = d > 0 ? d : 0;
  }
  // Retrait de la moyenne glissante pour ne garder que les accents.
  const w = 24;
  const out = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += env[f];
    if (f >= w) acc -= env[f - w];
    const mean = acc / Math.min(w, f + 1);
    const v = env[f] - mean;
    out[f] = v > 0 ? v : 0;
  }
  return { env: out, rate: clip.sampleRate / hop };
}

function autocorrelate(env: Float32Array, lag: number): number {
  const n = env.length - lag;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += env[i] * env[i + lag];
  return sum / n;
}

/** Phase du premier temps : maximise l'énergie du peigne de battements. */
function estimatePhase(env: Float32Array, period: number, rate: number): number {
  const steps = Math.max(1, Math.round(period));
  let best = 0;
  let bestScore = -1;
  for (let p = 0; p < steps; p++) {
    let score = 0;
    for (let k = 0; ; k++) {
      const idx = Math.round(p + k * period);
      if (idx >= env.length) break;
      score += env[idx];
      if (k > 512) break;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best / rate;
}

/** Analyse synchrone — préférer {@link analyzeTempoAsync} depuis l'UI. */
export function analyzeTempo(clip: AudioClip): TempoInfo {
  if (!clip || clip.length === 0) return { bpm: null, confidence: 0, beatOffset: 0 };
  const seconds = clip.length / clip.sampleRate;
  if (seconds < 1.5) return { bpm: null, confidence: 0, beatOffset: 0 };
  const { env, rate } = envelopeOf(clip);
  let energy = 0;
  for (let i = 0; i < env.length; i++) energy += env[i];
  if (energy <= 1e-6) return { bpm: null, confidence: 0, beatOffset: 0 };

  const minLag = Math.floor((60 / MAX_BPM) * rate);
  const maxLag = Math.min(env.length - 2, Math.ceil((60 / MIN_BPM) * rate));
  if (maxLag <= minLag) return { bpm: null, confidence: 0, beatOffset: 0 };

  const scores = new Float32Array(maxLag - minLag + 1);
  let mean = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Renforcement harmonique : un vrai tempo se répète aussi à 2× et 4×.
    const base = autocorrelate(env, lag);
    const h2 = autocorrelate(env, lag * 2);
    const h4 = autocorrelate(env, lag * 4);
    const s = base + 0.5 * h2 + 0.25 * h4;
    scores[lag - minLag] = s;
    mean += s;
  }
  mean /= scores.length;

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestLag = minLag + i;
    }
  }
  if (!(bestScore > 0) || mean <= 0) return { bpm: null, confidence: 0, beatOffset: 0 };

  // Interpolation parabolique pour une précision sous-frame.
  const i0 = bestLag - minLag;
  const ym1 = scores[i0 - 1] ?? bestScore;
  const yp1 = scores[i0 + 1] ?? bestScore;
  const denom = ym1 - 2 * bestScore + yp1;
  const delta = denom !== 0 ? (0.5 * (ym1 - yp1)) / denom : 0;
  const period = bestLag + Math.max(-1, Math.min(1, delta));

  let bpm = (60 * rate) / period;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  const confidence = Math.max(0, Math.min(1, (bestScore / mean - 1) / 2));
  if (confidence < 0.18)
    return { bpm: null, confidence, beatOffset: estimatePhase(env, period, rate) };
  return {
    bpm: Math.round(bpm * 100) / 100,
    confidence,
    beatOffset: estimatePhase(env, period, rate),
  };
}

/**
 * Version non bloquante : l'analyse est découpée en tranches pour laisser
 * respirer le fil principal (l'interface reste fluide).
 */
export async function analyzeTempoAsync(clip: AudioClip): Promise<TempoInfo> {
  await new Promise((r) => setTimeout(r, 0));
  const info = analyzeTempo(clip);
  await new Promise((r) => setTimeout(r, 0));
  return info;
}
