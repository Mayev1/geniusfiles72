/**
 * Coffre-fort — credential storage + verification.
 *
 * PIN / password are stored as a PBKDF2-SHA256 digest with a random 16-byte
 * salt. WebCrypto is available in every runtime the app targets (Android
 * WebView, Lovable preview, SSR is guarded). We NEVER persist the plaintext.
 *
 * Biometric quick-unlock is a preference flag on top of the credential —
 * a valid PIN or password is always required as the primary factor and
 * fallback. This keeps the security model auditable: no key derives from a
 * biometric prompt alone.
 */
import type { VaultAuthMethod, VaultCredential } from "./types";

const KEY = "gf.vault.credential";
const ITERATIONS = 120_000;

function safeGet(): VaultCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as VaultCredential;
  } catch {
    return null;
  }
}

function safeSet(c: VaultCredential | null) {
  if (typeof window === "undefined") return;
  try {
    if (c) window.localStorage.setItem(KEY, JSON.stringify(c));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

function hexToBytes(hex: string): ArrayBuffer {
  const buf = new ArrayBuffer(hex.length / 2);
  const view = new Uint8Array(buf);
  for (let i = 0; i < view.length; i++) view[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return buf;
}

async function deriveHash(secret: string, saltHex: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

export function isVaultConfigured(): boolean {
  return safeGet() !== null;
}

export function getVaultMethod(): VaultAuthMethod | null {
  return safeGet()?.method ?? null;
}

export function isBiometricEnabled(): boolean {
  return safeGet()?.biometricEnabled ?? false;
}

/** Best-effort probe for native biometric support (Android). Never throws. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const cap = (
      window as unknown as {
        Capacitor?: { Plugins?: Record<string, { isAvailable?: () => Promise<unknown> }> };
      }
    ).Capacitor;
    const plugin = cap?.Plugins?.NativeBiometric;
    if (plugin?.isAvailable) {
      const r = (await plugin.isAvailable()) as { isAvailable?: boolean } | boolean;
      if (typeof r === "boolean") return r;
      return !!r?.isAvailable;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/**
 * Ask the platform to run a biometric prompt. Returns true on success.
 * When no plugin is present, resolves to false so the caller can fall
 * back to the PIN/password prompt.
 */
export async function verifyBiometric(reason = "Déverrouiller le coffre-fort"): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const cap = (
      window as unknown as {
        Capacitor?: {
          Plugins?: Record<string, { verifyIdentity?: (opts: unknown) => Promise<void> }>;
        };
      }
    ).Capacitor;
    const plugin = cap?.Plugins?.NativeBiometric;
    if (!plugin?.verifyIdentity) return false;
    await plugin.verifyIdentity({ reason, title: "GeniusFiles" });
    return true;
  } catch {
    return false;
  }
}

export async function setupVault(
  method: VaultAuthMethod,
  secret: string,
  biometricEnabled = false,
): Promise<VaultCredential> {
  const salt = randomHex(16);
  const hash = await deriveHash(secret, salt, ITERATIONS);
  const now = Date.now();
  const cred: VaultCredential = {
    method,
    hash,
    salt,
    iterations: ITERATIONS,
    biometricEnabled,
    createdAt: now,
    updatedAt: now,
  };
  safeSet(cred);
  return cred;
}

export async function verifySecret(secret: string): Promise<boolean> {
  const cred = safeGet();
  if (!cred) return false;
  const hash = await deriveHash(secret, cred.salt, cred.iterations);
  // constant-time-ish compare
  if (hash.length !== cred.hash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hash.length; i++) {
    mismatch |= hash.charCodeAt(i) ^ cred.hash.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function changeSecret(
  currentSecret: string,
  method: VaultAuthMethod,
  nextSecret: string,
): Promise<{ ok: boolean; error?: string }> {
  const ok = await verifySecret(currentSecret);
  if (!ok) return { ok: false, error: "Ancien code incorrect" };
  const salt = randomHex(16);
  const hash = await deriveHash(nextSecret, salt, ITERATIONS);
  const prev = safeGet();
  if (!prev) return { ok: false, error: "Coffre-fort introuvable" };
  safeSet({
    ...prev,
    method,
    hash,
    salt,
    iterations: ITERATIONS,
    updatedAt: Date.now(),
  });
  return { ok: true };
}

export function setBiometricEnabled(enabled: boolean): void {
  const cred = safeGet();
  if (!cred) return;
  safeSet({ ...cred, biometricEnabled: enabled, updatedAt: Date.now() });
}

/**
 * Reset the credential. Only call this after the caller has verified the
 * current secret OR the user explicitly requested a hard reset (which
 * also wipes the vault contents — handled by api.ts).
 */
export function resetCredential(): void {
  safeSet(null);
}
