/**
 * Fiche « paquet Android » (APK / AAB / XAPK).
 *
 * Montée une seule fois dans l'AppShell : tous les écrans qui listent des
 * fichiers ouvrent la même fiche via `openPackageSheet`, donc un .apk se
 * comporte exactement de la même façon depuis l'accueil, un dossier, une
 * catégorie, les récents ou la recherche.
 *
 * L'installation est une action Android réelle : l'installateur système est
 * lancé via un content:// (FileProvider). Rien n'est simulé — si Android
 * refuse, l'utilisateur voit la raison exacte.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Boxes, PackageCheck, PackageOpen, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { BottomSheet, PrimaryButton } from "./BottomSheet";
import { FileIcon } from "./FileIcon";
import { formatDate, formatSize } from "@/lib/files/format";
import {
  packageKindOf,
  packageLabel,
  packageLongLabel,
  type PackageKind,
} from "@/lib/files/package";
import {
  closePackageSheet,
  usePackageRequest,
  type PackageRequest,
} from "@/lib/files/package-sheet-store";
import { absolutePathOf } from "@/lib/viewer/source";
import { openWithSystem } from "@/lib/viewer/openWith";
import {
  canInstallPackages,
  installNativePackage,
  isAndroidNative,
  openInstallPermissionSettings,
  readPackageInfo,
  type NativePackageInfo,
} from "@/lib/native/geniusfiles-native";

type Phase = "idle" | "preparing" | "permission" | "launching" | "handoff" | "error";

export function PackageSheetHost() {
  const req = usePackageRequest();
  return <PackageSheet req={req} />;
}

function PackageSheet({ req }: { req: PackageRequest | null }) {
  const [info, setInfo] = useState<NativePackageInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const entry = req?.entry ?? null;
  const kind: PackageKind | null = entry ? packageKindOf(entry) : null;
  const path = req && entry ? absolutePathOf(req.parent, entry) : null;

  /* Métadonnées : lecture du seul manifeste du paquet, en arrière-plan.
     L'interface reste utilisable pendant ce temps. */
  useEffect(() => {
    setInfo(null);
    setPhase("idle");
    setMessage(null);
    pendingRef.current = false;
    if (!path || kind !== "apk" || !isAndroidNative()) return;
    let alive = true;
    void readPackageInfo(path).then((res) => {
      if (alive) setInfo(res);
    });
    return () => {
      alive = false;
    };
  }, [path, kind]);

  const launchInstall = useCallback(async () => {
    if (!path) return;
    setPhase("launching");
    setMessage(null);
    const res = await installNativePackage(path);
    if (res.ok) {
      setPhase("handoff");
      return;
    }
    if (res.reason === "needs_permission") {
      pendingRef.current = true;
      setPhase("permission");
      return;
    }
    setPhase("error");
    setMessage(res.message);
  }, [path]);

  const onInstall = useCallback(async () => {
    if (!path) return;
    setPhase("preparing");
    setMessage(null);
    const allowed = await canInstallPackages();
    if (!allowed) {
      pendingRef.current = true;
      setPhase("permission");
      return;
    }
    await launchInstall();
  }, [path, launchInstall]);

  /* Retour depuis les réglages Android : l'autorisation est revérifiée et
     l'installation reprend automatiquement — le fichier n'est pas perdu. */
  useEffect(() => {
    if (phase !== "permission") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !pendingRef.current) return;
      void canInstallPackages().then((allowed) => {
        if (!allowed || !pendingRef.current) return;
        pendingRef.current = false;
        void launchInstall();
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [phase, launchInstall]);

  if (!req || !entry || !kind) return <BottomSheet open={false} onClose={closePackageSheet} children={null} />;

  const invalid = kind === "apk" && info !== null && info.valid === false;
  const incompatible = kind === "apk" && info?.valid === true && info.compatible === false;

  return (
    <BottomSheet open onClose={closePackageSheet} title={packageLongLabel(kind)}>
      <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
        <FileIcon entry={entry} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">{entry.name}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {packageLabel(kind)} · {formatSize(entry.size ?? info?.size)} ·{" "}
            {formatDate(entry.mtime ?? info?.mtime)}
          </p>
        </div>
      </div>

      {info?.valid ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
          {info.label ? <Info label="Application" value={info.label} /> : null}
          {info.packageName ? <Info label="Paquet" value={info.packageName} /> : null}
          {info.versionName ? <Info label="Version" value={info.versionName} /> : null}
          {info.minSdk ? <Info label="Android min." value={`API ${info.minSdk}`} /> : null}
          {info.installed ? (
            <Info label="Déjà installée" value={info.installedVersionName || "oui"} />
          ) : null}
        </div>
      ) : null}

      {kind === "apk" ? (
        <ApkBody
          phase={phase}
          message={message}
          invalid={invalid}
          incompatible={incompatible}
          native={isAndroidNative()}
          onInstall={() => void onInstall()}
          onOpenSettings={() => void openInstallPermissionSettings()}
        />
      ) : (
        <PackageNotice kind={kind} />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {req.onExplore ? (
          <PrimaryButton
            variant="ghost"
            onClick={() => {
              const fn = req.onExplore;
              closePackageSheet();
              fn?.(entry);
            }}
          >
            Explorer le contenu
          </PrimaryButton>
        ) : null}
        <PrimaryButton
          variant="ghost"
          onClick={() => {
            void openWithSystem(req.parent, entry).catch(() => {
              toast.error("Aucune application compatible");
            });
          }}
        >
          Ouvrir avec…
        </PrimaryButton>
        <PrimaryButton variant="ghost" onClick={closePackageSheet}>
          Fermer
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}

function ApkBody({
  phase,
  message,
  invalid,
  incompatible,
  native,
  onInstall,
  onOpenSettings,
}: {
  phase: Phase;
  message: string | null;
  invalid: boolean;
  incompatible: boolean;
  native: boolean;
  onInstall: () => void;
  onOpenSettings: () => void;
}) {
  if (invalid) {
    return (
      <Notice tone="danger" icon={AlertTriangle} title="Paquet illisible">
        Ce fichier porte l'extension .apk mais son manifeste est invalide ou corrompu. Android ne
        peut pas l'installer.
      </Notice>
    );
  }

  if (phase === "permission") {
    return (
      <>
        <Notice tone="warn" icon={ShieldAlert} title="Autorisation Android requise">
          Android doit autoriser GeniusFiles à installer des applications. Ouvrez le réglage, activez
          l'autorisation puis revenez : l'installation reprendra automatiquement.
        </Notice>
        <div className="mt-3">
          <PrimaryButton onClick={onOpenSettings}>Ouvrir le réglage Android</PrimaryButton>
        </div>
      </>
    );
  }

  if (phase === "handoff") {
    return (
      <Notice tone="ok" icon={PackageCheck} title="Installateur Android ouvert">
        Terminez ou annulez l'installation dans la fenêtre système. GeniusFiles n'installe rien
        lui-même : seul Android décide du résultat.
      </Notice>
    );
  }

  if (phase === "error") {
    return (
      <Notice tone="danger" icon={AlertTriangle} title="Installation impossible">
        {message ?? "Une erreur inconnue est survenue."}
      </Notice>
    );
  }

  return (
    <>
      {incompatible ? (
        <Notice tone="warn" icon={AlertTriangle} title="Version d'Android insuffisante">
          Ce paquet cible une version d'Android plus récente que celle de cet appareil. Android
          refusera probablement l'installation.
        </Notice>
      ) : null}
      {!native ? (
        <Notice tone="warn" icon={PackageOpen} title="Aperçu web">
          L'installation d'applications est une action Android : elle s'exécute uniquement dans
          l'application compilée.
        </Notice>
      ) : null}
      <div className="mt-3">
        <PrimaryButton
          onClick={onInstall}
          disabled={!native || phase === "preparing" || phase === "launching"}
        >
          {phase === "preparing"
            ? "Préparation…"
            : phase === "launching"
              ? "Ouverture de l'installateur…"
              : "Installer l'application"}
        </PrimaryButton>
      </div>
    </>
  );
}

function PackageNotice({ kind }: { kind: PackageKind }) {
  if (kind === "aab") {
    return (
      <Notice tone="warn" icon={Boxes} title="Android App Bundle">
        Un AAB est un format de publication : Android ne peut pas l'installer directement comme un
        APK. GeniusFiles permet d'explorer son contenu, de l'extraire et de le partager.
      </Notice>
    );
  }
  return (
    <Notice tone="warn" icon={Boxes} title="Paquet XAPK">
      Un XAPK est un conteneur regroupant un APK et ses ressources. GeniusFiles ne réalise pas
      d'installation XAPK complète : explorez ou extrayez le contenu, puis installez l'APK qu'il
      contient.
    </Notice>
  );
}

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "ok" | "warn" | "danger";
  icon: typeof AlertTriangle;
  title: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "bg-primary-softer text-primary"
      : tone === "danger"
        ? "bg-destructive/10 text-destructive"
        : "bg-surface-2 text-muted-foreground";
  return (
    <div className={`mt-3 flex gap-2.5 rounded-2xl p-3 ${cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[12px] leading-snug opacity-90">{children}</p>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-2.5 py-1.5">
      <span className="block text-[10px] uppercase tracking-wide opacity-70">{label}</span>
      <span className="block truncate text-[12px] text-foreground">{value}</span>
    </div>
  );
}
