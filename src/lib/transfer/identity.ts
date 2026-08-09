/**
 * Identité stable de l'appareil pour le module Transfert.
 *
 * - Générée à la première ouverture (nom lisible + UUID interne).
 * - Persistée dans localStorage sous `gf.identity.v1`.
 * - Deux appareils peuvent avoir le même NOM affiché sans collision réelle :
 *   le `deviceId` reste unique et l'UI propose automatiquement des variantes
 *   quand deux noms identiques sont détectés à proximité pendant une session.
 * - Le nom peut être modifié à tout moment (paramètres OU module transfert).
 *
 * Aucune donnée n'est envoyée sur Internet — l'identité est purement locale.
 */
const KEY = "gf.identity.v1";
const EVT = "gf:identity-changed";

const PREFIXES = [
  "Genius",
  "Nova",
  "Orion",
  "Atlas",
  "Luna",
  "Nebula",
  "Zenith",
  "Kairo",
  "Vega",
  "Solis",
  "Iris",
  "Onyx",
  "Cirrus",
  "Halo",
  "Ember",
  "Astra",
  "Cobalt",
  "Sable",
  "Meridian",
  "Fable",
];

// Alphabet sans caractères ambigus (0/O, 1/I/l).
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface Identity {
  deviceId: string;
  name: string;
  createdAt: number;
}

export const NAME_MIN = 2;
export const NAME_MAX = 32;
export const NAME_RE = /^[\p{L}\p{N}_\-. ]{2,32}$/u;

let cached: Identity | null = null;

function randomChars(len: number): string {
  let out = "";
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    for (let i = 0; i < len; i++) out += ALPHA[buf[i] % ALPHA.length];
  } else {
    for (let i = 0; i < len; i++) out += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return out;
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${randomChars(12)}`;
}

/** Génère un nom lisible et unique (ex. « Genius_A7K92 »). */
export function generateUniqueName(): string {
  const p = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  return `${p}_${randomChars(5)}`;
}

function persist(id: Identity) {
  cached = id;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* ignore quota errors */
  }
}

function read(): Identity {
  if (cached) return cached;
  if (typeof window === "undefined") {
    cached = { deviceId: "web-ssr", name: "Mon appareil", createdAt: Date.now() };
    return cached;
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (parsed?.deviceId && parsed?.name) {
        cached = {
          deviceId: parsed.deviceId,
          name: parsed.name,
          createdAt: parsed.createdAt ?? Date.now(),
        };
        return cached;
      }
    }
  } catch {
    /* fallthrough — regenerate */
  }
  const fresh: Identity = {
    deviceId: newUuid(),
    name: generateUniqueName(),
    createdAt: Date.now(),
  };
  persist(fresh);
  return fresh;
}

export function getIdentity(): Identity {
  return read();
}

export function getLocalName(): string {
  return read().name;
}

export function getDeviceId(): string {
  return read().deviceId;
}

export function isValidName(name: string): boolean {
  return NAME_RE.test(name.trim());
}

export type SetNameResult =
  | { ok: true; identity: Identity }
  | { ok: false; message: string; suggestions?: string[] };

/**
 * Modifie le nom local. La validation est immédiate (pas d'attente de
 * validation finale) — le message d'erreur peut être affiché au fil de la
 * saisie côté UI.
 */
export function setLocalName(next: string): SetNameResult {
  const trimmed = next.trim();
  if (trimmed.length < NAME_MIN) {
    return {
      ok: false,
      message: `Le nom doit contenir au moins ${NAME_MIN} caractères.`,
    };
  }
  if (trimmed.length > NAME_MAX) {
    return {
      ok: false,
      message: `Le nom ne peut pas dépasser ${NAME_MAX} caractères.`,
    };
  }
  if (!NAME_RE.test(trimmed)) {
    return {
      ok: false,
      message: "Caractères non autorisés. Utilisez lettres, chiffres, . _ - ou espace.",
    };
  }
  const id = read();
  const nextId: Identity = { ...id, name: trimmed };
  persist(nextId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT));
  }
  return { ok: true, identity: nextId };
}

/** Propose 3 variantes disponibles à partir d'un nom souhaité. */
export function suggestVariants(base: string): string[] {
  const clean =
    base
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^\p{L}\p{N}_\-.]/gu, "")
      .slice(0, 24) || "Genius";
  return [`${clean}_1`, `${clean}_2`, `${clean}_${randomChars(3)}`];
}

export function subscribeIdentity(cb: (id: Identity) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(read());
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

/**
 * Détecte une collision de nom avec un appareil vu à proximité et propose
 * des variantes libres. `nearbyNames` est la liste des noms des peers
 * découverts par mDNS (hors soi-même).
 */
export function checkNameConflict(
  candidate: string,
  nearbyNames: string[],
): { conflict: boolean; suggestions: string[] } {
  const c = candidate.trim().toLowerCase();
  const conflict = nearbyNames.some((n) => n.trim().toLowerCase() === c);
  return { conflict, suggestions: conflict ? suggestVariants(candidate) : [] };
}
