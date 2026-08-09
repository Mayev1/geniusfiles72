/**
 * Synchronisation multipiste réelle (façon « Sync » d'une platine DJ).
 *
 * Aucune illusion visuelle : les pistes synchronisées sont réellement
 * ré-étirées dans le temps (WSOLA, hauteur préservée) à partir de leur
 * audio d'origine, puis repositionnées sur la grille de battements de la
 * piste maître. Comme le moteur de lecture démarre toutes les pistes sur
 * la même horloge `AudioContext`, elles restent alignées à l'échantillon
 * près pendant toute la lecture, après un seek comme après une pause.
 */
import type { AudioClip } from "./types";
import { emptyClip } from "./dsp";
import { analyzeTempo, analyzeTempoAsync, type TempoInfo } from "./bpm";

/** Métadonnées de synchronisation portées par une piste. */
export type TrackSync = {
  /** BPM d'origine détecté (null = indétectable). */
  sourceBpm: number | null;
  /** BPM cible (celui de la piste maître). */
  targetBpm: number | null;
  /** Facteur d'étirement appliqué (1 = aucun). */
  ratio: number;
  /** Identifiant de la piste maître (`main` ou id de piste). */
  masterId: string;
  /** Synchronisation temporelle seule (tempo non détecté). */
  timeOnly: boolean;
};

/**
 * Étirement temporel WSOLA : recherche du meilleur recouvrement par
 * corrélation croisée avant chaque fondu. Bien plus propre qu'un simple
 * OLA (pas de flanger ni de doubles attaques) et la hauteur est conservée.
 * `ratio` = durée de sortie / durée d'entrée.
 */
export function stretchWsola(clip: AudioClip, ratio: number): AudioClip {
  if (!Number.isFinite(ratio) || ratio <= 0) return clip;
  if (Math.abs(ratio - 1) < 0.0005 || clip.length === 0) return clip;

  const sr = clip.sampleRate;
  const win = Math.max(512, Math.round(sr * 0.045)); // ≈ 45 ms
  const hopSyn = Math.floor(win / 2);
  const hopAna = Math.max(1, Math.round(hopSyn / ratio));
  const search = Math.max(1, Math.round(sr * 0.01)); // ±10 ms
  const outLength = Math.max(1, Math.round(clip.length * ratio));
  const chCount = clip.channels.length;
  const out = emptyClip(sr, chCount, outLength);
  const norm = new Float32Array(outLength);

  const window = new Float32Array(win);
  for (let i = 0; i < win; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));

  // Référence mono pour choisir le décalage : les canaux restent alignés
  // entre eux, donc l'image stéréo est préservée.
  const mono = clip.channels[0];
  const ref = new Float32Array(hopSyn);
  let outPos = 0;
  let frame = 0;
  let first = true;

  while (outPos < outLength) {
    // Position d'analyse *idéale* : ancrée sur la grille k·hopAna, jamais
    // sur la position retenue à l'itération précédente — sinon les petits
    // recalages de corrélation s'accumulent et la durée dérive.
    const center = frame * hopAna;
    if (center >= clip.length) break;
    let best = center;
    if (!first) {
      const from = Math.max(0, center - search);
      const to = Math.min(clip.length - win - 1, center + search);
      let bestScore = -Infinity;
      for (let cand = from; cand <= to; cand += 2) {
        let score = 0;
        for (let i = 0; i < hopSyn; i += 4) score += ref[i] * (mono[cand + i] ?? 0);
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      if (best < 0) best = 0;
    }
    first = false;

    for (let c = 0; c < chCount; c++) {
      const src = clip.channels[c];
      const dst = out.channels[c];
      for (let i = 0; i < win; i++) {
        const si = best + i;
        const di = outPos + i;
        if (si >= src.length || di >= outLength) break;
        dst[di] += src[si] * window[i];
        if (c === 0) norm[di] += window[i];
      }
    }
    // Segment de référence pour la prochaine corrélation.
    for (let i = 0; i < hopSyn; i++) ref[i] = mono[best + hopSyn + i] ?? 0;

    outPos += hopSyn;
    frame += 1;
  }

  for (let c = 0; c < chCount; c++) {
    const dst = out.channels[c];
    for (let i = 0; i < outLength; i++) {
      const n = norm[i];
      if (n > 0.0001) {
        const v = dst[i] / n;
        dst[i] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
    }
  }
  return out;
}

/** Replie un tempo autour de la référence (évite un ×2 ou ÷2 absurde). */
export function foldTempo(bpm: number, reference: number): number {
  let v = bpm;
  while (v / reference > 1.4) v /= 2;
  while (reference / v > 1.4) v *= 2;
  return v;
}

export type SyncInput = {
  id: string;
  clip: AudioClip;
  /** Position actuelle sur la timeline (s). */
  offset: number;
  tempo: TempoInfo;
};

export type SyncPlan = {
  id: string;
  /** Étirement à appliquer à l'audio source (1 = inchangé). */
  ratio: number;
  /** Nouveau décalage sur la timeline (s). */
  offset: number;
  sourceBpm: number | null;
  targetBpm: number | null;
  timeOnly: boolean;
};

/**
 * Calcule, pour chaque piste cible, l'étirement et le décalage qui
 * l'alignent musicalement sur la piste maître. Aucun audio n'est traité
 * ici : le plan est pur et testable.
 */
export function planSync(master: SyncInput, targets: SyncInput[]): SyncPlan[] {
  const masterBpm = master.tempo.bpm;
  const masterBeat0 = master.offset + master.tempo.beatOffset;
  const beat = masterBpm ? 60 / masterBpm : 0;

  return targets.map((t) => {
    const srcBpm = t.tempo.bpm;
    let ratio = 1;
    let timeOnly = true;
    if (masterBpm && srcBpm) {
      const folded = foldTempo(srcBpm, masterBpm);
      ratio = folded / masterBpm; // durée cible / durée source
      if (!Number.isFinite(ratio) || ratio <= 0.25 || ratio >= 4) ratio = 1;
      else timeOnly = false;
    }
    const newBeat0 = t.tempo.beatOffset * ratio;
    let offset: number;
    if (beat > 0) {
      // On garde la piste au plus près de sa position actuelle, mais son
      // premier temps tombe exactement sur un battement du maître.
      const k = Math.round((t.offset + newBeat0 - masterBeat0) / beat);
      offset = masterBeat0 + k * beat - newBeat0;
    } else {
      // Sans tempo exploitable : alignement des premières attaques.
      offset = masterBeat0 - newBeat0;
    }
    if (!Number.isFinite(offset)) offset = t.offset;
    if (offset < 0) offset = beat > 0 ? offset + Math.ceil(-offset / beat) * beat : 0;
    return {
      id: t.id,
      ratio,
      offset: Math.max(0, offset),
      sourceBpm: srcBpm,
      targetBpm: masterBpm,
      timeOnly,
    };
  });
}

/** Analyse mémoïsée par clip (les clips sont immuables dans l'éditeur). */
const tempoCache = new WeakMap<AudioClip, TempoInfo>();

export function tempoOf(clip: AudioClip): TempoInfo {
  const hit = tempoCache.get(clip);
  if (hit) return hit;
  const info = analyzeTempo(clip);
  tempoCache.set(clip, info);
  return info;
}

/** Version non bloquante, mémoïsée : l'UI reste réactive pendant l'analyse. */
export async function tempoOfAsync(clip: AudioClip): Promise<TempoInfo> {
  const hit = tempoCache.get(clip);
  if (hit) return hit;
  const info = await analyzeTempoAsync(clip);
  tempoCache.set(clip, info);
  return info;
}
