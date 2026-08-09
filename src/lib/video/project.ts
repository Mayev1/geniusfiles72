/**
 * Modèle de montage vidéo — étape 4.
 *
 * Le montage est **non destructif** : la source n'est jamais touchée, le
 * projet n'est qu'une liste ordonnée de portions conservées. Toutes les
 * opérations sont pures et rendent un nouveau projet, ce qui permettra à
 * l'étape 8 d'empiler un historique undo/redo sans cas particulier.
 */

export type Segment = { id: string; start: number; end: number };
export type VideoProject = { duration: number; segments: Segment[] };

/** Marge minimale d'un segment : en dessous, la coupe n'a plus de sens. */
const MIN_LEN = 0.1;

/**
 * Identifiant **déterministe** : il ne dépend que des bornes du segment, donc
 * le rendu serveur et le rendu client produisent exactement les mêmes clés
 * (plus d'erreur d'hydratation liée à un compteur ou à `Math.random()`).
 */
function segId(start: number, end: number): string {
  return `seg-${Math.round(start * 1000)}-${Math.round(end * 1000)}`;
}

function mkSeg(start: number, end: number): Segment {
  return { id: segId(start, end), start, end };
}

export function createProject(duration: number): VideoProject {
  return { duration, segments: [mkSeg(0, duration)] };
}

export function totalLength(p: VideoProject): number {
  return p.segments.reduce((n, s) => n + Math.max(0, s.end - s.start), 0);
}

export function isEdited(p: VideoProject): boolean {
  if (p.segments.length !== 1) return true;
  const s = p.segments[0];
  return s.start > 0.01 || s.end < p.duration - 0.01;
}

/** Segment contenant l'instant `t` (source), ou null s'il a été retiré. */
export function segmentAt(p: VideoProject, t: number): Segment | null {
  return p.segments.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) ?? null;
}

function normalize(p: VideoProject, segments: Segment[]): VideoProject {
  const kept = segments.filter((s) => s.end - s.start >= MIN_LEN).sort((a, b) => a.start - b.start);
  return { duration: p.duration, segments: kept };
}

/** Division au curseur : deux segments contigus, aucun contenu perdu. */
export function splitAt(p: VideoProject, t: number): VideoProject {
  const seg = segmentAt(p, t);
  if (!seg) return p;
  if (t - seg.start < MIN_LEN || seg.end - t < MIN_LEN) return p;
  const next = p.segments.flatMap((s) =>
    s.id === seg.id ? [mkSeg(s.start, t), mkSeg(t, s.end)] : [s],
  );
  return normalize(p, next);
}

/** Suppression d'un segment entier (la portion disparaît du montage). */
export function removeSegment(p: VideoProject, id: string): VideoProject {
  if (p.segments.length <= 1) return p;
  return normalize(
    p,
    p.segments.filter((s) => s.id !== id),
  );
}

/** Suppression d'une portion quelconque, y compris au milieu d'un segment. */
export function removeRange(p: VideoProject, from: number, to: number): VideoProject {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  if (b - a < MIN_LEN) return p;
  const next: Segment[] = [];
  for (const s of p.segments) {
    if (b <= s.start || a >= s.end) {
      next.push(s);
      continue;
    }
    if (a > s.start) next.push(mkSeg(s.start, Math.min(a, s.end)));
    if (b < s.end) next.push(mkSeg(Math.max(b, s.start), s.end));
  }
  const result = normalize(p, next);
  return result.segments.length ? result : p;
}

/** Découpe globale : tout ce qui précède `t` est retiré. */
export function cutBefore(p: VideoProject, t: number): VideoProject {
  return removeRange(p, 0, t);
}

/** Découpe globale : tout ce qui suit `t` est retiré. */
export function cutAfter(p: VideoProject, t: number): VideoProject {
  return removeRange(p, t, p.duration);
}

/**
 * Lecture continue de l'aperçu : depuis un instant source, quel est le
 * prochain instant réellement conservé ? Rend `null` quand le montage est
 * terminé, ce qui permet d'arrêter la lecture exactement comme le fera le
 * fichier exporté.
 */
export function nextPlayable(p: VideoProject, t: number): number | null {
  const inside = segmentAt(p, t);
  if (inside) return t;
  const after = p.segments.find((s) => s.start >= t - 1e-6);
  return after ? after.start : null;
}

/** Segments prêts pour le moteur natif (millisecondes, ordre du montage). */
export function exportSegments(p: VideoProject): Array<{ startMs: number; endMs: number }> {
  return p.segments.map((s) => ({
    startMs: Math.max(0, Math.round(s.start * 1000)),
    endMs: Math.max(0, Math.round(s.end * 1000)),
  }));
}

/** Portions retirées, pour les afficher grisées sur la timeline. */
export function removedRanges(p: VideoProject): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of p.segments) {
    if (s.start > cursor + 1e-6) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < p.duration - 1e-6) gaps.push({ start: cursor, end: p.duration });
  return gaps;
}
