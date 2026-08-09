/**
 * Diagnostic et gestion d'erreurs de Genius AI.
 *
 * Objectifs :
 * - journaliser finement le cycle d'une requête IA (uniquement en dev) ;
 * - distinguer les causes réelles d'échec (réseau, délai, configuration,
 *   service indisponible, erreur interne) au lieu d'un message générique.
 */

const DEV = import.meta.env.DEV;

export function aiLog(event: string, data?: unknown) {
  if (!DEV) return;
  if (data === undefined) console.info(`[genius-ai] ${event}`);
  else console.info(`[genius-ai] ${event}`, data);
}

export type ChatFailureKind =
  | "offline"
  | "network"
  | "timeout"
  | "config"
  | "rate_limit"
  | "credits"
  | "unavailable"
  | "internal";

export class ChatRequestError extends Error {
  kind: ChatFailureKind;
  status?: number;
  detail?: string;

  constructor(kind: ChatFailureKind, message: string, status?: number, detail?: string) {
    super(message);
    this.name = "ChatRequestError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const MESSAGES: Record<ChatFailureKind, string> = {
  offline:
    "Aucune connexion Internet — Genius AI a besoin du réseau pour comprendre votre demande.",
  network:
    "Impossible de joindre Genius AI. Vérifiez votre connexion Internet, puis relancez la demande.",
  timeout: "Genius AI met trop de temps à répondre. Relancez la demande.",
  config:
    "Genius AI n'est pas correctement configuré sur ce serveur (service IA indisponible côté application).",
  rate_limit:
    "Trop de demandes envoyées coup sur coup. Patientez quelques secondes, puis relancez.",
  credits: "Le quota d'utilisation de l'IA est épuisé pour le moment.",
  unavailable: "Le service IA est temporairement indisponible. Réessayez dans un instant.",
  internal:
    "Le traitement a été interrompu avant la réponse finale. Les étapes déjà effectuées sont conservées — relancez pour reprendre.",
};

/** Message clair et exact affiché à l'utilisateur pour une erreur d'assistant. */
export function describeChatError(err: unknown): string {
  if (err instanceof ChatRequestError) return MESSAGES[err.kind];

  if (typeof navigator !== "undefined" && navigator.onLine === false) return MESSAGES.offline;

  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/abort|timeout/i.test(raw)) return MESSAGES.timeout;
  if (/failed to fetch|network|load failed|connexion/i.test(raw)) return MESSAGES.network;
  if (/LOVABLE_API_KEY|not configured/i.test(raw)) return MESSAGES.config;
  if (/429|rate.?limit/i.test(raw)) return MESSAGES.rate_limit;
  if (/402|credit/i.test(raw)) return MESSAGES.credits;
  return MESSAGES.internal;
}

const TIMEOUT_MS = 120_000;

/**
 * `fetch` instrumenté utilisé par le transport de chat :
 * délai maximal, journalisation dev, et erreurs typées.
 */
export async function chatFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const started = Date.now();

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ChatRequestError("offline", MESSAGES.offline);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const external = init?.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }

  if (DEV) {
    let preview: unknown = undefined;
    try {
      const body = init?.body;
      if (typeof body === "string") {
        const parsed = JSON.parse(body) as { messages?: unknown[]; storages?: unknown[] };
        preview = {
          messages: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
          storages: Array.isArray(parsed.storages) ? parsed.storages.length : 0,
        };
      }
    } catch {
      /* corps non JSON : ignoré */
    }
    aiLog("requête démarrée", { url, ...(preview as object) });
  }

  let response: Response;
  try {
    response = await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const aborted = controller.signal.aborted && !external?.aborted;
    const failure = aborted
      ? new ChatRequestError("timeout", MESSAGES.timeout)
      : typeof navigator !== "undefined" && navigator.onLine === false
        ? new ChatRequestError("offline", MESSAGES.offline)
        : new ChatRequestError(
            "network",
            MESSAGES.network,
            undefined,
            err instanceof Error ? err.message : String(err),
          );
    aiLog("échec réseau", {
      url,
      ms: Date.now() - started,
      kind: failure.kind,
      detail: failure.detail,
    });
    throw failure;
  }

  if (!response.ok) {
    clearTimeout(timer);
    const detail = await response.text().catch(() => "");
    const kind: ChatFailureKind =
      response.status === 429
        ? "rate_limit"
        : response.status === 402
          ? "credits"
          : response.status === 500 && /LOVABLE_API_KEY|not configured/i.test(detail)
            ? "config"
            : response.status === 404
              ? "config"
              : response.status >= 500
                ? "unavailable"
                : "internal";
    aiLog("réponse en erreur", { url, status: response.status, ms: Date.now() - started, detail });
    throw new ChatRequestError(kind, MESSAGES[kind], response.status, detail);
  }

  // Garde-fou APK : si l'URL de l'API n'est pas joignable, la WebView native
  // renvoie l'index.html du SPA avec un statut 200 → le flux serait illisible.
  const contentType = response.headers.get("content-type") ?? "";
  if (/text\/html/i.test(contentType)) {
    clearTimeout(timer);
    aiLog("réponse non conforme (HTML)", { url, contentType });
    throw new ChatRequestError(
      "config",
      MESSAGES.config,
      response.status,
      `Réponse HTML inattendue depuis ${url}`,
    );
  }

  aiLog("réponse reçue (flux ouvert)", { url, status: response.status, ms: Date.now() - started });

  // Le corps est un flux : on libère le minuteur quand il se termine.
  if (response.body) {
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async start(controllerOut) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controllerOut.enqueue(value);
          }
          controllerOut.close();
          clearTimeout(timer);
          aiLog("flux terminé", { url, ms: Date.now() - started });
        } catch (err) {
          clearTimeout(timer);
          aiLog("flux interrompu", { url, ms: Date.now() - started, error: err });
          controllerOut.error(err);
        }
      },
      cancel(reason?: unknown) {
        clearTimeout(timer);
        return reader.cancel(reason);
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  clearTimeout(timer);
  return response;
}
