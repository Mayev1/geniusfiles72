/**
 * Transfert entre appareils — parcours utilisateur simplifié.
 *
 * Trois écrans principaux : accueil (Envoyer / Recevoir / Historique),
 * envoi (sélection de fichiers → session live avec QR + code) et
 * réception (scanner / code / recherche). Aucune donnée fictive : chaque
 * session possède un identifiant, un code court et un QR uniques,
 * générés dynamiquement, qui expirent à la fin ou à l'annulation.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FolderOpen,
  History,
  Keyboard,
  Loader2,
  Play,
  Pause,
  QrCode,
  RadioTower,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/navigation/BackButton";
import { BACK_PRIORITY, useBackHandler } from "@/lib/navigation/back-stack";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { QrDisplay } from "@/components/transfer/QrDisplay";
import { QrScanner } from "@/components/transfer/QrScanner";
import { ConfirmDialog, PrimaryButton, TextField } from "@/components/files/BottomSheet";
import { TransferPicker, type PickedItem } from "@/components/transfer/TransferPicker";
import { formatSize } from "@/lib/files/format";
import type { FileEntry } from "@/lib/files/types";
import { openNativeFile } from "@/lib/native/geniusfiles-native";
import {
  findDeviceByCode,
  listAllDevices,
  scanDevices,
  subscribeDevices,
} from "@/lib/transfer/discovery";
import { startHost, startJoin, type RunningTransfer } from "@/lib/transfer/engine";
import {
  clearHistory,
  listHistory,
  removeHistoryEntry,
  subscribeHistory,
} from "@/lib/transfer/history";
import { defaultInboxPath } from "@/lib/transfer/api";
import {
  attachHostToSession,
  createOutgoingSession,
  parseIncomingInvite,
  type IncomingSessionInvite,
  type OutgoingSession,
} from "@/lib/transfer/session";
import {
  getLocalName,
  isValidName,
  setLocalName,
  subscribeIdentity,
} from "@/lib/transfer/identity";
import type { DeviceInfo, HistoryEntry, TransferPlan, TransferSession } from "@/lib/transfer/types";
import {
  useSendStep,
  useReceiveStep,
  setSendStep,
  setReceiveStep,
  patchHostingSession,
  patchHostingOutgoing,
  patchReceiveSession,
  type SendStep,
  type ReceiveStep,
} from "@/lib/transfer/active";
import { Pencil } from "lucide-react";

export const Route = createFileRoute("/transfert")({
  head: () => ({
    meta: [
      { title: "Transfert entre appareils — GeniusFiles" },
      {
        name: "description",
        content: "Envoyez et recevez vos fichiers en quelques secondes, sans connexion Internet.",
      },
    ],
  }),
  component: TransfertRoute,
});

type Screen = { kind: "home" } | { kind: "send" } | { kind: "receive" } | { kind: "history" };

const SCREEN_META: Record<Screen["kind"], { title: string; subtitle: string }> = {
  home: {
    title: "Transfert",
    subtitle: "Envoyez et recevez sans Internet, d'un appareil à l'autre.",
  },
  send: { title: "Envoyer", subtitle: "Choisissez vos fichiers, un code apparaîtra." },
  receive: { title: "Recevoir", subtitle: "Scannez le code de l'autre appareil." },
  history: { title: "Historique", subtitle: "Vos envois et réceptions récents." },
};

function TransfertRoute() {
  const [screen, setScreen] = useState<Screen>({ kind: "home" });

  /* Retour Android : un sous-écran de l'outil revient à son accueil, puis
     seulement ensuite à l'écran précédent de l'application. */
  useBackHandler(
    screen.kind !== "home",
    () => {
      setScreen({ kind: "home" });
      return true;
    },
    BACK_PRIORITY.page,
  );

  const meta = SCREEN_META[screen.kind];

  return (
    <AppShell>
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        leading={
          screen.kind === "home" ? (
            <BackButton className="gf-press flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-muted-foreground hover:text-foreground" />
          ) : (
            <button
              type="button"
              onClick={() => setScreen({ kind: "home" })}
              aria-label="Retour au transfert"
              className="gf-press flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-[18px] w-[18px]" />
            </button>
          )
        }
      />

      <div key={screen.kind} className="animate-fade-in pt-3">
        {screen.kind === "home" ? (
          <HomeScreen onSelect={(k) => setScreen({ kind: k })} />
        ) : screen.kind === "send" ? (
          <SendScreen onDone={() => setScreen({ kind: "home" })} />
        ) : screen.kind === "receive" ? (
          <ReceiveScreen onDone={() => setScreen({ kind: "home" })} />
        ) : (
          <HistoryScreen />
        )}
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Accueil                                                            */
/* ------------------------------------------------------------------ */

function HomeScreen({ onSelect }: { onSelect: (k: "send" | "receive" | "history") => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => setCount(listHistory().length);
    refresh();
    return subscribeHistory(refresh);
  }, []);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <BigAction
          icon={<Send className="h-6 w-6" />}
          title="Envoyer"
          hint="Partager mes fichiers"
          onClick={() => onSelect("send")}
        />
        <BigAction
          icon={<RadioTower className="h-6 w-6" />}
          title="Recevoir"
          hint="Attendre un envoi"
          onClick={() => onSelect("receive")}
        />
      </div>

      <button
        onClick={() => onSelect("history")}
        className="gf-card gf-press flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-primary">
          <History className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold">Historique</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {count === 0
              ? "Aucun transfert pour le moment"
              : `${count} transfert${count > 1 ? "s" : ""} enregistré${count > 1 ? "s" : ""}`}
          </p>
        </div>
        <ArrowLeft className="h-4 w-4 shrink-0 rotate-180 text-muted-foreground" />
      </button>

      <p className="flex items-start gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-muted-foreground">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>Fonctionne hors ligne : la meilleure connexion est choisie automatiquement.</span>
      </p>
    </div>
  );
}

function BigAction({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="gf-card gf-press flex min-h-[132px] flex-col items-start justify-between gap-3 p-4 text-left"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-softer text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-display text-[18px] font-bold leading-tight">{title}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{hint}</p>
      </div>
    </button>
  );
}


/* ------------------------------------------------------------------ */
/* Envoyer                                                            */
/* ------------------------------------------------------------------ */

function SendScreen({ onDone }: { onDone: () => void }) {
  const step = useSendStep();
  const setStep = setSendStep;

  const startSession = useCallback((items: PickedItem[]) => {
    if (items.length === 0) return;
    const plan: TransferPlan = {
      items: items.map((it) => ({
        source: it.absolutePath,
        relPath: it.relPath,
        size: it.entry.isDirectory ? 0 : (it.entry.size ?? 0),
        isDirectory: it.entry.isDirectory,
      })),
      totalFiles: items.length,
      totalBytes: items.reduce((s, it) => s + (it.entry.isDirectory ? 0 : (it.entry.size ?? 0)), 0),
      destinationDeviceId: "pending",
      destinationDeviceName: "Destinataire",
      destinationPath: defaultInboxPath(),
      conflictPolicy: "rename",
      verify: true,
    };
    const outgoing = createOutgoingSession(plan);
    const handle = startHost({
      sessionId: outgoing.id,
      code: outgoing.code,
      plan,
      // Route updates through the singleton store so live progress
      // still flows into the UI even when the user has left `/transfert`.
      onServerReady: ({ host, port }) => {
        const next = attachHostToSession(outgoing, host, port);
        patchHostingOutgoing(next);
      },
      onUpdate: (s: TransferSession) => patchHostingSession(s),
    });
    setSendStep({ kind: "hosting", outgoing, handle, session: handle.session });
  }, []);

  const cancelSession = () => {
    if (step.kind === "hosting") step.handle.cancel();
    setStep({ kind: "intro" });
  };

  if (step.kind === "intro") {
    return (
      <div className="space-y-4">
        <IdentityBadge />
        <GuideCard
          title="Comment ça marche"
          steps={[
            "Choisissez vos fichiers.",
            "Validez la sélection.",
            "Un QR code et un code à 6 chiffres apparaissent.",
            "Le destinataire scanne le QR ou saisit le code.",
            "Le transfert démarre dès que la connexion est faite.",
          ]}
        />
        <div className="w-full [&>button]:w-full">
          <PrimaryButton onClick={() => setStep({ kind: "picker" })}>
            Choisir des fichiers
          </PrimaryButton>
        </div>
        <button
          onClick={onDone}
          className="w-full rounded-full py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Retour
        </button>
        <TransferPicker open={false} onCancel={() => {}} onConfirm={() => {}} />
      </div>
    );
  }

  if (step.kind === "picker") {
    return (
      <TransferPicker
        open
        onCancel={() => setStep({ kind: "intro" })}
        onConfirm={(items) => startSession(items)}
      />
    );
  }

  if (step.kind === "hosting") {
    const state = step.session.progress.state;
    // La page de connexion reste affichée tant que le destinataire n'a pas
    // rejoint ET accepté la session — c'est-à-dire tant que le transfert
    // n'a pas réellement démarré (state === "running").
    const isWaiting = state === "waiting-peer" || state === "preparing" || state === "handshaking";
    if (isWaiting) {
      return (
        <SendWaitingView
          outgoing={step.outgoing}
          peerName={step.session.peer?.name}
          state={state}
          onCancel={cancelSession}
        />
      );
    }
    if (state === "completed" || state === "cancelled" || state === "failed") {
      const entry: HistoryEntry = {
        id: step.session.id,
        role: "sender",
        peerName: step.session.peer.name,
        peerPlatform: step.session.peer.platform,
        transport: step.session.peer.transport,
        filesCount: step.session.plan.totalFiles,
        totalBytes: step.session.plan.totalBytes,
        startedAt: step.session.startedAt,
        endedAt: step.session.endedAt ?? Date.now(),
        durationMs: (step.session.endedAt ?? Date.now()) - step.session.startedAt,
        status: state === "completed" ? "success" : state === "cancelled" ? "cancelled" : "failed",
        verified: state === "completed",
        destinationPath: step.session.plan.destinationPath,
        errorMessage: state === "failed" ? step.session.progress.message : undefined,
      };
      return (
        <SummaryView
          entry={entry}
          onClose={onDone}
          onRetry={
            state === "failed"
              ? () => {
                  // Rebuild session with same plan and same files.
                  const items: PickedItem[] = step.session.plan.items.map((it) => ({
                    absolutePath: it.source,
                    relPath: it.relPath,
                    entry: {
                      name: it.relPath,
                      path: it.source,
                      size: it.size,
                      kind: it.isDirectory ? "folder" : "file",
                      isDirectory: it.isDirectory,
                    } as unknown as PickedItem["entry"],
                  }));
                  startSession(items);
                }
              : undefined
          }
        />
      );
    }
    return (
      <ProgressView
        session={step.session}
        handle={step.handle}
        onCancel={cancelSession}
        onFinished={(entry) => setStep({ kind: "summary", entry })}
      />
    );
  }

  return <SummaryView entry={step.entry} onClose={onDone} />;
}

function GuideCard({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="card-surface space-y-2 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
              {i + 1}
            </span>
            <span className="text-foreground/90">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SendWaitingView({
  outgoing,
  peerName,
  state,
  onCancel,
}: {
  outgoing: OutgoingSession;
  peerName?: string;
  state: "waiting-peer" | "preparing" | "handshaking";
  onCancel: () => void;
}) {
  const [waitingSince] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const iv = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - waitingSince) / 1000)),
      1000,
    );
    return () => window.clearInterval(iv);
  }, [waitingSince]);

  const hasAddress = !!(outgoing.host && outgoing.port);
  const items = outgoing.plan.items;
  const folderCount = items.filter((i) => i.isDirectory).length;
  const fileCount = items.length - folderCount;

  const hint =
    state === "handshaking"
      ? peerName && peerName !== "En attente…"
        ? `${peerName} confirme la réception…`
        : "Connexion établie, en attente d'acceptation…"
      : peerName && peerName !== "En attente…"
        ? `${peerName} rejoint la session…`
        : hasAddress
          ? "En attente du destinataire…"
          : "Prêt — le QR peut déjà être scanné.";

  return (
    <div className="space-y-3">
      <IdentityBadge />
      <div className="card-surface flex flex-col items-center gap-3 p-4">
        <QrDisplay value={outgoing.qrPayload} size={190} />
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Code de connexion
          </p>
          <p className="font-mono text-3xl font-semibold tracking-[0.35em] text-primary">
            {outgoing.code}
          </p>
        </div>
        <p className="text-center text-[12px] text-muted-foreground">
          Faites scanner ce QR ou communiquez ces chiffres au destinataire.
        </p>
      </div>

      <div className="card-surface grid grid-cols-3 gap-2 p-3 text-center">
        <div>
          <p className="text-[11px] text-muted-foreground">Sélection</p>
          <p className="text-lg font-semibold">
            {fileCount}
            {folderCount > 0 ? (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                + {folderCount} doss.
              </span>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Volume</p>
          <p className="text-lg font-semibold">{formatSize(outgoing.plan.totalBytes)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Attente</p>
          <p className="inline-flex items-center gap-1 text-lg font-semibold">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {formatDuration(elapsed)}
          </p>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="card-surface p-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            Contenu du transfert
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {items.slice(0, 20).map((it) => (
              <li key={it.source} className="flex items-center gap-2 text-[12px]">
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                    it.isDirectory ? "bg-primary/10 text-primary" : "bg-accent"
                  }`}
                >
                  {it.isDirectory ? (
                    <FolderOpen className="h-3.5 w-3.5" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {it.isDirectory ? `Dossier : ${it.relPath}` : it.relPath}
                </span>
                {!it.isDirectory ? (
                  <span className="text-[11px] text-muted-foreground">{formatSize(it.size)}</span>
                ) : null}
              </li>
            ))}
            {items.length > 20 ? (
              <li className="text-[11px] text-muted-foreground">… et {items.length - 20} autres</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="card-surface flex items-center gap-3 p-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div>
          <p className="text-sm font-medium">{hint}</p>
          <p className="text-[11px] text-muted-foreground">
            Le transfert démarrera une fois la demande acceptée.
          </p>
        </div>
      </div>

      <button
        onClick={onCancel}
        className="w-full rounded-full bg-destructive/10 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/20"
      >
        Annuler
      </button>
    </div>
  );
}

/** Badge affichant le nom local, avec édition rapide. */
function IdentityBadge() {
  const [name, setName] = useState(() => getLocalName());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeIdentity((id) => setName(id.name)), []);

  const save = () => {
    const res = setLocalName(draft);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="card-surface space-y-2 p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Votre nom d'appareil
        </p>
        <TextField
          value={draft}
          onChange={(v) => {
            setDraft(v);
            if (error && isValidName(v)) setError(null);
          }}
          placeholder="Ex. Genius_A7K92"
        />
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setDraft(name);
              setError(null);
              setEditing(false);
            }}
            className="flex-1 rounded-full bg-secondary py-2 text-sm"
          >
            Annuler
          </button>
          <div className="flex-1 [&>button]:w-full">
            <PrimaryButton onClick={save}>Enregistrer</PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      className="card-surface flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Users className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Votre appareil</p>
        <p className="truncate text-sm font-semibold">{name}</p>
      </div>
      <Pencil className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Progression (partagée envoi/réception)                             */
/* ------------------------------------------------------------------ */

function ProgressView({
  session,
  handle,
  onCancel,
  onFinished,
}: {
  session: TransferSession;
  handle: RunningTransfer;
  onCancel: () => void;
  onFinished: (entry: HistoryEntry) => void;
}) {
  const p = session.progress;
  const pct = p.bytesTotal > 0 ? Math.min(100, (p.bytesDone / p.bytesTotal) * 100) : 0;
  const filePct =
    p.currentFileBytesTotal && p.currentFileBytesTotal > 0
      ? Math.min(100, ((p.currentFileBytesDone ?? 0) / p.currentFileBytesTotal) * 100)
      : 0;
  const done = p.state === "completed" || p.state === "cancelled" || p.state === "failed";

  const finishedRef = useRef(false);
  useEffect(() => {
    if (done && !finishedRef.current) {
      finishedRef.current = true;
      onFinished({
        id: session.id,
        role: session.role,
        peerName: session.peer.name,
        peerPlatform: session.peer.platform,
        transport: session.peer.transport,
        filesCount: session.plan.totalFiles,
        totalBytes: session.plan.totalBytes,
        startedAt: session.startedAt,
        endedAt: session.endedAt ?? Date.now(),
        durationMs: (session.endedAt ?? Date.now()) - session.startedAt,
        status:
          p.state === "completed" ? "success" : p.state === "cancelled" ? "cancelled" : "failed",
        verified: p.state === "completed",
        destinationPath: session.plan.destinationPath,
        errorMessage: p.state === "failed" ? p.message : undefined,
      });
    }
  }, [done, onFinished, session, p.state, p.message]);

  const title =
    p.state === "handshaking"
      ? "Connexion en cours…"
      : p.state === "preparing"
        ? "Préparation…"
        : p.state === "paused"
          ? "En pause"
          : p.state === "verifying"
            ? "Vérification…"
            : "Transfert en cours";

  return (
    <div className="space-y-3">
      <div className="card-surface space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{title}</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {Math.round(pct)}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {formatSize(p.bytesDone)} / {formatSize(p.bytesTotal)}
          </span>
          <span>
            {p.filesDone}/{p.filesTotal} fichiers
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatSize(p.bytesPerSecond)}/s</span>
          <span>{p.etaSeconds > 0 ? `${formatDuration(p.etaSeconds)} restants` : "—"}</span>
        </div>
      </div>

      {p.currentFile ? (
        <div className="card-surface space-y-2 p-3">
          <p className="truncate text-xs">
            <span className="text-muted-foreground">Fichier en cours : </span>
            {p.currentFile}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary/70 transition-[width] duration-200"
              style={{ width: `${filePct}%` }}
            />
          </div>
        </div>
      ) : null}

      {!done ? (
        <div className="flex gap-2">
          {p.state === "paused" ? (
            <button
              onClick={() => handle.resume()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-sm font-medium"
            >
              <Play className="h-4 w-4" /> Reprendre
            </button>
          ) : (
            <button
              onClick={() => handle.pause()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-sm font-medium"
            >
              <Pause className="h-4 w-4" /> Pause
            </button>
          )}
          <button
            onClick={onCancel}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            <Square className="h-4 w-4" /> Annuler
          </button>
        </div>
      ) : null}

      {session.role === "sender" && !done ? <AppendToTransferButton handle={handle} /> : null}

      <TransferredFilesButton session={session} />
    </div>
  );
}

/**
 * Ouvre un TransferPicker pour empiler des fichiers dans la session en cours.
 * S'appuie sur le protocole v2 du plugin natif (message APPEND) pour
 * réutiliser le socket ouvert au lieu d'ouvrir une nouvelle session.
 */
function AppendToTransferButton({ handle }: { handle: RunningTransfer }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary/10 py-2 text-sm font-medium text-primary disabled:opacity-60"
      >
        <Send className="h-4 w-4" />
        {busy ? "Ajout en cours…" : "Ajouter au transfert en cours"}
      </button>
      {open ? (
        <TransferPicker
          open
          onCancel={() => setOpen(false)}
          onConfirm={(items: PickedItem[]) => {
            setOpen(false);
            if (items.length === 0) return;
            void (async () => {
              setBusy(true);
              const transferItems = items.map((it) => ({
                source: it.absolutePath,
                relPath: it.relPath,
                size: it.entry.size ?? 0,
                isDirectory: it.entry.kind === "folder",
              }));
              const ok = await handle.append(transferItems);
              setBusy(false);
              if (!ok) {
                toast.error("Impossible d'ajouter les fichiers à la session.");
              } else {
                toast.success(
                  `${items.length} élément${items.length > 1 ? "s" : ""} ajouté${items.length > 1 ? "s" : ""} au transfert.`,
                );
              }
            })();
          }}
        />
      ) : null}
    </>
  );
}

/** Bouton + panneau plein écran listant les fichiers du transfert avec état. */
function TransferredFilesButton({ session }: { session: TransferSession }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-secondary py-2 text-sm font-medium"
      >
        <FolderOpen className="h-4 w-4" />
        Voir les fichiers transférés
      </button>
      {open ? <TransferredFilesSheet session={session} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TransferredFilesSheet({
  session,
  onClose,
}: {
  session: TransferSession;
  onClose: () => void;
}) {
  const p = session.progress;
  const items = session.plan.items;
  const isSender = session.role === "sender";
  const received = session.receivedFiles ?? [];

  type Row = {
    name: string;
    size?: number;
    isDirectory: boolean;
    state: "done" | "current" | "pending";
    path?: string;
  };

  const rows: Row[] = isSender
    ? items.map((it, idx) => ({
        name: it.relPath,
        size: it.size,
        isDirectory: it.isDirectory,
        state:
          idx < p.filesDone
            ? "done"
            : it.relPath === p.currentFile || idx === p.filesDone
              ? "current"
              : "pending",
      }))
    : [
        ...received.map<Row>((f) => ({
          name: f.name,
          size: f.size,
          isDirectory: false,
          state: "done",
          path: f.path,
        })),
        ...(p.state !== "completed" &&
        p.currentFile &&
        !received.some((f) => f.name === p.currentFile)
          ? [
              {
                name: p.currentFile,
                size: p.currentFileBytesTotal,
                isDirectory: false,
                state: "current",
              } as Row,
            ]
          : []),
      ];

  const [openError, setOpenError] = useState<string | null>(null);
  const openRow = async (row: Row) => {
    if (!row.path) return;
    setOpenError(null);
    const res = await openNativeFile(row.path);
    if (!res.ok) setOpenError(res.message);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <button
          onClick={onClose}
          className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Fermer"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Fichiers transférés</p>
          <p className="text-[11px] text-muted-foreground">
            {isSender
              ? `${p.filesDone}/${session.plan.totalFiles} envoyés`
              : `${received.length} reçu${received.length > 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {openError ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {openError}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-3">
        {rows.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={isSender ? "Aucun fichier" : "En attente de réception"}
            description={
              isSender
                ? "Cette session ne contient pas de fichiers."
                : "Les fichiers apparaîtront ici au fur et à mesure."
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r, idx) => {
              const openable = !isSender && r.state === "done" && !!r.path;
              return (
                <li
                  key={`${r.name}-${idx}`}
                  className="flex items-center gap-3 rounded-xl border border-border/60 p-2.5"
                >
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      r.state === "done"
                        ? "bg-primary/10 text-primary"
                        : r.state === "current"
                          ? "bg-secondary text-foreground"
                          : "bg-secondary/50 text-muted-foreground"
                    }`}
                  >
                    {r.state === "done" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : r.state === "current" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : r.isDirectory ? (
                      <FolderOpen className="h-4 w-4" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {r.isDirectory ? `Dossier : ${r.name}` : r.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.isDirectory
                        ? "Arborescence complète"
                        : r.size !== undefined
                          ? formatSize(r.size)
                          : ""}
                      {r.size !== undefined ? " · " : ""}
                      {r.state === "done"
                        ? "Terminé"
                        : r.state === "current"
                          ? "En cours"
                          : "En attente"}
                    </p>
                  </div>
                  {openable ? (
                    <button
                      onClick={() => void openRow(r)}
                      className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-medium hover:bg-accent"
                    >
                      Ouvrir
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryView({
  entry,
  onClose,
  onRetry,
}: {
  entry: HistoryEntry;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const avg = entry.durationMs > 0 ? Math.round(entry.totalBytes / (entry.durationMs / 1000)) : 0;
  const ok = entry.status === "success";
  return (
    <div className="space-y-3">
      <div
        className={`card-surface flex flex-col items-center gap-2 p-6 text-center animate-scale-in ${
          ok ? "" : "opacity-95"
        }`}
      >
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            ok
              ? "bg-primary/10 text-primary"
              : entry.status === "cancelled"
                ? "bg-secondary text-muted-foreground"
                : "bg-destructive/10 text-destructive"
          }`}
        >
          {ok ? (
            <CheckCircle2 className="h-8 w-8" />
          ) : entry.status === "cancelled" ? (
            <Square className="h-8 w-8" />
          ) : (
            <XCircle className="h-8 w-8" />
          )}
        </span>
        <p className="text-lg font-semibold">
          {ok
            ? "Transfert terminé"
            : entry.status === "cancelled"
              ? "Transfert annulé"
              : "Transfert interrompu"}
        </p>
        {ok ? (
          <p className="text-[12px] text-muted-foreground">
            {entry.role === "receiver"
              ? `${entry.filesCount} fichier${entry.filesCount > 1 ? "s" : ""} reçu${entry.filesCount > 1 ? "s" : ""} (${formatSize(entry.totalBytes)})`
              : `${entry.filesCount} fichier${entry.filesCount > 1 ? "s" : ""} envoyé${entry.filesCount > 1 ? "s" : ""} (${formatSize(entry.totalBytes)})`}
          </p>
        ) : entry.errorMessage ? (
          <p className="text-[12px] text-destructive">{entry.errorMessage}</p>
        ) : null}
      </div>

      <div className="card-surface grid grid-cols-2 gap-3 p-3 text-center text-sm">
        <Stat label="Fichiers" value={String(entry.filesCount)} />
        <Stat label="Taille" value={formatSize(entry.totalBytes)} />
        <Stat label="Durée" value={formatDuration(Math.round(entry.durationMs / 1000))} />
        <Stat label="Vitesse moyenne" value={`${formatSize(avg)}/s`} />
      </div>

      {entry.destinationPath ? (
        <div className="card-surface p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dossier</p>
          <p className="mt-0.5 truncate font-mono text-[12px]">{entry.destinationPath}</p>
        </div>
      ) : null}

      <div className="flex gap-2">
        {ok && entry.role === "receiver" ? (
          <Link
            to="/"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
          >
            <FolderOpen className="h-4 w-4" />
            Ouvrir les fichiers
          </Link>
        ) : null}
        {onRetry ? (
          <button
            onClick={onRetry}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
          >
            <RefreshCw className="h-4 w-4" />
            Réessayer
          </button>
        ) : null}
        <button
          onClick={onClose}
          className="flex-1 rounded-full bg-secondary px-3 py-2.5 text-sm font-medium"
        >
          Terminer
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recevoir                                                           */
/* ------------------------------------------------------------------ */

function ReceiveScreen({ onDone }: { onDone: () => void }) {
  const step = useReceiveStep();
  const setStep = setReceiveStep;
  const [connecting, setConnecting] = useState<{ label: string } | null>(null);

  /**
   * Résout l'adresse du pair (mDNS) avec retries. Le QR peut avoir été
   * scanné avant que l'expéditeur n'ait fini d'ouvrir son serveur : dans
   * ce cas, on relance périodiquement la découverte mDNS jusqu'à
   * trouver le pair correspondant au code, sans jamais renvoyer d'erreur
   * immédiate.
   */
  const resolveInvite = async (
    invite: IncomingSessionInvite,
  ): Promise<IncomingSessionInvite | null> => {
    if (invite.host && invite.port) return invite;
    if (!invite.code) return null;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      // Kick une découverte mDNS et attend la propagation.
      try {
        await scanDevices(800);
      } catch {
        /* ignore */
      }
      const match = findDeviceByCode(invite.code) as (DeviceInfo & { code?: string }) | null;
      if (match?.address) {
        const [host, portStr] = match.address.split(":");
        const port = Number(portStr);
        if (host && Number.isFinite(port) && port > 0) {
          return {
            ...invite,
            host,
            port,
            address: match.address,
            senderName: match.name || invite.senderName,
          };
        }
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  };

  const accept = (invite: IncomingSessionInvite) => {
    setConnecting({ label: invite.senderName || "l'expéditeur" });
    void (async () => {
      const resolved = await resolveInvite(invite);
      if (!resolved) {
        setConnecting(null);
        toast.error(
          "Impossible de trouver l'expéditeur. Vérifiez que l'autre appareil est sur le même Wi-Fi.",
        );
        return;
      }
      const plan: TransferPlan = {
        items: [],
        totalFiles: resolved.filesCount ?? 0,
        totalBytes: resolved.totalBytes ?? 0,
        destinationDeviceId: getLocalName(),
        destinationDeviceName: getLocalName(),
        destinationPath: defaultInboxPath(),
        conflictPolicy: "rename",
        verify: true,
      };
      const handle = startJoin({
        invite: resolved,
        plan,
        onUpdate: (s: TransferSession) => patchReceiveSession(s),
      });
      setConnecting(null);
      setStep({ kind: "progress", handle, session: handle.session });
    })();
  };

  if (step.kind === "intro") {
    return (
      <div className="space-y-3">
        <GuideCard
          title="Comment recevoir"
          steps={[
            "Appuyez sur Scanner ou saisissez le code.",
            "Vérifiez la demande, puis acceptez.",
            "Attendez la fin du transfert.",
            "Retrouvez vos fichiers dans GeniusFiles.",
          ]}
        />
        <div className="grid grid-cols-1 gap-2">
          <ReceiveTile
            icon={<QrCode className="h-5 w-5" />}
            title="Scanner un code"
            hint="Ouvre la caméra pour lire le QR code."
            onClick={() => setStep({ kind: "scan" })}
          />
          <ReceiveTile
            icon={<Keyboard className="h-5 w-5" />}
            title="Saisir le code"
            hint="Utilisez le code affiché sur l'autre appareil."
            onClick={() => setStep({ kind: "code" })}
          />
          <ReceiveTile
            icon={<Search className="h-5 w-5" />}
            title="Rechercher les appareils à proximité"
            hint="GeniusFiles détecte automatiquement."
            onClick={() => setStep({ kind: "search" })}
          />
        </div>
        <button
          onClick={onDone}
          className="w-full rounded-full py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Retour
        </button>
      </div>
    );
  }

  if (step.kind === "scan") {
    return (
      <div className="space-y-3">
        <QrScanner
          onResult={(text) => {
            const inv = parseIncomingInvite(text);
            if (!inv) {
              toast.error("Code non reconnu");
              return;
            }
            setStep({ kind: "invite", invite: inv });
          }}
        />
        <button
          onClick={() => setStep({ kind: "intro" })}
          className="w-full rounded-full bg-secondary py-2 text-sm font-medium"
        >
          Annuler
        </button>
      </div>
    );
  }

  if (step.kind === "code") {
    return (
      <CodeEntryView
        onCancel={() => setStep({ kind: "intro" })}
        onSubmit={(inv) => setStep({ kind: "invite", invite: inv })}
      />
    );
  }

  if (step.kind === "search") {
    return (
      <SearchNearbyView
        onCancel={() => setStep({ kind: "intro" })}
        onPick={(peer) =>
          setStep({
            kind: "invite",
            invite: {
              id: peer.id,
              senderName: peer.name,
              transport: peer.transport,
              address: peer.address,
            },
          })
        }
      />
    );
  }

  if (step.kind === "invite") {
    return (
      <>
        <IncomingInviteView
          invite={step.invite}
          onDecline={() => setStep({ kind: "intro" })}
          onAccept={() => accept(step.invite)}
        />
        {connecting ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
            <div className="card-surface flex w-64 flex-col items-center gap-3 p-5 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-medium">Connexion à {connecting.label}…</p>
              <p className="text-[11px] text-muted-foreground">
                Assurez-vous que les deux appareils sont sur le même Wi-Fi.
              </p>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (step.kind === "progress") {
    return (
      <ProgressView
        session={step.session}
        handle={step.handle}
        onCancel={() => {
          step.handle.cancel();
          setStep({ kind: "intro" });
        }}
        onFinished={(entry) => setStep({ kind: "summary", entry })}
      />
    );
  }

  return <SummaryView entry={step.entry} onClose={onDone} />;
}

function ReceiveTile({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card-surface flex items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </button>
  );
}

function CodeEntryView({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (invite: IncomingSessionInvite) => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const inv = parseIncomingInvite(value.trim());
    if (!inv) {
      toast.error("Code non valide");
      return;
    }
    onSubmit(inv);
  };
  return (
    <div className="space-y-3">
      <div className="card-surface space-y-2 p-4">
        <p className="text-sm font-medium">Entrer le code de connexion</p>
        <p className="text-[11px] text-muted-foreground">
          Saisissez les 6 chiffres affichés sur l'appareil qui envoie.
        </p>
        <TextField value={value} onChange={setValue} placeholder="123 456" />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-full bg-secondary py-2.5 text-sm font-medium"
        >
          Annuler
        </button>
        <div className="flex-1 [&>button]:w-full">
          <PrimaryButton onClick={submit}>Continuer</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function SearchNearbyView({
  onCancel,
  onPick,
}: {
  onCancel: () => void;
  onPick: (peer: DeviceInfo) => void;
}) {
  const [peers, setPeers] = useState<DeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(() => setPeers(listAllDevices()), []);
  useEffect(() => {
    refresh();
    const un = subscribeDevices(refresh);
    setScanning(true);
    void scanDevices().finally(() => setScanning(false));
    return un;
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="card-surface flex items-center gap-3 p-3">
        {scanning ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <RadioTower className="h-5 w-5 text-primary" />
        )}
        <div>
          <p className="text-sm font-medium">Recherche en cours…</p>
          <p className="text-[11px] text-muted-foreground">
            Les appareils GeniusFiles à proximité apparaîtront ici.
          </p>
        </div>
        <button
          onClick={() => {
            setScanning(true);
            void scanDevices().finally(() => {
              setScanning(false);
              refresh();
            });
          }}
          className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Relancer la recherche"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {peers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucun appareil détecté"
          description="Assurez-vous que l'autre appareil ait ouvert GeniusFiles et lancé l'envoi."
        />
      ) : (
        <ul className="space-y-2">
          {peers.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onPick(p)}
                className="card-surface flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
                  <Users className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">À proximité</p>
                </div>
                <Send className="h-4 w-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={onCancel}
        className="w-full rounded-full bg-secondary py-2.5 text-sm font-medium"
      >
        Retour
      </button>
    </div>
  );
}

function IncomingInviteView({
  invite,
  onAccept,
  onDecline,
}: {
  invite: IncomingSessionInvite;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="card-surface flex flex-col items-center gap-2 p-5 text-center animate-scale-in">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Send className="h-6 w-6" />
        </span>
        <p className="text-sm text-muted-foreground">Demande de transfert</p>
        <p className="text-lg font-semibold">{invite.senderName}</p>
      </div>

      <div className="card-surface grid grid-cols-2 gap-3 p-3 text-center">
        <Stat label="Fichiers" value={invite.filesCount ? String(invite.filesCount) : "—"} />
        <Stat
          label="Taille totale"
          value={invite.totalBytes ? formatSize(invite.totalBytes) : "—"}
        />
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Les fichiers seront enregistrés dans <span className="font-mono">{defaultInboxPath()}</span>
      </p>

      <div className="flex gap-2">
        <button
          onClick={onDecline}
          className="flex-1 rounded-full bg-destructive/10 py-2.5 text-sm font-medium text-destructive"
        >
          Refuser
        </button>
        <div className="flex-1 [&>button]:w-full">
          <PrimaryButton onClick={onAccept}>Accepter</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Historique                                                         */
/* ------------------------------------------------------------------ */

function HistoryScreen() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState("");

  const refresh = useCallback(() => setEntries(listHistory()), []);
  useEffect(() => {
    refresh();
    return subscribeHistory(refresh);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.peerName.toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un appareil…"
            className="w-full rounded-full bg-secondary/60 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {entries.length ? (
          <button
            onClick={() => setConfirmClear(true)}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Vider l'historique"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title="Aucun transfert"
          description="Vos envois et réceptions apparaîtront ici."
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((e) => (
            <li key={e.id}>
              <div className="card-surface flex items-start gap-3 p-3">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                    e.status === "success"
                      ? "bg-primary/10 text-primary"
                      : e.status === "cancelled"
                        ? "bg-secondary text-muted-foreground"
                        : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {e.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : e.status === "cancelled" ? (
                    <Square className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {e.role === "sender" ? "Envoyé à " : "Reçu de "}
                    {e.peerName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {e.filesCount} fichiers · {formatSize(e.totalBytes)} ·{" "}
                    {formatDuration(Math.max(1, Math.round(e.durationMs / 1000)))}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(e.endedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => removeHistoryEntry(e.id)}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmClear}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          clearHistory();
          setConfirmClear(false);
        }}
        title="Vider l'historique ?"
        description="Cette action ne peut pas être annulée."
        confirmLabel="Vider"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                        */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}min${s > 0 ? ` ${s}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}min`;
}

// FileEntry n'est utilisé qu'à travers TransferPicker. On ré-exporte le type
// vide pour éviter les erreurs "imported but not used" quand tsgo est strict.
export type _Unused = FileEntry;
