import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  Square,
  Menu,
  PenSquare,
  ShieldCheck,
  MessagesSquare,
  WifiOff,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { AssistantDrawer } from "@/components/assistant/AssistantDrawer";
import {
  PipelineTrace,
  type PipelineStep,
  type PipelineState,
} from "@/components/assistant/PipelineTrace";
import { TemplateMarquee } from "@/components/assistant/TemplateMarquee";
import { chatApiUrl } from "@/lib/ai/api-url";
import { runEngineTool } from "@/lib/ai/tools/execute";
import { getEngineStage, subscribeEngineStage } from "@/lib/ai/tools/stage";
import { aiLog, chatFetch, describeChatError } from "@/lib/ai/diagnostics";

import {
  clearConversations,
  getActiveId,
  getConversation,
  newId,
  saveConversation,
  setActiveId,
} from "@/lib/ai/conversations";
import { useRoots } from "@/lib/fs/useRoots";
import { useViewportInset } from "@/hooks/use-viewport-inset";
import { errorMessage } from "@/lib/errors/humanize";
import { kbSentence } from "@/lib/keyboard-props";
import { chatOfflineCopy } from "@/lib/copy/empty-illustrations";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Genius AI — GeniusFiles" },
      {
        name: "description",
        content:
          "Discutez naturellement avec Genius AI ou demandez-lui de gérer vos fichiers : recherche, rangement, analyse et automatisations.",
      },
      { property: "og:title", content: "Genius AI — GeniusFiles" },
      {
        property: "og:description",
        content: "Discutez naturellement avec Genius AI ou demandez-lui de gérer vos fichiers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistantPage,
  errorComponent: AssistantError,
});

/**
 * Filet de sécurité local : si l'écran plante (conversation corrompue,
 * rendu inattendu), on reste dans Genius AI et on propose de repartir
 * d'une conversation vierge — au lieu de renvoyer vers l'erreur globale.
 */
function AssistantError({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[assistant] render error", error);
  return (
    <AppShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-lg font-bold text-foreground">
          Genius AI n'a pas pu s'afficher
        </h1>
        <p className="max-w-xs text-[13px] text-muted-foreground">
          Une conversation enregistrée semble illisible. Vous pouvez réessayer ou repartir d'une
          nouvelle conversation.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => reset()} className="btn-secondary gf-press">
            Réessayer
          </button>
          <button
            type="button"
            onClick={() => {
              clearConversations();
              reset();
            }}
            className="btn-primary gf-press"
          >
            Nouvelle conversation
          </button>
        </div>
      </div>
    </AppShell>
  );
}

/** Libellés d'avancement — jamais de chemin, de dossier ni de vocabulaire technique. */
const ACTION_LABELS: Record<string, string> = {
  list_storage_roots: "Lecture des emplacements…",
  list: "Lecture de vos dossiers…",
  search: "Recherche des fichiers…",
  analyze: "Analyse du stockage…",
  properties: "Lecture des informations…",
  create: "Création du dossier…",
  rename: "Renommage en cours…",
  delete: "Suppression en cours…",
  copy: "Copie des fichiers…",
  move: "Déplacement des fichiers…",
  organize: "Rangement des fichiers…",
  compress: "Compression en cours…",
  extract: "Extraction en cours…",
  share: "Préparation du partage…",
  sort: "Tri des fichiers…",
  filter: "Filtrage des fichiers…",
};

/** Libellés des étapes de la pipeline (aucun vocabulaire technique). */
const STEP_LABELS = {
  understand: "Compréhension de la demande",
  plan: "Analyse et planification",
  execute: "Exécution par le moteur local",
  verify: "Vérification des résultats",
  respond: "Rédaction de la réponse",
} as const;

type ToolPart = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function commandOf(part: ToolPart): string {
  const input = part.input as { type?: unknown } | undefined;
  return (input?.type as string | undefined) ?? part.type.replace(/^tool-/, "");
}

function isRunning(part: ToolPart): boolean {
  const s = part.state ?? "input-available";
  return s === "input-streaming" || s === "input-available" || s === "call" || s === "partial-call";
}

/** Connexion réseau de l'appareil, suivie en direct (aucun redémarrage requis). */
function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function useIsOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * État « hors connexion » affiché dans la conversation.
 *
 * Icône du système d'icônes de l'application (aucune ressource graphique)
 * et même style typographique que les autres écrans d'état. Apparition
 * discrète : léger fondu.
 */
function ChatOfflineState({ onRetry }: { onRetry?: () => void }) {
  const copy = chatOfflineCopy();
  return (
    <div className="animate-fade-in flex flex-col items-center px-4 py-2 text-center">
      <WifiOff
        aria-hidden="true"
        strokeWidth={1.5}
        className="h-10 w-10 shrink-0 text-muted-foreground"
      />
      <div className="mt-2 flex max-w-[320px] flex-col items-center gap-1.5">
        <p className="text-[17px] font-semibold leading-snug text-foreground">{copy.title}</p>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">{copy.description}</p>
        {onRetry ? (
          <div className="pt-3">
            <button type="button" onClick={onRetry} className="btn-secondary gf-press">
              {copy.retry}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantPage() {
  const [input, setInput] = useState("");
  const isOnline = useIsOnline();
  // Vrai uniquement après une tentative d'envoi hors connexion : l'état
  // disparaît dès le retour du réseau, sans redémarrage.
  const [offlineBlocked, setOfflineBlocked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string>(() => newId());
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Défilement automatique « intelligent » : on ne suit le flux que si
  // l'utilisateur est déjà en bas de la conversation.
  const atBottomRef = useRef(true);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const { roots } = useRoots();
  const rootsRef = useRef(roots);
  useEffect(() => {
    rootsRef.current = roots;
  }, [roots]);

  const { keyboardInset } = useViewportInset();

  // Étape réelle publiée par le moteur d'exécution pendant qu'il travaille.
  const engineStage = useSyncExternalStore(
    subscribeEngineStage,
    getEngineStage,
    () => null as string | null,
  );

  // L'URL de l'API est résolue au moment de la requête (et non au premier
  // rendu) : dans l'APK, le pont Capacitor peut ne pas encore être injecté
  // à l'hydratation, ce qui produirait une URL relative injoignable.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: chatApiUrl(),
        fetch: (input, init) => chatFetch(chatApiUrl(), init),
        body: () => ({
          storages: rootsRef.current.map((r) => ({
            rootId: r.id,
            label: r.label,
            hint: r.hint ?? null,
            available: r.available,
          })),
        }),
      }),
    [],
  );

  const chat = useChat({
    transport,

    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (err) => {
      aiLog("erreur assistant", err);
    },
    onToolCall: ({ toolCall }) => {
      const startedAt = Date.now();
      aiLog("commande moteur", { tool: toolCall.toolName, input: toolCall.input });
      const send = (output: unknown) => {
        aiLog("résultat moteur", { tool: toolCall.toolName, ms: Date.now() - startedAt });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chat.addToolOutput as any)({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output,
        });
      };
      // Une erreur du moteur ne doit jamais bloquer la conversation :
      // on renvoie un résultat d'échec lisible au lieu de rejeter.
      void runEngineTool(toolCall.toolName, toolCall.input)
        .then(send)
        .catch((err: unknown) => {
          console.error("[assistant] tool error", err);
          send({ ok: false, error: errorMessage(err, "Action impossible") });
        });
    },
  });
  const { messages, sendMessage, status, stop, error, setMessages, regenerate } = chat;

  const isBusy = status === "submitted" || status === "streaming";

  /**
   * Un tour reste « actif » de l'envoi jusqu'à la toute fin du traitement.
   * Cela couvre les micro-pauses du statut entre l'exécution d'une commande
   * moteur et la relance automatique du modèle : la ligne d'activité ne
   * redevient donc jamais vide en cours de route.
   */
  const [turnActive, setTurnActive] = useState(false);
  useEffect(() => {
    if (isBusy) {
      setTurnActive(true);
      return;
    }
    if (!turnActive) return;
    const t = setTimeout(() => setTurnActive(false), 450);
    return () => clearTimeout(t);
  }, [isBusy, turnActive]);

  // Reprise de la dernière conversation au montage.
  useEffect(() => {
    const active = getActiveId();
    if (!active) return;
    const conv = getConversation(active);
    if (conv && conv.messages.length) {
      setConversationId(conv.id);
      setMessages(conv.messages);
    }
  }, [setMessages]);

  // Sauvegarde locale à chaque fin de tour.
  useEffect(() => {
    if (!messages.length || isBusy) return;
    saveConversation(conversationId, messages);
    setActiveId(conversationId);
  }, [messages, isBusy, conversationId]);

  // Le défilement n'est JAMAIS forcé : l'utilisateur garde le contrôle de
  // sa position de lecture. On ne recentre qu'après un envoi manuel.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, []);

  const autoSize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, []);

  useEffect(() => {
    autoSize();
  }, [input, autoSize]);

  const handleSubmit = (e?: FormEvent) => {
    atBottomRef.current = true;
    e?.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    if (!navigator.onLine) {
      // Envoi bloqué : le texte saisi est intégralement conservé.
      setOfflineBlocked(true);
      requestAnimationFrame(scrollToEnd);
      return;
    }
    setOfflineBlocked(false);
    setInput("");
    setTurnActive(true);
    void sendMessage({ text });
    requestAnimationFrame(scrollToEnd);
  };

  useEffect(() => {
    if (isOnline) setOfflineBlocked(false);
  }, [isOnline]);

  const pickTemplate = (text: string) => {
    setInput(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  };

  const startNew = () => {
    const id = newId();
    setConversationId(id);
    setActiveId(id);
    setMessages([]);
    setInput("");
  };

  const openConversation = (id: string) => {
    const conv = getConversation(id);
    if (!conv) return;
    setConversationId(conv.id);
    setActiveId(conv.id);
    setMessages(conv.messages);
  };

  /**
   * Pipeline réelle du tour en cours.
   *
   * Chaque étape est déduite de l'état effectif du flux : message envoyé,
   * réflexion du modèle, commande transmise au moteur local (avec sa
   * progression réelle), reprise du modèle, puis rédaction. Les étapes
   * « exécution » et « vérification » n'apparaissent que si une commande a
   * réellement été demandée par le modèle.
   */
  const pipeline = useMemo<PipelineStep[]>(() => {
    if (!isBusy && !turnActive) return [];

    const last = messages[messages.length - 1];
    const all =
      last?.role === "assistant" && Array.isArray(last.parts) ? (last.parts as unknown[]) : [];
    const parts = all.filter(
      (p) => typeof (p as ToolPart)?.type === "string" && (p as ToolPart).type.startsWith("tool-"),
    ) as ToolPart[];
    const running = [...parts].reverse().find(isRunning);
    const failed = parts.find((p) => p.state === "output-error" || Boolean(p.errorText));
    const hasText = all.some(
      (p) =>
        (p as { type?: string; text?: string })?.type === "text" && !!(p as { text?: string }).text,
    );
    const finished = !isBusy;

    const steps: PipelineStep[] = [];
    const push = (id: string, label: string, state: PipelineState, detail?: string) => {
      steps.push({ id, label, state, detail });
    };

    const usesEngine = parts.length > 0 || Boolean(engineStage);

    if (last?.role !== "assistant") {
      push("understand", STEP_LABELS.understand, finished ? "done" : "active");
      push("plan", STEP_LABELS.plan, "pending");
      push("respond", STEP_LABELS.respond, "pending");
      return steps;
    }

    push("understand", STEP_LABELS.understand, "done");

    if (!usesEngine && !hasText) {
      push("plan", STEP_LABELS.plan, finished ? "done" : "active");
      push("respond", STEP_LABELS.respond, "pending");
      return steps;
    }

    push("plan", STEP_LABELS.plan, "done");

    if (usesEngine) {
      const detail =
        engineStage ?? (running ? (ACTION_LABELS[commandOf(running)] ?? undefined) : undefined);
      const execState: PipelineState = failed
        ? "failed"
        : running || (engineStage && !hasText)
          ? "active"
          : "done";
      push("execute", STEP_LABELS.execute, execState, detail);
      push(
        "verify",
        STEP_LABELS.verify,
        execState === "done" ? (hasText || finished ? "done" : "active") : "pending",
      );
    }

    push(
      "respond",
      STEP_LABELS.respond,
      hasText ? (finished ? "done" : "active") : finished ? "done" : "pending",
    );
    return steps;
  }, [isBusy, turnActive, engineStage, messages]);

  // Suivi du flux uniquement si l'utilisateur lit déjà le bas de l'écran.
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, pipeline]);

  const canSend = Boolean(input.trim()) && !(offlineBlocked && !isOnline);
  const bottomSpace = keyboardInset > 0 ? 12 : undefined;

  return (
    <AppShell>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden"
        style={{ marginBottom: keyboardInset || undefined }}
      >
        <header
          className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2.5 pb-2.5"
          style={{
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)",
            paddingLeft: "calc(env(safe-area-inset-left, 0px) + 0.625rem)",
            paddingRight: "calc(env(safe-area-inset-right, 0px) + 0.625rem)",
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Ouvrir le menu des conversations"
            aria-expanded={menuOpen}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-foreground transition-all duration-150 hover:bg-surface-2 active:scale-95"
          >
            <Menu className="h-[21px] w-[21px]" strokeWidth={2.1} />
          </button>
          <h1 className="font-display min-w-0 flex-1 truncate text-[19px] font-bold leading-tight tracking-tight text-foreground">
            Genius AI
          </h1>
          <button
            type="button"
            onClick={startNew}
            aria-label="Nouvelle conversation"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-foreground transition-all duration-150 hover:bg-surface-2 active:scale-95"
          >
            <PenSquare className="h-[19px] w-[19px]" strokeWidth={2.1} />
          </button>
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="gf-chat-safe min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-6"
          style={{
            paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
            paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
          }}
        >
          {messages.length === 0 ? (
            <Welcome />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {offlineBlocked ? <ChatOfflineState onRetry={() => handleSubmit()} /> : null}

          <PipelineTrace steps={pipeline} />

          {error ? (
            <div className="gf-chat-safe rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
              <p className="mb-2">{describeChatError(error)}</p>
              <button
                type="button"
                onClick={() => {
                  void regenerate();
                }}
                className="rounded-xl border border-destructive/40 bg-background/40 px-3 py-1.5 text-[12px] font-medium"
              >
                Réessayer
              </button>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <div
          className="shrink-0 border-t border-border/40 bg-background/95 pt-2 backdrop-blur-sm"
          style={{
            paddingBottom:
              bottomSpace !== undefined
                ? bottomSpace
                : "calc(env(safe-area-inset-bottom) + 6.25rem)",
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
          }}
        >
          <div className="px-3">
            <TemplateMarquee onPick={pickTemplate} />
          </div>

          <form
            onSubmit={handleSubmit}
            className={`mx-3 mt-2 flex items-end gap-2 rounded-[26px] border bg-surface-elevated p-1.5 transition-[border-color,box-shadow] duration-200 ${
              focused
                ? "border-primary/60 shadow-[0_8px_28px_-14px_rgba(0,0,0,0.75)]"
                : "border-border/70 shadow-[0_6px_24px_-16px_rgba(0,0,0,0.7)]"
            }`}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              rows={1}
              placeholder="Écrivez votre demande…"
              aria-label="Message"
              {...kbSentence}
              className="max-h-32 min-h-[46px] w-full min-w-0 flex-1 resize-none self-center bg-transparent px-3.5 py-[12px] text-[15px] leading-[22px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {isBusy ? (
              <button
                type="button"
                onClick={() => stop()}
                aria-label="Arrêter la réponse"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-transform duration-100 active:scale-90"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Envoyer"
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform,opacity] duration-100 active:scale-90 ${
                  canSend
                    ? "bg-primary text-primary-foreground"
                    : "cursor-not-allowed bg-secondary text-muted-foreground opacity-70"
                }`}
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </button>
            )}
          </form>
        </div>
      </div>

      <AssistantDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeId={conversationId}
        onOpenConversation={openConversation}
        onNewConversation={startNew}
      />
    </AppShell>
  );
}

function Welcome() {
  return (
    <div className="animate-in-up gf-chat-safe flex flex-col items-center pt-8 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-primary/15 blur-xl" />
        <span className="absolute inset-2 rounded-full border border-primary/25" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/15 text-primary">
          <MessagesSquare className="h-7 w-7" strokeWidth={1.9} />
        </span>
      </div>
      <h2 className="font-display mt-5 text-[21px] font-bold leading-tight tracking-tight">
        Bienvenue dans Genius AI
      </h2>
      <p className="mx-auto mt-2 max-w-[19rem] text-[13.5px] leading-relaxed text-muted-foreground">
        Discutez naturellement avec votre assistant et gérez vos fichiers par simple conversation.
      </p>

      <div className="mt-6 w-full rounded-3xl bg-primary/8 px-4 py-3.5 text-left">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.2} />
          Confidentialité garantie
        </p>
        <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <p>Vos fichiers restent exclusivement sur votre appareil.</p>
          <p>
            Genius AI ne consulte jamais directement votre stockage. Il comprend simplement votre
            demande et la transmet au moteur d'exécution local de GeniusFiles, qui réalise les
            actions demandées.
          </p>
          <p>
            Aucun fichier n'est envoyé vers un serveur ou une intelligence artificielle externe.
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const text = parts.map((p) => (p?.type === "text" ? p.text : "")).join("");

  if (isUser) {
    return (
      <div className="animate-in-up flex justify-end">
        <div className="gf-chat-safe max-w-[85%] rounded-[24px] rounded-br-lg bg-primary px-4 py-3 text-[14.5px] leading-relaxed text-primary-foreground">
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    );
  }

  // Le chat n'affiche que le texte : aucune carte, aucun lien, aucun
  // rendu de fichier. Les résultats du moteur sont reformulés par le modèle.
  if (!text) return null;

  return (
    <div className="animate-in-up gf-chat-safe">
      <div className="gf-chat-safe rounded-[24px] rounded-bl-lg bg-surface px-4 py-4">
        <SmoothText text={text} />
      </div>
    </div>
  );
}

/**
 * Nettoie une portion de markdown en cours de frappe.
 *
 * On coupe les marqueurs incomplets (`**`, `*`, `` ` ``, `#`) et les titres
 * ou puces à peine amorcés : la mise en page apparaît donc déjà correcte,
 * sans clignotement de syntaxe ni saut de ligne rétroactif.
 */
function stabilizeMarkdown(chunk: string): string {
  let out = chunk;
  // Titre ou puce commencé mais encore sans contenu → on l'attend.
  out = out.replace(/\n[#*\-\d.]{1,4}\s*$/u, "\n");
  // Marqueur d'emphase ou de code laissé ouvert en fin de flux.
  out = out.replace(/(\*{1,2}|`)+$/u, "");
  const bold = (out.match(/\*\*/g) ?? []).length;
  if (bold % 2 === 1) out = out.slice(0, out.lastIndexOf("**"));
  const ticks = (out.match(/`/g) ?? []).length;
  if (ticks % 2 === 1) out = out.slice(0, out.lastIndexOf("`"));
  return out;
}

/**
 * Révélation progressive du texte de l'assistant.
 *
 * Le contenu n'apparaît jamais d'un bloc : il se dévoile caractère par
 * caractère (vitesse adaptative), avec un fondu doux. Aucun saut visuel,
 * aucun re-flow brutal — la réponse « s'écrit ».
 */
function SmoothText({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  const target = text.length;

  useEffect(() => {
    if (shown >= target) return;
    // Plus il reste de texte, plus la révélation est rapide : la fin d'une
    // longue réponse n'attend jamais.
    const step = Math.max(2, Math.ceil((target - shown) / 18));
    const timer = setTimeout(() => setShown((s) => Math.min(target, s + step)), 16);
    return () => clearTimeout(timer);
  }, [shown, target]);

  useEffect(() => {
    // Nouveau message plus court (régénération) : on repart proprement.
    if (target < shown) setShown(target);
  }, [target, shown]);

  const raw = text.slice(0, shown);
  const visible = shown >= target ? text : stabilizeMarkdown(raw);
  return (
    <div className="gf-smooth-text">
      <AssistantMarkdown text={visible} />
    </div>
  );
}
