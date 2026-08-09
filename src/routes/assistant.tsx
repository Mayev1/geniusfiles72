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
import { ArrowUp, Square, History, PenSquare, ShieldCheck, MessagesSquare } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { ConversationsSheet } from "@/components/assistant/ConversationsSheet";
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
import {
  chatOfflineCopy,
  EMPTY_ILLUSTRATION_FRAME,
  EMPTY_ILLUSTRATION_SRC,
} from "@/lib/copy/empty-illustrations";

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

/**
 * Étapes d'ouverture — jouées tant que le moteur n'a pas encore été
 * sollicité. Le dernier libellé reste affiché : jamais de temps mort.
 */
const THINK_SCRIPT = [
  "Compréhension de la demande…",
  "Préparation de la commande…",
  "Transmission au moteur…",
];

/** Étapes de sortie — après le moteur, avant le premier mot de réponse. */
const WRAP_SCRIPT = [
  "Traitement des résultats…",
  "Interprétation des résultats…",
  "Préparation de la réponse…",
];

/** Affiché pendant que la réponse s'écrit. */
const WRITING_LABEL = "Rédaction de la réponse…";

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
 * Réutilise l'illustration « Erreur réseau » déjà embarquée (aucune
 * ressource supplémentaire) et le même style typographique que les autres
 * écrans d'état. Apparition discrète : léger fondu + translation verticale.
 */
function ChatOfflineState({ onRetry }: { onRetry?: () => void }) {
  const copy = chatOfflineCopy();
  const src = EMPTY_ILLUSTRATION_SRC.network;
  const frame = EMPTY_ILLUSTRATION_FRAME.network;
  return (
    <div className="animate-fade-in flex flex-col items-center px-4 py-2 text-center">
      {src && frame ? (
        <div className="relative aspect-square w-[min(42vw,132px)] shrink-0 overflow-hidden">
          <img
            src={src}
            alt={copy.alt}
            width={1024}
            height={1536}
            decoding="async"
            draggable={false}
            style={{ left: `${frame.left}%`, top: `${frame.top}%`, width: `${frame.width}%` }}
            className="pointer-events-none absolute h-auto max-w-none select-none"
          />
        </div>
      ) : null}
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string>(() => newId());
  const endRef = useRef<HTMLDivElement | null>(null);
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
   * Étape unique affichée au-dessus de la réponse.
   * "thinking" → script d'ouverture ; libellé d'action → outil en cours ;
   * "wrap" → finalisation ; null → rien.
   */
  const stage = useMemo<string | null>(() => {
    // Le moteur est prioritaire : sa progression réelle reste affichée même
    // si le flux du modèle est momentanément au repos entre deux étapes.
    if (engineStage) return engineStage;
    if (!isBusy && !turnActive) return null;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant") return "thinking";
    const all = Array.isArray(last.parts) ? last.parts : [];
    const parts = all.filter((p) => p?.type?.startsWith("tool-")) as unknown as ToolPart[];
    const running = [...parts].reverse().find(isRunning);
    if (running) return ACTION_LABELS[commandOf(running)] ?? "Traitement en cours…";
    const hasText = all.some((p) => p?.type === "text" && p.text.length > 0);
    // Aucune période muette : tant que le tour n'est pas terminé, une
    // étape reste visible — y compris pendant la rédaction.
    if (hasText) return WRITING_LABEL;
    return parts.length > 0 ? "wrap" : "thinking";
  }, [isBusy, turnActive, engineStage, messages]);

  const bottomSpace = keyboardInset > 0 ? 12 : undefined;

  return (
    <AppShell>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden"
        style={{ marginBottom: keyboardInset || undefined }}
      >
        <header className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-1">
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-[22px] font-bold leading-tight tracking-tight text-foreground">
              Genius AI
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="Historique des conversations"
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95"
            >
              <History className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={startNew}
              aria-label="Nouvelle conversation"
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95"
            >
              <PenSquare className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <div className="gf-chat-safe min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain scroll-smooth px-4 pb-5">
          {messages.length === 0 ? (
            <Welcome />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {offlineBlocked ? <ChatOfflineState onRetry={() => handleSubmit()} /> : null}

          <StatusLine stage={stage} />

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
          className="shrink-0 bg-background/95 pt-1 backdrop-blur-sm"
          style={{
            paddingBottom:
              bottomSpace !== undefined
                ? bottomSpace
                : "calc(env(safe-area-inset-bottom) + 6.25rem)",
          }}
        >
          <div className="px-3">
            <TemplateMarquee onPick={pickTemplate} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="mx-3 mt-1.5 flex items-end gap-2 rounded-[26px] border border-border/70 bg-surface-elevated p-1.5 shadow-[0_6px_24px_-12px_rgba(0,0,0,0.6)]"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              rows={1}
              placeholder="Écrivez votre demande..."
              aria-label="Message"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck
              className="max-h-32 min-h-[44px] w-full min-w-0 flex-1 resize-none self-center bg-transparent px-3.5 py-[11px] text-[14.5px] leading-[22px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {isBusy ? (
              <button
                type="button"
                onClick={() => stop()}
                aria-label="Arrêter la réponse"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-transform duration-150 active:scale-95"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || (offlineBlocked && !isOnline)}
                aria-label="Envoyer"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </button>
            )}
          </form>
        </div>
      </div>

      <ConversationsSheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        activeId={conversationId}
        onOpenConversation={openConversation}
        onNewConversation={startNew}
      />
    </AppShell>
  );
}

/**
 * Ligne d'état unique : une seule étape visible à la fois, transitions en
 * fondu + léger déplacement vertical. Aucune information technique,
 * jamais de liste, jamais de temps mort — le dernier libellé reste
 * affiché tant que le travail continue, puis disparaît en fondu.
 */
function StatusLine({ stage }: { stage: string | null }) {
  const [label, setLabel] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!stage) {
      // Disparition progressive : on garde le dernier libellé le temps
      // du fondu, puis on démonte.
      setVisible(false);
      const t = setTimeout(() => setLabel(null), 260);
      return () => clearTimeout(t);
    }
    const script = stage === "thinking" ? THINK_SCRIPT : stage === "wrap" ? WRAP_SCRIPT : [stage];
    let i = 0;
    setLabel(script[0]);
    setVisible(true);
    if (script.length === 1) return;
    const timer = setInterval(() => {
      i += 1;
      // Le dernier libellé reste affiché : aucune période vide.
      if (i >= script.length) {
        clearInterval(timer);
        return;
      }
      setLabel(script[i]);
    }, 1600);
    return () => clearInterval(timer);
  }, [stage]);

  if (!label) return null;

  return (
    <div
      className="gf-chat-safe flex items-center gap-2.5 px-1 transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
      aria-live="polite"
    >
      <span className="flex shrink-0 gap-1">
        <Dot delay="0ms" />
        <Dot delay="140ms" />
        <Dot delay="280ms" />
      </span>
      <span
        key={label}
        className="gf-status-line min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground"
      >
        {label}
      </span>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
      style={{ animationDelay: delay, animationDuration: "1s" }}
    />
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
