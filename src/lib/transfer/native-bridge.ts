/**
 * Bridge TypeScript vers le plugin natif Android `GeniusFilesTransfer`.
 *
 * Modèle : l'appareil qui envoie ouvre un serveur TCP local (`hostSession`),
 * annonce la session en mDNS avec le code court, puis attend qu'un pair
 * se connecte. Le destinataire scanne le QR (ou saisit le code, résolu via
 * mDNS) et se connecte avec `joinSession`. Les deux côtés reçoivent les
 * évènements `peerReady` (poignée de main terminée), `sessionState`,
 * `sessionProgress`, `sessionDone` et `sessionError` — parfaitement
 * symétriques pour que les deux UI restent synchronisées.
 *
 * En preview web (aucun plugin), les appels renvoient `null` ou une erreur
 * "unavailable" plutôt que de crasher.
 */
import { isNativeRuntime, nativePlatform } from "@/lib/native/platform";

export type BridgePeer = {
  id: string;
  name: string;
  address: string;
  port: number;
  platform: string;
  transport: string;
  /** Code court éventuellement encodé dans le nom de service mDNS. */
  code?: string;
};

export type BridgeSessionState = {
  sessionId: string;
  role: "sender" | "receiver";
  state: "handshaking" | "running" | "paused" | "verifying" | "reconnecting";
  peer?: string;
};

export type BridgeSessionProgress = {
  sessionId: string;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  currentFile: string;
  currentFileBytesDone: number;
  currentFileBytesTotal: number;
  bytesPerSecond: number;
  etaSeconds: number;
};

export type BridgeSessionDone = {
  sessionId: string;
  verified: boolean;
  filesCount?: number;
  totalBytes?: number;
  durationMs?: number;
};
export type BridgeSessionError = { sessionId: string; message: string };
export type BridgePeerReady = {
  sessionId: string;
  peerName: string;
  peerDeviceId?: string;
};

type Handle = { remove: () => Promise<void> };

type PluginFile = { source: string; relPath: string };

export type BridgeSessionAppended = {
  sessionId: string;
  filesAdded: number;
  bytesAdded: number;
  expectedFiles: number;
  expectedBytes: number;
};

export type BridgeSessionFileReceived = {
  sessionId: string;
  name: string;
  size: number;
  path: string;
};

type Plugin = {
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  /** L'expéditeur ouvre un serveur, annonce la session en mDNS et attend un client. */
  hostSession: (o: {
    sessionId: string;
    code: string;
    name: string;
    verify: boolean;
    files: PluginFile[];
  }) => Promise<{ sessionId: string; host: string; port: number }>;
  /** Le destinataire se connecte au serveur de l'expéditeur. */
  joinSession: (o: {
    sessionId: string;
    host: string;
    port: number;
    name: string;
    deviceId: string;
    inbox: string;
  }) => Promise<{ sessionId: string }>;
  pauseSession: (o: { sessionId: string }) => Promise<void>;
  resumeSession: (o: { sessionId: string }) => Promise<void>;
  cancelSession: (o: { sessionId: string }) => Promise<void>;
  /** Ajoute des fichiers à une session déjà connectée (expéditeur). */
  appendSession: (o: { sessionId: string; files: PluginFile[] }) => Promise<{
    added: number;
    addedBytes: number;
    expectedFiles: number;
    expectedBytes: number;
  }>;
  /** Ferme proprement une session côté expéditeur. */
  endSession: (o: { sessionId: string }) => Promise<void>;
  localAddress: () => Promise<{ address: string }>;
  addListener: (event: string, cb: (data: unknown) => void) => Promise<Handle> | Handle;
};

function plugin(): Plugin | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
  };
  const p = w.Capacitor?.Plugins?.GeniusFilesTransfer as Plugin | undefined;
  return p ?? null;
}

export function isTransferNativeAvailable(): boolean {
  return isNativeRuntime() && nativePlatform() === "android" && plugin() !== null;
}

async function ensure(): Promise<Plugin> {
  const p = plugin();
  if (!p) throw new Error("native-transfer-unavailable");
  return p;
}

export async function bridgeStartDiscovery(): Promise<void> {
  const p = await ensure();
  await p.startDiscovery();
}

export async function bridgeStopDiscovery(): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.stopDiscovery();
  } catch {
    /* ignore */
  }
}

/** Ouvre un serveur côté expéditeur et renvoie l'adresse à mettre dans le QR. */
export async function bridgeHostSession(opts: {
  sessionId: string;
  code: string;
  name: string;
  verify: boolean;
  files: PluginFile[];
}): Promise<{ sessionId: string; host: string; port: number }> {
  const p = await ensure();
  return p.hostSession(opts);
}

/** Se connecte au serveur de l'expéditeur (côté destinataire). */
export async function bridgeJoinSession(opts: {
  sessionId: string;
  host: string;
  port: number;
  name: string;
  deviceId: string;
  inbox: string;
}): Promise<{ sessionId: string }> {
  const p = await ensure();
  return p.joinSession(opts);
}

export async function bridgePause(sessionId: string) {
  const p = plugin();
  if (p) await p.pauseSession({ sessionId });
}
export async function bridgeResume(sessionId: string) {
  const p = plugin();
  if (p) await p.resumeSession({ sessionId });
}
export async function bridgeCancel(sessionId: string) {
  const p = plugin();
  if (p) {
    try {
      await p.cancelSession({ sessionId });
    } catch {
      /* la session peut être déjà finalisée */
    }
  }
}

export async function bridgeLocalAddress(): Promise<string | null> {
  const p = plugin();
  if (!p) return null;
  try {
    const { address } = await p.localAddress();
    return address || null;
  } catch {
    return null;
  }
}

export async function bridgeAppendSession(opts: {
  sessionId: string;
  files: PluginFile[];
}): Promise<{
  added: number;
  addedBytes: number;
  expectedFiles: number;
  expectedBytes: number;
} | null> {
  const p = plugin();
  if (!p) return null;
  try {
    return await p.appendSession(opts);
  } catch {
    return null;
  }
}

export async function bridgeEndSession(sessionId: string): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.endSession({ sessionId });
  } catch {
    /* la session peut déjà être terminée */
  }
}

export function bridgeSubscribe(
  handlers: Partial<{
    peerFound: (p: BridgePeer) => void;
    peerLost: (p: { id: string }) => void;
    peerReady: (e: BridgePeerReady) => void;
    sessionState: (e: BridgeSessionState) => void;
    sessionProgress: (e: BridgeSessionProgress) => void;
    sessionAppended: (e: BridgeSessionAppended) => void;
    sessionFileReceived: (e: BridgeSessionFileReceived) => void;
    sessionDone: (e: BridgeSessionDone) => void;
    sessionError: (e: BridgeSessionError) => void;
  }>,
): () => void {
  const p = plugin();
  if (!p) return () => {};
  const registrations: Promise<Handle>[] = [];
  const wire = <T>(event: string, cb?: (d: T) => void) => {
    if (!cb) return;
    const r = Promise.resolve(p.addListener(event, (d) => cb(d as T)));
    registrations.push(r);
  };
  wire("peerFound", handlers.peerFound);
  wire("peerLost", handlers.peerLost);
  wire("peerReady", handlers.peerReady);
  wire("sessionState", handlers.sessionState);
  wire("sessionProgress", handlers.sessionProgress);
  wire("sessionAppended", handlers.sessionAppended);
  wire("sessionFileReceived", handlers.sessionFileReceived);
  wire("sessionDone", handlers.sessionDone);
  wire("sessionError", handlers.sessionError);
  return () => {
    for (const r of registrations) {
      void r.then((h) => h.remove()).catch(() => {});
    }
  };
}
