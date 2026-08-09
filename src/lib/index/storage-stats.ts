/**
 * Index persistant des statistiques de stockage (compteurs + octets par
 * catégorie).
 *
 * Objectif : l'accueil et les tuiles de catégories affichent des valeurs
 * **immédiatement**, sans jamais relancer une analyse à chaque montage.
 *
 * Fonctionnement
 * --------------
 * - Un instantané par « scope » (ensemble de racines) est conservé en
 *   mémoire ET dans IndexedDB : à l'ouverture, la valeur connue est
 *   émise de façon synchrone, donc aucun écran vide ni clignotement.
 * - Une analyse complète n'est déclenchée que si aucun instantané n'est
 *   connu ou s'il a dépassé sa durée de fraîcheur ({@link TTL_MS}).
 * - Les mutations de fichiers (`gf:fs-patch`) sont appliquées de façon
 *   **chirurgicale** : création/suppression ajustent les compteurs et
 *   les octets ; renommage et déplacement interne ne changent rien.
 *   Aucune reconstruction complète n'est provoquée par une opération
 *   utilisateur.
 * - Plusieurs abonnés (accueil, analyse, nettoyeur) partagent la même
 *   analyse : elle n'est exécutée qu'une fois.
 */
import { scanCategories, type CategoryKey, type ScanResult } from "@/lib/files/analyzer";
import { kindOf } from "@/lib/files/format";
import type { FileKind, PathRef } from "@/lib/files/types";
import { idbGetCached, idbSetCached } from "./persist";
import { subscribeFsPatch, type FsPatchOp } from "./patches";

const TTL_MS = 12 * 60 * 60_000;
const MIN_GAP_MS = 30_000;

type Snapshot = { version: 1; result: ScanResult; builtAt: number };

type Scope = {
  key: string;
  roots: PathRef[];
  snapshot: Snapshot | null;
  listeners: Set<(r: ScanResult) => void>;
  running: { cancel: () => void } | null;
  loading: Promise<void> | null;
  lastStartedAt: number;
};

const scopes = new Map<string, Scope>();
let patchBound = false;

const KIND_TO_CATEGORY: Partial<Record<FileKind, CategoryKey>> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  pdf: "pdf",
  text: "document",
  archive: "archive",
  apk: "apk",
};

function idbKey(scopeKey: string) {
  return `storage-stats:v1:${scopeKey}`;
}

function getScope(key: string, roots: PathRef[]): Scope {
  let s = scopes.get(key);
  if (!s) {
    s = {
      key,
      roots,
      snapshot: null,
      listeners: new Set(),
      running: null,
      loading: null,
      lastStartedAt: 0,
    };
    scopes.set(key, s);
  } else {
    s.roots = roots;
  }
  return s;
}

function emit(scope: Scope) {
  const r = scope.snapshot?.result;
  if (!r) return;
  for (const cb of scope.listeners) {
    try {
      cb(r);
    } catch {
      /* un abonné défaillant ne casse pas les autres */
    }
  }
}

function persist(scope: Scope) {
  if (!scope.snapshot) return;
  void idbSetCached(idbKey(scope.key), scope.snapshot);
}

function isStale(scope: Scope) {
  return !scope.snapshot || Date.now() - scope.snapshot.builtAt > TTL_MS;
}

function startScan(scope: Scope) {
  if (scope.running) return;
  if (Date.now() - scope.lastStartedAt < MIN_GAP_MS && scope.snapshot) return;
  scope.lastStartedAt = Date.now();
  const hadSnapshot = !!scope.snapshot;
  scope.running = scanCategories(
    scope.roots,
    (partial) => {
      // Pendant une première analyse on affiche la progression réelle ;
      // sinon on garde l'instantané existant pour éviter tout clignotement.
      if (hadSnapshot) return;
      scope.snapshot = { version: 1, result: partial, builtAt: 0 };
      emit(scope);
    },
    (result) => {
      scope.running = null;
      if (result.cancelled) return;
      scope.snapshot = { version: 1, result, builtAt: Date.now() };
      emit(scope);
      persist(scope);
    },
  );
}

async function hydrate(scope: Scope): Promise<void> {
  if (scope.snapshot) return;
  if (scope.loading) return scope.loading;
  scope.loading = (async () => {
    const raw = await idbGetCached<Snapshot>(idbKey(scope.key));
    if (raw && raw.version === 1 && raw.result && !scope.snapshot) {
      scope.snapshot = raw;
      emit(scope);
    }
  })();
  await scope.loading;
  scope.loading = null;
}

/* ---------- Mise à jour chirurgicale ---------- */

function adjust(scope: Scope, cat: CategoryKey, deltaCount: number, deltaBytes: number) {
  const snap = scope.snapshot;
  if (!snap) return false;
  const c = snap.result.categories[cat];
  if (!c) return false;
  c.count = Math.max(0, c.count + deltaCount);
  c.bytes = Math.max(0, c.bytes + deltaBytes);
  snap.result.totalFiles = Math.max(0, snap.result.totalFiles + deltaCount);
  snap.result.totalBytes = Math.max(0, snap.result.totalBytes + deltaBytes);
  return true;
}

function categoryOf(name: string): CategoryKey {
  return KIND_TO_CATEGORY[kindOf(name, false)] ?? "other";
}

function applyPatch(patch: FsPatchOp) {
  for (const scope of scopes.values()) {
    if (!scope.snapshot) continue;
    let changed = false;
    if (patch.op === "create" && !patch.isDirectory) {
      changed = adjust(scope, categoryOf(patch.name), 1, patch.size ?? 0);
    } else if (patch.op === "delete" && !patch.isDirectory) {
      changed = adjust(scope, categoryOf(patch.name), -1, 0);
    } else if (patch.op === "rename" && !patch.isDirectory) {
      const from = categoryOf(patch.oldName);
      const to = categoryOf(patch.newName);
      if (from !== to) {
        adjust(scope, from, -1, 0);
        adjust(scope, to, 1, 0);
        changed = true;
      }
    }
    // Un déplacement à l'intérieur des racines suivies ne modifie ni le
    // nombre de fichiers ni les octets : rien à recalculer.
    if (changed) {
      emit(scope);
      persist(scope);
    }
  }
}

function bindPatches() {
  if (patchBound || typeof window === "undefined") return;
  patchBound = true;
  subscribeFsPatch(applyPatch);
}

/* ---------- API publique ---------- */

export type StatsHandle = { cancel: () => void; refresh: () => void };

/**
 * Abonnement aux statistiques d'un ensemble de racines. Émet
 * instantanément la dernière valeur connue (mémoire puis IndexedDB) et
 * ne déclenche une analyse que si l'index est absent ou périmé.
 */
export function subscribeStorageStats(
  scopeKey: string,
  roots: PathRef[],
  onUpdate: (result: ScanResult) => void,
  opts: { force?: boolean } = {},
): StatsHandle {
  bindPatches();
  const scope = getScope(scopeKey, roots);
  let cancelled = false;
  const listener = (r: ScanResult) => {
    if (!cancelled) onUpdate(r);
  };
  scope.listeners.add(listener);

  if (scope.snapshot) onUpdate(scope.snapshot.result);

  void (async () => {
    await hydrate(scope);
    if (cancelled) return;
    if (opts.force || isStale(scope)) startScan(scope);
  })();

  return {
    cancel: () => {
      cancelled = true;
      scope.listeners.delete(listener);
    },
    refresh: () => {
      scope.lastStartedAt = 0;
      startScan(scope);
    },
  };
}

/** Dernier instantané connu, sans déclencher d'analyse. */
export function peekStorageStats(scopeKey: string): ScanResult | null {
  return scopes.get(scopeKey)?.snapshot?.result ?? null;
}

/** Force une nouvelle analyse en arrière-plan (bouton « Actualiser »). */
export function refreshStorageStats(scopeKey?: string) {
  for (const scope of scopes.values()) {
    if (scopeKey && scope.key !== scopeKey) continue;
    scope.lastStartedAt = 0;
    startScan(scope);
  }
}
