/**
 * Moteur de transfert (côté TypeScript).
 *
 * Deux rôles, deux points d'entrée :
 *   - `startHost(plan, onUpdate)` : l'expéditeur ouvre le serveur natif,
 *     annonce la session en mDNS et retourne immédiatement l'adresse à
 *     encoder dans le QR. Le transfert démarre automatiquement dès qu'un
 *     pair se connecte et complète la poignée de main.
 *   - `startJoin({invite, plan, onUpdate})` : le destinataire se connecte
 *     au serveur de l'expéditeur.
 *
 * Les deux côtés reçoivent exactement les mêmes évènements natifs
 * (`peerReady`, `sessionState`, `sessionProgress`, `sessionDone`,
 * `sessionError`), donc leurs UI restent synchronisées.
 *
 * En preview web (aucun plugin), on garde une simulation courte pour que
 * l'UI puisse être testée sans APK, mais plus aucun peer factice n'est
 * proposé et le résumé final est identique aux appareils natifs.
 */
import { appendHistory } from "./history";
import {
  bridgeAppendSession,
  bridgeCancel,
  bridgeEndSession,
  bridgeHostSession,
  bridgeJoinSession,
  bridgePause,
  bridgeResume,
  bridgeSubscribe,
  isTransferNativeAvailable,
} from "./native-bridge";
import type {
  DeviceInfo,
  HistoryEntry,
  SessionState,
  TransferItem,
  TransferPlan,
  TransferProgress,
  TransferSession,
} from "./types";
import type { IncomingSessionInvite } from "./session";
import { defaultInboxPath } from "./api";
import { getDeviceId, getLocalName } from "./identity";

type Listener = (session: TransferSession) => void;

const CHECKPOINT_KEY = "gf.transfer.checkpoints";

function saveCheckpoint(sessionId: string, checkpoints: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CHECKPOINT_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, number>>) : {};
    all[sessionId] = checkpoints;
    window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function dropCheckpoint(sessionId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CHECKPOINT_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, number>>) : {};
    delete all[sessionId];
    window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function initialProgress(plan: TransferPlan): TransferProgress {
  return {
    state: "preparing",
    filesDone: 0,
    filesTotal: plan.totalFiles,
    bytesDone: 0,
    bytesTotal: plan.totalBytes,
    bytesPerSecond: 0,
    etaSeconds: 0,
  };
}

export interface RunningTransfer {
  session: TransferSession;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  /** Relance la même session (mêmes checkpoints). */
  retry: () => void;
  /**
   * Ajoute des fichiers à la session en cours. Réservé au rôle
   * "sender" : renvoie `false` si la session n'est plus active.
   */
  append: (items: TransferItem[]) => Promise<boolean>;
  /** Termine proprement la session sans annuler (side effect: END au pair). */
  end: () => Promise<void>;
  waitForDone: () => Promise<TransferSession>;
}

export interface StartHostOptions {
  sessionId: string;
  code: string;
  plan: TransferPlan;
  onUpdate: Listener;
  /** Adresse retournée par le natif — sert à générer le QR. */
  onServerReady?: (info: { host: string; port: number }) => void;
}

export interface StartJoinOptions {
  invite: IncomingSessionInvite;
  plan: TransferPlan;
  onUpdate: Listener;
}

/* ------------------------------------------------------------------ */
/* Envoi natif — l'expéditeur ouvre le serveur                        */
/* ------------------------------------------------------------------ */

export function startHost(opts: StartHostOptions): RunningTransfer {
  if (isTransferNativeAvailable()) return startNativeHost(opts);
  return startSimulatedHost(opts);
}

export function startJoin(opts: StartJoinOptions): RunningTransfer {
  if (isTransferNativeAvailable() && opts.invite.host && opts.invite.port) {
    return startNativeJoin(opts);
  }
  return startSimulatedJoin(opts);
}

function makePeerFromInvite(invite: IncomingSessionInvite): DeviceInfo {
  return {
    id: invite.senderDeviceId ?? invite.id,
    name: invite.senderName,
    platform: "android",
    transport: invite.transport,
    address:
      invite.address ?? (invite.host && invite.port ? `${invite.host}:${invite.port}` : undefined),
    discovered: true,
    lastSeen: Date.now(),
    signal: 1,
  };
}

function startNativeHost(opts: StartHostOptions): RunningTransfer {
  const { plan, onUpdate, sessionId, code } = opts;
  const session: TransferSession = {
    id: sessionId,
    role: "sender",
    peer: {
      id: "pending",
      name: "En attente…",
      platform: "unknown",
      transport: "wifi-lan",
      discovered: false,
      lastSeen: Date.now(),
    },
    plan,
    startedAt: Date.now(),
    progress: { ...initialProgress(plan), state: "waiting-peer" },
    resumeCheckpoints: {},
  };

  const runner = createRunner(session, onUpdate);

  runner.push({ state: "waiting-peer", message: "En attente du destinataire…" });

  const files = plan.items
    .filter((it) => !it.isDirectory)
    .map((it) => ({ source: it.source, relPath: it.relPath }));

  void bridgeHostSession({
    sessionId,
    code,
    name: getLocalName(),
    verify: plan.verify,
    files,
  })
    .then((r) => {
      opts.onServerReady?.({ host: r.host, port: r.port });
    })
    .catch((err) => {
      runner.finish(
        "failed",
        false,
        err instanceof Error ? err.message : "Ouverture du serveur impossible",
      );
    });

  return runner.handle;
}

function startNativeJoin(opts: StartJoinOptions): RunningTransfer {
  const { invite, plan, onUpdate } = opts;
  const sessionId = invite.id;
  const peer = makePeerFromInvite(invite);
  const session: TransferSession = {
    id: sessionId,
    role: "receiver",
    peer,
    plan,
    startedAt: Date.now(),
    progress: { ...initialProgress(plan), state: "handshaking" },
    resumeCheckpoints: {},
  };

  const runner = createRunner(session, onUpdate);
  runner.push({ state: "handshaking", message: "Connexion à l'expéditeur…" });

  void bridgeJoinSession({
    sessionId,
    host: invite.host!,
    port: invite.port!,
    name: getLocalName(),
    deviceId: getDeviceId(),
    inbox: plan.destinationPath || defaultInboxPath(),
  }).catch((err) => {
    runner.finish("failed", false, err instanceof Error ? err.message : "Connexion refusée");
  });

  return runner.handle;
}

/**
 * Boilerplate commun aux runners natifs : abonnement aux évènements du
 * plugin, mise à jour de la progression, écriture de l'historique.
 */
function createRunner(session: TransferSession, onUpdate: Listener) {
  const sessionId = session.id;
  let done = false;
  let resolveDone: (s: TransferSession) => void = () => {};
  const donePromise = new Promise<TransferSession>((res) => {
    resolveDone = res;
  });
  /**
   * Timer d'auto-clôture : quand tous les fichiers annoncés ont été
   * transférés, on laisse ~1,5 s pour permettre à l'expéditeur d'ajouter
   * un lot supplémentaire avant d'envoyer END au récepteur.
   */
  let autoEndTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelAutoEnd = () => {
    if (autoEndTimer) {
      clearTimeout(autoEndTimer);
      autoEndTimer = null;
    }
  };
  const scheduleAutoEnd = () => {
    if (session.role !== "sender" || done) return;
    cancelAutoEnd();
    autoEndTimer = setTimeout(() => {
      void bridgeEndSession(sessionId);
    }, 1500);
  };

  const push = (patch: Partial<TransferProgress>) => {
    session.progress = { ...session.progress, ...patch };
    onUpdate({ ...session });
  };

  const finish = (status: HistoryEntry["status"], verified: boolean, errorMessage?: string) => {
    if (done) return;
    done = true;
    cancelAutoEnd();
    session.endedAt = Date.now();
    session.progress = {
      ...session.progress,
      state: status === "success" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
      bytesPerSecond: 0,
      etaSeconds: 0,
      message: errorMessage,
    };
    onUpdate({ ...session });
    dropCheckpoint(sessionId);

    appendHistory({
      id: sessionId,
      role: session.role,
      peerName: session.peer.name,
      peerPlatform: session.peer.platform,
      transport: session.peer.transport,
      filesCount: session.plan.totalFiles,
      totalBytes: session.plan.totalBytes,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.endedAt - session.startedAt,
      status,
      verified,
      destinationPath: session.plan.destinationPath,
      errorMessage,
    });
    if (status === "success" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gf:storage-changed"));
      window.dispatchEvent(new CustomEvent("gf:transfer-completed"));
    }
    resolveDone(session);
    unsub();
  };

  const unsub = bridgeSubscribe({
    peerReady: (e) => {
      if (e.sessionId !== sessionId) return;
      if (session.role === "sender") {
        session.peer = { ...session.peer, name: e.peerName, id: e.peerDeviceId ?? session.peer.id };
      }
      push({ state: "handshaking", message: `${e.peerName} rejoint la session…` });
    },
    sessionState: (e) => {
      if (e.sessionId !== sessionId) return;
      push({ state: e.state as SessionState, message: undefined });
    },
    sessionProgress: (e) => {
      if (e.sessionId !== sessionId) return;
      const filesTotal = e.filesTotal || session.plan.totalFiles;
      push({
        state: "running",
        bytesDone: e.bytesDone,
        bytesTotal: e.bytesTotal || session.plan.totalBytes,
        filesDone: e.filesDone,
        filesTotal,
        currentFile: e.currentFile,
        currentFileBytesDone: e.currentFileBytesDone,
        currentFileBytesTotal: e.currentFileBytesTotal,
        bytesPerSecond: e.bytesPerSecond,
        etaSeconds: e.etaSeconds,
      });
      const cps = session.resumeCheckpoints ?? {};
      cps[e.currentFile] = e.currentFileBytesDone;
      session.resumeCheckpoints = cps;
      saveCheckpoint(sessionId, cps);
      if (e.filesDone >= filesTotal && e.bytesDone >= (e.bytesTotal || session.plan.totalBytes)) {
        scheduleAutoEnd();
      }
    },
    sessionAppended: (e) => {
      if (e.sessionId !== sessionId) return;
      cancelAutoEnd();
      session.plan = {
        ...session.plan,
        totalFiles: e.expectedFiles,
        totalBytes: e.expectedBytes,
      };
      push({
        filesTotal: e.expectedFiles,
        bytesTotal: e.expectedBytes,
        message: `${e.filesAdded} fichier${e.filesAdded > 1 ? "s" : ""} ajouté${e.filesAdded > 1 ? "s" : ""} au transfert`,
      });
    },
    sessionFileReceived: (e) => {
      if (e.sessionId !== sessionId) return;
      const list = session.receivedFiles ?? [];
      list.push({ name: e.name, size: e.size, path: e.path });
      session.receivedFiles = list;
      onUpdate({ ...session });
    },
    sessionDone: (e) => {
      if (e.sessionId !== sessionId) return;
      finish("success", e.verified);
    },
    sessionError: (e) => {
      if (e.sessionId !== sessionId) return;
      const cancelled = /cancel/i.test(e.message);
      finish(cancelled ? "cancelled" : "failed", false, cancelled ? undefined : e.message);
    },
  });

  const handle: RunningTransfer = {
    session,
    pause: () => void bridgePause(sessionId),
    resume: () => void bridgeResume(sessionId),
    cancel: () => void bridgeCancel(sessionId),
    retry: () => {
      // Retry effectif : géré par l'UI qui reconstruit un runner avec les
      // mêmes checkpoints. Ici on rend juste explicite la primitive.
    },
    append: async (items) => {
      if (done || session.role !== "sender") return false;
      cancelAutoEnd();
      const files = items
        .filter((it) => !it.isDirectory)
        .map((it) => ({ source: it.source, relPath: it.relPath }));
      if (files.length === 0) return false;
      const res = await bridgeAppendSession({ sessionId, files });
      if (!res) return false;
      // On met à jour le plan localement dès l'appel : l'évènement natif
      // suivra pour confirmer et rafraîchir l'UI.
      session.plan = {
        ...session.plan,
        items: [...session.plan.items, ...items],
        totalFiles: res.expectedFiles,
        totalBytes: res.expectedBytes,
      };
      onUpdate({ ...session });
      return true;
    },
    end: async () => {
      cancelAutoEnd();
      await bridgeEndSession(sessionId);
    },
    waitForDone: () => donePromise,
  };

  return { handle, push, finish };
}

/* ------------------------------------------------------------------ */
/* Simulation (preview web) — sans données fictives                   */
/* ------------------------------------------------------------------ */

function startSimulatedHost(opts: StartHostOptions): RunningTransfer {
  return simulate("sender", opts.plan, opts.onUpdate, opts.sessionId, () => {
    opts.onServerReady?.({ host: "192.0.2.1", port: 45123 });
  });
}

function startSimulatedJoin(opts: StartJoinOptions): RunningTransfer {
  return simulate("receiver", opts.plan, opts.onUpdate, opts.invite.id);
}

function simulate(
  role: "sender" | "receiver",
  plan: TransferPlan,
  onUpdate: Listener,
  id: string,
  afterStart?: () => void,
): RunningTransfer {
  const session: TransferSession = {
    id,
    role,
    peer: {
      id: "sim",
      name: "Appareil de démonstration",
      platform: "android",
      transport: "wifi-lan",
      discovered: false,
      lastSeen: Date.now(),
    },
    plan,
    startedAt: Date.now(),
    progress: initialProgress(plan),
    resumeCheckpoints: {},
  };
  let paused = false;
  let cancelled = false;
  let done = false;
  let resolveDone: (s: TransferSession) => void = () => {};
  const donePromise = new Promise<TransferSession>((res) => {
    resolveDone = res;
  });

  const push = (patch: Partial<TransferProgress>) => {
    session.progress = { ...session.progress, ...patch };
    onUpdate({ ...session });
  };
  const finish = (status: HistoryEntry["status"], verified: boolean, msg?: string) => {
    if (done) return;
    done = true;
    session.endedAt = Date.now();
    session.progress = {
      ...session.progress,
      state: status === "success" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
      bytesPerSecond: 0,
      etaSeconds: 0,
      message: msg,
    };
    onUpdate({ ...session });
    appendHistory({
      id,
      role,
      peerName: session.peer.name,
      peerPlatform: session.peer.platform,
      transport: session.peer.transport,
      filesCount: plan.totalFiles,
      totalBytes: plan.totalBytes,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.endedAt - session.startedAt,
      status,
      verified,
      destinationPath: plan.destinationPath,
      errorMessage: msg,
    });
    resolveDone(session);
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const run = async () => {
    afterStart?.();
    push({ state: "handshaking" });
    await wait(500);
    if (cancelled) return finish("cancelled", false);
    push({ state: "running" });
    let bytes = 0;
    const startedAt = Date.now();
    for (let i = 0; i < plan.items.length; i++) {
      if (cancelled) return finish("cancelled", false);
      const item = plan.items[i];
      let fileBytes = 0;
      const speed = 12_000_000;
      const step = Math.max(64 * 1024, Math.floor(speed * 0.12));
      while (fileBytes < item.size) {
        if (cancelled) return finish("cancelled", false);
        while (paused && !cancelled) {
          push({ state: "paused" });
          await wait(200);
        }
        if (session.progress.state !== "running") push({ state: "running" });
        await wait(120);
        const delta = Math.min(step, item.size - fileBytes);
        fileBytes += delta;
        bytes += delta;
        const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
        const bps = Math.floor(bytes / elapsed);
        const remaining = Math.max(0, plan.totalBytes - bytes);
        push({
          bytesDone: bytes,
          bytesPerSecond: bps,
          etaSeconds: bps > 0 ? Math.round(remaining / bps) : 0,
          currentFile: item.relPath,
          currentFileBytesDone: fileBytes,
          currentFileBytesTotal: item.size,
        });
      }
      push({ filesDone: i + 1 });
    }
    if (plan.verify) {
      push({ state: "verifying" });
      await wait(400);
    }
    finish("success", plan.verify);
  };

  void run();

  return {
    session,
    pause: () => {
      if (!done) paused = true;
    },
    resume: () => {
      if (!done) paused = false;
    },
    cancel: () => {
      cancelled = true;
      paused = false;
    },
    retry: () => {},
    append: async () => false,
    end: async () => {},
    waitForDone: () => donePromise,
  };
}
