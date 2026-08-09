/**
 * Onboarding gate for the MANAGE_EXTERNAL_STORAGE permission.
 *
 * Mounted **once** at the router root (see `src/routes/__root.tsx`),
 * so it never re-mounts on navigation and cannot flash between pages.
 *
 * The last known permission state is cached at module scope. Any
 * subsequent mount reads the cache synchronously and renders children
 * immediately — the re-check runs silently in the background and only
 * takes over the screen if the permission was actually revoked.
 *
 * On web / SSR / non-Android, renders children directly.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FolderLock, ShieldCheck, RefreshCcw } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import {
  checkAllFilesAccess,
  isAndroidNative,
  onStoragePermissionChanged,
  requestAllFilesAccess,
  type StoragePermissionState,
} from "@/lib/native/geniusfiles-native";

type Status = "checking" | StoragePermissionState;

/** Persist across remounts within the same session. */
let cachedStatus: Status | null = null;

function initialStatus(): Status {
  if (cachedStatus) return cachedStatus;
  if (!isAndroidNative()) {
    cachedStatus = "unavailable";
    return "unavailable";
  }
  // Optimistic: assume granted so navigation never shows the gate flash.
  // The real check runs in the background; if it comes back denied we
  // upgrade the screen. First-run users have no cache so we start on
  // "checking" (which renders as a neutral splash, not the deny screen).
  return "checking";
}

export function PermissionGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingSettingsReturn = useRef(false);
  const recheckTimers = useRef<number[]>([]);

  const clearRecheckTimers = () => {
    for (const id of recheckTimers.current) window.clearTimeout(id);
    recheckTimers.current = [];
  };

  useEffect(() => {
    if (!isAndroidNative()) return;
    let cancelled = false;

    const applyStatus = (
      s: StoragePermissionState,
      source: "initial" | "return" | "native" = "native",
    ) => {
      if (cancelled) return;
      cachedStatus = s;
      setStatus((prev) => (prev === s ? prev : s));
      if (s === "granted") {
        pendingSettingsReturn.current = false;
        clearRecheckTimers();
        setRequesting(false);
        setError(null);
        setNotice(null);
        window.dispatchEvent(new CustomEvent("gf:storage-changed"));
      } else if (source === "return" && pendingSettingsReturn.current) {
        pendingSettingsReturn.current = false;
        setRequesting(false);
        setError(null);
        setNotice(
          "L'accès n'est pas encore activé. GeniusFiles en a besoin pour ouvrir, déplacer et organiser vos fichiers.",
        );
      }
    };

    const check = (source: "initial" | "return" | "native" = "native") => {
      checkAllFilesAccess().then((s) => {
        applyStatus(s, source);
        if (s === "denied" && !pendingSettingsReturn.current) setRequesting(false);
      });
    };
    check("initial");

    const unsubNative = onStoragePermissionChanged((s) => applyStatus(s, "native"));
    let unsubApp: (() => void) | null = null;
    import("@capacitor/app")
      .then(({ App }) => {
        if (cancelled) return;
        const handle = App.addListener("appStateChange", (state) => {
          if (state.isActive) {
            recheckTimers.current.push(window.setTimeout(() => check("return"), 120));
            recheckTimers.current.push(window.setTimeout(() => check("return"), 600));
          }
        });
        unsubApp = () => {
          Promise.resolve(handle).then((h) => h?.remove?.());
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearRecheckTimers();
      unsubNative();
      unsubApp?.();
    };
  }, []);

  // Anything but "denied" renders the app. "checking" on first launch shows
  // a tiny neutral splash — never the permission wall.
  if (status === "granted" || status === "unavailable") {
    return <>{children}</>;
  }

  if (status === "checking" && !cachedStatus) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background">
        <Logo size={160} priority />
        <p className="text-sm font-medium tracking-wide text-muted-foreground">GeniusFiles</p>
      </div>
    );
  }

  // Denied (or checking with a previous "denied" cache): show the wall.
  const onGrant = async () => {
    if (requesting) return;
    setRequesting(true);
    setError(null);
    setNotice(null);
    const res = await requestAllFilesAccess();
    cachedStatus = res.state;
    setStatus(res.state);

    if (res.state === "granted") {
      pendingSettingsReturn.current = false;
      setRequesting(false);
      window.dispatchEvent(new CustomEvent("gf:storage-changed"));
      return;
    }

    if (!res.ok) {
      setError(
        res.message ??
          "Impossible d'ouvrir automatiquement les paramètres. Ouvrez les paramètres de GeniusFiles et activez l'accès aux fichiers.",
      );
      setRequesting(false);
      return;
    }

    if (res.openedSettings) {
      pendingSettingsReturn.current = true;
      setNotice(
        "Activez l'accès pour gérer tous les fichiers dans l'écran Android, puis revenez dans GeniusFiles.",
      );
    } else {
      pendingSettingsReturn.current = false;
      setNotice("L'autorisation n'est pas encore accordée. Activez-la pour ouvrir votre stockage.");
    }
    setTimeout(() => setRequesting(false), 1600);
  };

  const onRecheck = async () => {
    const s = await checkAllFilesAccess();
    cachedStatus = s;
    setStatus(s);
    setRequesting(false);
    if (s === "granted") {
      pendingSettingsReturn.current = false;
      setError(null);
      setNotice(null);
      window.dispatchEvent(new CustomEvent("gf:storage-changed"));
    } else {
      setNotice(
        "L'autorisation n'est pas encore active. GeniusFiles en a besoin pour afficher vos fichiers.",
      );
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col bg-background text-foreground px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Logo size={144} priority className="mb-6 " />

        <h1 className="text-2xl font-semibold tracking-tight text-gradient-brand">
          Bienvenue dans GeniusFiles
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Pour explorer, organiser et gérer vos fichiers, GeniusFiles a besoin de l'autorisation{" "}
          <strong className="text-foreground">« Accès à tous les fichiers et leur gestion »</strong>
          . Aucune autre autorisation ne sera demandée.
        </p>

        <ul className="mt-6 w-full space-y-3 text-left">
          <Bullet
            icon={FolderLock}
            title="Accès complet à votre stockage"
            desc="Nécessaire pour parcourir tous les dossiers de l'appareil, comme dans un vrai gestionnaire de fichiers."
          />
          <Bullet
            icon={ShieldCheck}
            title="Vos fichiers restent chez vous"
            desc="Aucune donnée n'est envoyée à l'extérieur. Tout se passe localement sur votre appareil."
          />
        </ul>

        <p className="mt-6 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          GeniusFiles doit accéder au stockage pour afficher, déplacer, copier et organiser vos
          fichiers. Sans cette autorisation, le gestionnaire de fichiers ne peut pas démarrer.
        </p>

        {notice ? (
          <p className="mt-3 rounded-xl border border-border bg-surface px-3 py-2 text-[12px] text-muted-foreground">
            {notice}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onGrant}
          disabled={requesting}
          className="mt-8 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-elevated transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {requesting ? "Ouverture en cours…" : "Ouvrir les paramètres d'autorisation"}
        </button>

        <button
          type="button"
          onClick={onRecheck}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <RefreshCcw className="h-3 w-3" /> Vérifier de nouveau
        </button>
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        GeniusFiles ne demande ni photos, ni musique, ni notifications.
      </p>
    </div>
  );
}

function Bullet({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof FolderLock;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-surface/60 p-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}
