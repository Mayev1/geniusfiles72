/**
 * Découverte des appareils compatibles à proximité.
 *
 * En natif : `NsdManager` publie et découvre des services `_geniusfiles._tcp`.
 * Le nom de service est préfixé par le code court à 6 chiffres (`GF_<code>_<name>`)
 * pour permettre au destinataire de retrouver l'expéditeur uniquement à partir
 * du code saisi.
 *
 * En preview web : la liste automatique reste vide. Aucune donnée fictive
 * n'est injectée — plus de peers simulés.
 */
import {
  bridgeStartDiscovery,
  bridgeStopDiscovery,
  bridgeSubscribe,
  isTransferNativeAvailable,
  type BridgePeer,
} from "./native-bridge";
import type { DeviceInfo, TransportKind } from "./types";

const EVT = "gf:transfer-devices-changed";

const autoPeers = new Map<string, DeviceInfo>();
let nativeUnsub: (() => void) | null = null;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVT));
}

/** Extrait le code court éventuellement encodé dans le nom mDNS. */
function extractCodeFromServiceName(name: string): { code?: string; label: string } {
  const m = /^GF_(\d{4,8})_(.+)$/.exec(name);
  if (m) return { code: m[1], label: m[2] };
  return { label: name };
}

function fromBridge(p: BridgePeer): DeviceInfo {
  const parsed = extractCodeFromServiceName(p.name);
  const code = p.code ?? parsed.code;
  return {
    id: p.id,
    name: parsed.label,
    platform: (p.platform as DeviceInfo["platform"]) || "android",
    transport: (p.transport as TransportKind) || "wifi-lan",
    address: p.address ? `${p.address}:${p.port}` : undefined,
    discovered: true,
    lastSeen: Date.now(),
    signal: 0.95,
    // On stocke le code dans un champ non-typé pour l'appairage par code.
    ...(code ? { code } : {}),
  } as DeviceInfo & { code?: string };
}

function ensureNativeSubscription() {
  if (nativeUnsub || !isTransferNativeAvailable()) return;
  nativeUnsub = bridgeSubscribe({
    peerFound: (p) => {
      autoPeers.set(p.id, fromBridge(p));
      emit();
    },
    peerLost: ({ id }) => {
      autoPeers.delete(id);
      emit();
    },
  });
}

export function subscribeDevices(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureNativeSubscription();
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

export function listAllDevices(): DeviceInfo[] {
  ensureNativeSubscription();
  return Array.from(autoPeers.values()).sort((a, b) => (b.signal ?? 0) - (a.signal ?? 0));
}

/** Récupère le premier appareil dont le code court correspond, ou null. */
export function findDeviceByCode(code: string): DeviceInfo | null {
  const trimmed = code.trim();
  for (const d of autoPeers.values()) {
    const c = (d as DeviceInfo & { code?: string }).code;
    if (c && c === trimmed) return d;
  }
  return null;
}

/** Lance un scan mDNS (natif). En web, ne fait rien. */
export async function scanDevices(timeoutMs = 1500): Promise<DeviceInfo[]> {
  if (isTransferNativeAvailable()) {
    ensureNativeSubscription();
    try {
      await bridgeStopDiscovery();
      await bridgeStartDiscovery();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, Math.max(300, timeoutMs)));
  }
  emit();
  return listAllDevices();
}

export async function stopDeviceDiscovery(): Promise<void> {
  if (isTransferNativeAvailable()) await bridgeStopDiscovery();
}
