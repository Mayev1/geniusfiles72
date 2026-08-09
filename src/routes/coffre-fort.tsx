/**
 * Coffre-fort sécurisé — main route.
 *
 * Three UI states, resolved in this order:
 *   1. Not configured → setup wizard (choose method, set secret, biometric opt-in).
 *   2. Configured + locked → lock screen (secret input + optional biometric).
 *   3. Configured + unlocked → vault browser (folders, favorites, search, sort,
 *      inline previewer, add / restore / permanent delete).
 *
 * The physical file storage lives under a dot-prefixed `.GeniusFilesVault`
 * folder on native devices — the shared `listDirectory` filter in
 * `src/lib/files/fs.ts` already hides dot-prefixed entries from every
 * public listing, so nothing extra is needed to make protected files
 * disappear from Fichiers, Galerie, Recherche or Nettoyeur.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpDown,
  ChevronRight,
  Clock,
  FileText as FileTextIcon,
  Fingerprint,
  Folder,
  FolderPlus,
  KeyRound,
  Lock,
  LockKeyhole,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  SquarePen,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BACK_PRIORITY, useBackHandler } from "@/lib/navigation/back-stack";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { IllustratedEmptyState } from "@/components/ui/IllustratedEmptyState";
import { useConfirm } from "@/components/common/useConfirm";
import { confirmCopy, countLabel } from "@/lib/copy";
import { errorMessage } from "@/lib/errors/humanize";
import {
  BottomSheet,
  ConfirmDialog,
  NamePrompt,
  PrimaryButton,
} from "@/components/files/BottomSheet";
import { FileIcon } from "@/components/files/FileIcon";
import { DestinationPicker } from "@/components/files/DestinationPicker";
import { ProgressDialog } from "@/components/files/ProgressDialog";
import { VaultAddPicker } from "@/components/vault/VaultAddPicker";
import { VaultPreview } from "@/components/vault/VaultPreview";
import { formatDate, formatSize } from "@/lib/files/format";
import {
  addFromPublic,
  createFolder,
  deleteEmptyFolder,
  favorites as vaultFavorites,
  findFolder,
  folderPath,
  listVault,
  moveItemsToFolder,
  permanentDelete,
  renameFolder,
  restoreItems,
  searchAll,
  sortItems,
  toggleFavorite,
  usageVault,
  wipeVault,
} from "@/lib/vault/api";
import {
  isVaultConfigured,
  isBiometricAvailable,
  isBiometricEnabled,
  resetCredential,
  setBiometricEnabled,
  setupVault,
  verifyBiometric,
  verifySecret,
} from "@/lib/vault/auth";
import {
  AUTO_LOCK_OPTIONS,
  loadAutoLockMs,
  loadLockOnBackground,
  loadVaultSort,
  saveAutoLockMs,
  saveLockOnBackground,
  saveVaultSort,
} from "@/lib/vault/preferences";
import {
  bumpActivity,
  isVaultUnlocked,
  lockSession,
  markUnlocked,
  subscribeSession,
} from "@/lib/vault/session";
import type {
  PublicSource,
  VaultAuthMethod,
  VaultFolder,
  VaultItem,
  VaultProgress,
  VaultSortKey,
  VaultSortOrder,
} from "@/lib/vault/types";
import type { PathRef } from "@/lib/files/types";

export const Route = createFileRoute("/coffre-fort")({
  head: () => ({
    meta: [
      { title: "Coffre-fort — GeniusFiles" },
      {
        name: "description",
        content:
          "Protégez vos fichiers sensibles dans un espace privé, verrouillé par code PIN, mot de passe ou biométrie.",
      },
      { property: "og:title", content: "Coffre-fort — GeniusFiles" },
      {
        property: "og:description",
        content: "Un espace privé chiffrable, verrouillable, entièrement hors ligne.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VaultRoute,
});

function VaultRoute() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState<boolean>(false);

  useEffect(() => {
    setConfigured(isVaultConfigured());
    setUnlocked(isVaultUnlocked());
    const unsub = subscribeSession((v) => setUnlocked(v));
    return unsub;
  }, []);

  // Lock as soon as the user leaves the vault route.
  useEffect(() => {
    return () => {
      lockSession("manual");
    };
  }, []);

  if (configured === null) {
    return (
      <AppShell>
        <div className="pt-10 text-center text-[12px] text-muted-foreground">Chargement…</div>
      </AppShell>
    );
  }

  if (!configured) {
    return (
      <SetupWizard
        onDone={() => {
          setConfigured(true);
          markUnlocked();
        }}
      />
    );
  }

  if (!unlocked) {
    return (
      <LockScreen
        onUnlocked={() => {
          markUnlocked();
        }}
        onReset={() => {
          setConfigured(false);
        }}
      />
    );
  }

  return <VaultBrowser />;
}

/* ============================================================
 *  Setup wizard
 * ==========================================================*/

function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"method" | "secret" | "confirm">("method");
  const [method, setMethod] = useState<VaultAuthMethod>("pin");
  const [secret, setSecret] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricOpt, setBiometricOpt] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setBiometricAvailable);
  }, []);

  const minLen = method === "pin" ? 4 : 6;
  const validSecret = secret.length >= minLen && (method !== "pin" || /^\d+$/.test(secret));
  const matches = secret === confirmValue && validSecret;

  const finish = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await setupVault(method, secret, biometricOpt && biometricAvailable);
      toast.success("Coffre-fort configuré");
      onDone();
    } catch (e) {
      toast.error(errorMessage(e, "Configuration impossible"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <div className="gf-card flex items-start gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-foreground">
              Configurer le coffre-fort sécurisé
            </p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Vos fichiers sensibles resteront chiffrables, hors ligne et invisibles dans le reste
              de GeniusFiles tant qu'ils sont protégés.
            </p>
          </div>
        </div>

        <ol className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <StepPill n={1} label="Méthode" active={step === "method"} done={step !== "method"} />
          <StepPill n={2} label="Code" active={step === "secret"} done={step === "confirm"} />
          <StepPill n={3} label="Confirmation" active={step === "confirm"} done={false} />
        </ol>

        {step === "method" ? (
          <div className="flex flex-col gap-2">
            <MethodOption
              icon={KeyRound}
              label="Code PIN"
              description="4 chiffres minimum — rapide à saisir sur mobile."
              selected={method === "pin"}
              onSelect={() => setMethod("pin")}
            />
            <MethodOption
              icon={LockKeyhole}
              label="Mot de passe"
              description="6 caractères minimum — pour un maximum de robustesse."
              selected={method === "password"}
              onSelect={() => setMethod("password")}
            />
            <label
              className={`gf-card flex items-start gap-3 p-3.5 transition-colors ${
                biometricAvailable
                  ? "cursor-pointer hover:!border-primary/40"
                  : "cursor-not-allowed opacity-60"
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Fingerprint className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Déverrouillage biométrique</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                  {biometricAvailable
                    ? "Utiliser votre empreinte digitale ou votre visage comme raccourci."
                    : "Non disponible sur cet appareil — le code PIN ou mot de passe reste requis."}
                </p>
              </div>
              <input
                type="checkbox"
                checked={biometricOpt}
                disabled={!biometricAvailable}
                onChange={(e) => setBiometricOpt(e.target.checked)}
                className="mt-1"
              />
            </label>
            <PrimaryButton onClick={() => setStep("secret")}>Continuer</PrimaryButton>
          </div>
        ) : null}

        {step === "secret" ? (
          <div className="gf-card flex flex-col gap-3 p-4">
            <label className="text-[11px] font-medium text-muted-foreground">
              {method === "pin" ? "Choisissez un code PIN" : "Choisissez un mot de passe"}
            </label>
            <SecretInput
              method={method}
              value={secret}
              onChange={setSecret}
              autoFocus
              placeholder={method === "pin" ? "••••" : "••••••"}
            />
            <p className="text-[11px] text-muted-foreground">
              {method === "pin"
                ? "4 chiffres minimum. Évitez les suites évidentes comme 0000 ou 1234."
                : "6 caractères minimum. Mélangez lettres, chiffres et symboles."}
            </p>
            <div className="flex justify-end gap-2">
              <PrimaryButton variant="ghost" onClick={() => setStep("method")}>
                Retour
              </PrimaryButton>
              <PrimaryButton onClick={() => setStep("confirm")} disabled={!validSecret}>
                Continuer
              </PrimaryButton>
            </div>
          </div>
        ) : null}

        {step === "confirm" ? (
          <div className="gf-card flex flex-col gap-3 p-4">
            <label className="text-[11px] font-medium text-muted-foreground">
              Confirmez votre {method === "pin" ? "code PIN" : "mot de passe"}
            </label>
            <SecretInput
              method={method}
              value={confirmValue}
              onChange={setConfirmValue}
              autoFocus
              placeholder={method === "pin" ? "••••" : "••••••"}
            />
            {confirmValue && !matches ? (
              <p className="text-[11px] text-red-400">Les valeurs ne correspondent pas.</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <PrimaryButton variant="ghost" onClick={() => setStep("secret")}>
                Retour
              </PrimaryButton>
              <PrimaryButton onClick={finish} disabled={!matches || busy}>
                {busy ? "…" : "Activer le coffre-fort"}
              </PrimaryButton>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function StepPill({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${
        active
          ? "border-primary text-primary"
          : done
            ? "border-primary/40 text-muted-foreground"
            : "border-border text-muted-foreground"
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold ${
          active || done ? "bg-primary text-primary-foreground" : "bg-secondary"
        }`}
      >
        {n}
      </span>
      {label}
    </li>
  );
}

function MethodOption({
  icon: Icon,
  label,
  description,
  selected,
  onSelect,
}: {
  icon: typeof KeyRound;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`gf-card flex items-start gap-3 p-3.5 text-left transition-all ${
        selected ? "!border-primary/60 ring-1 ring-primary/40" : ""
      }`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

function SecretInput({
  method,
  value,
  onChange,
  autoFocus,
  placeholder,
}: {
  method: VaultAuthMethod;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      autoFocus={autoFocus}
      type={method === "pin" ? "tel" : "password"}
      inputMode={method === "pin" ? "numeric" : "text"}
      pattern={method === "pin" ? "[0-9]*" : undefined}
      autoComplete="new-password"
      value={value}
      onChange={(e) =>
        onChange(
          method === "pin" ? e.target.value.replace(/\D+/g, "").slice(0, 12) : e.target.value,
        )
      }
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-center text-[16px] tracking-[0.4em] text-foreground outline-none transition-colors focus:border-primary"
    />
  );
}

/* ============================================================
 *  Lock screen
 * ==========================================================*/

function LockScreen({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricReady, setBiometricReady] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const method: VaultAuthMethod = (() => {
    if (typeof window === "undefined") return "pin";
    try {
      const raw = window.localStorage.getItem("gf.vault.credential");
      const parsed = raw ? (JSON.parse(raw) as { method?: VaultAuthMethod }) : null;
      return parsed?.method ?? "pin";
    } catch {
      return "pin";
    }
  })();

  useEffect(() => {
    (async () => {
      if (!isBiometricEnabled()) return;
      const ok = await isBiometricAvailable();
      if (ok) setBiometricReady(true);
    })();
  }, []);

  const submit = async () => {
    if (busy || !secret) return;
    setBusy(true);
    setError(null);
    const ok = await verifySecret(secret);
    setBusy(false);
    if (!ok) {
      setError("Code incorrect");
      setSecret("");
      return;
    }
    onUnlocked();
  };

  const tryBiometric = async () => {
    const ok = await verifyBiometric();
    if (ok) onUnlocked();
    else setError("Authentification biométrique refusée");
  };

  return (
    <AppShell>
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/12 text-primary shadow-xs">
          <Lock className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Coffre-fort</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Saisissez votre {method === "pin" ? "code PIN" : "mot de passe"} pour déverrouiller.
          </p>
        </div>

        <div className="w-full max-w-xs">
          <SecretInput
            method={method}
            value={secret}
            onChange={setSecret}
            autoFocus
            placeholder={method === "pin" ? "••••" : "••••••"}
          />
          {error ? <p className="mt-2 text-[11px] text-red-400">{error}</p> : null}
          <div className="mt-3 flex flex-col gap-2">
            <PrimaryButton onClick={submit} disabled={busy || !secret}>
              {busy ? "Vérification…" : "Déverrouiller"}
            </PrimaryButton>
            {biometricReady ? (
              <button
                type="button"
                onClick={tryBiometric}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <Fingerprint className="h-4 w-4" /> Utiliser la biométrie
              </button>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowReset(true)}
          className="mt-4 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          J'ai oublié mon code
        </button>

        <ConfirmDialog
          open={showReset}
          title="Réinitialiser le coffre-fort"
          description={
            <>
              Cette action supprimera <strong>définitivement</strong> tous les fichiers du
              coffre-fort et vos réglages d'accès. Aucune récupération n'est possible.
            </>
          }
          confirmLabel="Tout effacer"
          danger
          onCancel={() => setShowReset(false)}
          onConfirm={async () => {
            await wipeVault();
            resetCredential();
            setShowReset(false);
            toast.info("Coffre-fort réinitialisé");
            onReset();
          }}
        />
      </div>
    </AppShell>
  );
}

/* ============================================================
 *  Browser
 * ==========================================================*/

function VaultBrowser() {
  const router = useRouter();
  const [folderId, setFolderId] = useState<string | null>(null);

  /* Retour Android : remonte d'un dossier du coffre avant de quitter la
     page (comportement identique à l'explorateur de fichiers). */
  useBackHandler(
    folderId != null,
    () => {
      setFolderId((id) => (id == null ? id : (findFolder(id)?.parentId ?? null)));
      return true;
    },
    BACK_PRIORITY.page,
  );
  const [tick, setTick] = useState(0);
  const [sort, setSort] = useState(() => loadVaultSort());
  const [query, setQuery] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const [selected, setSelected] = useState<Record<string, VaultItem>>({});

  // Sheets / dialogs
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [progress, setProgress] = useState<VaultProgress | null>(null);
  const [progressTitle, setProgressTitle] = useState("");
  const [renameTarget, setRenameTarget] = useState<VaultFolder | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [actionItem, setActionItem] = useState<VaultItem | null>(null);
  const [previewItem, setPreviewItem] = useState<VaultItem | null>(null);
  const [restoreCandidates, setRestoreCandidates] = useState<VaultItem[] | null>(null);
  const [restoreTargetOpen, setRestoreTargetOpen] = useState(false);
  const [deleteCandidates, setDeleteCandidates] = useState<VaultItem[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const on = () => refresh();
    window.addEventListener("gf:vault-changed", on);
    return () => window.removeEventListener("gf:vault-changed", on);
  }, [refresh]);

  // Any click / key press within the vault refreshes the inactivity timer.
  useEffect(() => {
    const bump = () => bumpActivity();
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);

  /* eslint-disable react-hooks/exhaustive-deps */
  const listing = useMemo(() => listVault(folderId), [folderId, tick]);
  const path = useMemo(() => folderPath(folderId), [folderId, tick]);
  const current = folderId ? findFolder(folderId) : null;
  const usage = useMemo(() => usageVault(), [tick]);

  const searchResults = useMemo(() => (query.trim() ? searchAll(query) : []), [query, tick]);
  const favs = useMemo(() => vaultFavorites(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const visibleItems = useMemo(() => {
    if (query.trim()) return sortItems(searchResults, sort.key, sort.order);
    if (showFavorites) return sortItems(favs, sort.key, sort.order);
    return sortItems(listing.items, sort.key, sort.order);
  }, [query, searchResults, showFavorites, favs, listing.items, sort]);

  const visibleFolders = query.trim() || showFavorites ? [] : listing.folders;

  const clearSelection = () => setSelected({});
  const toggleSelect = (item: VaultItem) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = item;
      return next;
    });
  };
  const selectionCount = Object.keys(selected).length;
  const selectionArray = Object.values(selected);

  /* Retour Android dans le coffre : sélection → favoris → recherche, avant
     toute navigation. Les feuilles se ferment d'elles-mêmes. */
  useBackHandler(
    selectionCount > 0,
    () => {
      clearSelection();
      return true;
    },
    BACK_PRIORITY.mode,
  );
  useBackHandler(
    showFavorites,
    () => {
      setShowFavorites(false);
      return true;
    },
    BACK_PRIORITY.mode,
  );
  useBackHandler(
    query.length > 0,
    () => {
      setQuery("");
      return true;
    },
    BACK_PRIORITY.mode,
  );

  /* ---------------- add ---------------- */

  const confirm = useConfirm();

  const performAdd = async (sources: PublicSource[]) => {
    setProgressTitle(`Chiffrement de ${countLabel(sources.length, "fichier")}…`);
    setProgress({
      completed: 0,
      total: sources.length,
      bytes: 0,
      totalBytes: sources.reduce((s, x) => s + x.size, 0),
      currentName: sources[0].name,
      elapsedMs: 0,
    });
    const res = await addFromPublic(sources, {
      folderId,
      onProgress: (p) => setProgress(p),
    });
    setProgress(null);
    if (res.added > 0) {
      toast.success(
        `${countLabel(res.added, "fichier protégé", "fichiers protégés")} dans le coffre-fort`,
      );
    }
    if (res.failed.length > 0) {
      toast.error(
        res.failed.length === 1
          ? `« ${res.failed[0].name} » n'a pas pu être protégé — réessayez, ou vérifiez l'espace disponible.`
          : `${countLabel(res.failed.length, "fichier")} n'ont pas pu être protégés — réessayez, ou vérifiez l'espace disponible.`,
      );
    }
  };

  const doAdd = (sources: PublicSource[]) => {
    setAddPickerOpen(false);
    if (sources.length === 0) return;
    confirm.ask(confirmCopy.encrypt(sources.length), () => performAdd(sources));
  };

  /* ---------------- restore ---------------- */

  const askRestore = (items: VaultItem[]) => {
    setRestoreCandidates(items);
  };

  const runRestore = async (items: VaultItem[], target?: PathRef) => {
    setProgressTitle("Restauration");
    setProgress({
      completed: 0,
      total: items.length,
      bytes: 0,
      totalBytes: items.reduce((s, i) => s + (i.size || 0), 0),
      currentName: items[0]?.name ?? "",
      elapsedMs: 0,
    });
    const res = await restoreItems(items, {
      targetPath: target,
      onProgress: (p) => setProgress(p),
    });
    setProgress(null);
    setRestoreCandidates(null);
    setRestoreTargetOpen(false);
    clearSelection();
    if (res.restored > 0)
      toast.success(
        `${countLabel(res.restored, "élément restauré", "éléments restaurés")} à leur emplacement d'origine`,
      );
    if (res.failed.length > 0)
      toast.error(
        `${countLabel(res.failed.length, "élément")} n'ont pas pu être restaurés — vérifiez l'espace disponible et réessayez.`,
      );
  };

  /* ---------------- delete forever ---------------- */

  const askDelete = (items: VaultItem[]) => setDeleteCandidates(items);

  const runDelete = async (items: VaultItem[]) => {
    const res = await permanentDelete(items);
    setDeleteCandidates(null);
    clearSelection();
    if (res.deleted > 0)
      toast.success(
        res.deleted === 1
          ? "Élément supprimé définitivement"
          : `${res.deleted} éléments supprimés définitivement`,
      );
  };

  /* ---------------- folders ---------------- */

  const doCreateFolder = async (name: string) => {
    const res = createFolder(name, folderId);
    setNewFolderOpen(false);
    if (!res.ok)
      toast.error(
        res.error ?? "Impossible de créer ce dossier — ce nom est peut-être déjà utilisé.",
      );
    else toast.success("Dossier créé");
  };

  const doRenameFolder = async (name: string) => {
    if (!renameTarget) return;
    const res = renameFolder(renameTarget.id, name);
    setRenameTarget(null);
    if (!res.ok)
      toast.error(
        res.error ?? "Impossible de renommer ce dossier — ce nom est peut-être déjà utilisé.",
      );
  };

  const doDeleteFolder = (folder: VaultFolder) => {
    const res = deleteEmptyFolder(folder.id);
    if (!res.ok)
      toast.error(
        res.error ?? "Ce dossier n'est pas vide — déplacez ou supprimez son contenu d'abord.",
      );
    else toast.success("Dossier supprimé");
  };

  /* ---------------- render ---------------- */

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="gf-card flex items-center gap-3 p-3.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Shield className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-foreground">Coffre-fort</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {usage.count} élément{usage.count > 1 ? "s" : ""} · {formatSize(usage.bytes)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Paramètres du coffre-fort"
            onClick={() => setSettingsOpen(true)}
            className="rounded-full border border-border bg-surface p-2 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Verrouiller"
            onClick={() => {
              lockSession("manual");
            }}
            className="rounded-full border border-border bg-surface p-2 text-muted-foreground hover:text-foreground"
          >
            <Lock className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 overflow-x-auto text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={() => setFolderId(null)}
            className="rounded px-1.5 py-0.5 hover:text-foreground"
          >
            Coffre-fort
          </button>
          {path.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 shrink-0" />
              <button
                type="button"
                onClick={() => setFolderId(f.id)}
                className="rounded px-1.5 py-0.5 hover:text-foreground"
              >
                {f.name}
              </button>
            </span>
          ))}
          {current ? (
            <button
              type="button"
              onClick={() => setFolderId(current.parentId)}
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Retour
            </button>
          ) : null}
        </div>

        {/* Search + toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher dans le coffre-fort…"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-2 text-[12px] text-foreground outline-none focus:border-primary"
            />
          </div>
          <SortMenu
            sort={sort}
            onChange={(s) => {
              setSort(s);
              saveVaultSort(s);
            }}
          />
        </div>

        <div className="-mt-1 flex items-center gap-2 text-[11px]">
          <FilterChip
            active={!showFavorites && !query}
            icon={Folder}
            label="Tous"
            onClick={() => {
              setShowFavorites(false);
              setQuery("");
            }}
          />
          <FilterChip
            active={showFavorites && !query}
            icon={Star}
            label={`Favoris (${favs.length})`}
            onClick={() => {
              setShowFavorites(true);
              setQuery("");
            }}
          />
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNewFolderOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <FolderPlus className="h-3.5 w-3.5" /> Dossier
            </button>
          </div>
        </div>

        {/* Content */}
        {visibleFolders.length === 0 && visibleItems.length === 0 ? (
          query || showFavorites ? (
            <IllustratedEmptyState
              id={query ? "search" : "favorites"}
              description={
                query
                  ? "Essayez un autre terme, ou vérifiez l'orthographe."
                  : "Marquez un fichier du coffre-fort d'une étoile pour le retrouver ici."
              }
            />
          ) : (
            <EmptyState
              icon={LockKeyhole}
              title="Coffre-fort vide"
              description="Ajoutez des fichiers sensibles pour les chiffrer et les masquer du reste de l'application. Ils resteront sur cet appareil."
              action={
                !query && !showFavorites ? (
                  <button
                    type="button"
                    onClick={() => setAddPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ajouter des fichiers
                  </button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            {visibleFolders.length > 0 ? (
              <>
                <SectionHeader title="Dossiers" />
                <ul className="grid grid-cols-2 gap-2">
                  {visibleFolders.map((f) => (
                    <li key={f.id}>
                      <FolderTile
                        folder={f}
                        onOpen={() => setFolderId(f.id)}
                        onRename={() => setRenameTarget(f)}
                        onDelete={() => doDeleteFolder(f)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {visibleItems.length > 0 ? (
              <>
                <SectionHeader
                  title={query ? "Résultats" : showFavorites ? "Favoris" : "Fichiers"}
                  hint={
                    !query && !showFavorites
                      ? `${visibleItems.length} élément${visibleItems.length > 1 ? "s" : ""}`
                      : undefined
                  }
                />
                <ul className="gf-card flex flex-col divide-y divide-border/60 overflow-hidden">
                  {visibleItems.map((item) => (
                    <li key={item.id}>
                      <ItemRow
                        item={item}
                        selected={!!selected[item.id]}
                        anySelected={selectionCount > 0}
                        onOpen={() => setPreviewItem(item)}
                        onLongPress={() => toggleSelect(item)}
                        onToggleSelect={() => toggleSelect(item)}
                        onMore={() => setActionItem(item)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}

        {/* Foundations tiles */}
        {null}
      </div>

      {/* FAB — add files/folders */}
      <button
        type="button"
        onClick={() => setAddPickerOpen(true)}
        aria-label="Ajouter au coffre-fort"
        className="fixed bottom-24 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated transition-transform active:scale-95"
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* Selection bar */}
      {selectionCount > 0 ? (
        <SelectionBar
          count={selectionCount}
          onClear={clearSelection}
          onRestore={() => askRestore(selectionArray)}
          onDelete={() => askDelete(selectionArray)}
        />
      ) : null}

      {/* Sheets */}
      <VaultAddPicker
        open={addPickerOpen}
        onCancel={() => setAddPickerOpen(false)}
        onConfirm={doAdd}
      />

      <NamePrompt
        open={newFolderOpen}
        title="Nouveau dossier"
        label="Nom du dossier"
        initial=""
        cta="Créer"
        onCancel={() => setNewFolderOpen(false)}
        onSubmit={doCreateFolder}
      />

      <NamePrompt
        open={!!renameTarget}
        title="Renommer le dossier"
        label="Nouveau nom"
        initial={renameTarget?.name ?? ""}
        cta="Renommer"
        onCancel={() => setRenameTarget(null)}
        onSubmit={doRenameFolder}
      />

      <ProgressDialog
        open={progress !== null}
        title={progressTitle}
        progress={progress}
        onCancel={() => {
          /* No hard-cancel: individual moves are atomic and the pipeline
             stops after each item finishes, which is safe enough for the
             volumes handled by a personal vault. */
        }}
      />

      <ItemActionSheet
        item={actionItem}
        onClose={() => setActionItem(null)}
        onRestore={(it) => {
          setActionItem(null);
          askRestore([it]);
        }}
        onDelete={(it) => {
          setActionItem(null);
          askDelete([it]);
        }}
        onFavorite={(it) => {
          toggleFavorite(it.id);
          setActionItem(null);
        }}
        onMove={(it) => {
          setActionItem(null);
          const target = prompt(
            "Déplacer vers un dossier existant du coffre-fort (laisser vide pour la racine)",
            current?.name ?? "",
          );
          if (target === null) return;
          const t = target.trim();
          if (!t) {
            moveItemsToFolder([it.id], null);
            toast.success("Déplacé à la racine");
            return;
          }
          // find/create folder by name at the current parent (folderId)
          const existing = listVault(folderId).folders.find(
            (f) => f.name.toLowerCase() === t.toLowerCase(),
          );
          if (existing) {
            moveItemsToFolder([it.id], existing.id);
            toast.success(`Déplacé dans « ${existing.name} »`);
          } else {
            const created = createFolder(t, folderId);
            if (created.ok && created.folder) {
              moveItemsToFolder([it.id], created.folder.id);
              toast.success(`Déplacé dans « ${created.folder.name} »`);
            } else {
              toast.error(created.error ?? "Impossible");
            }
          }
        }}
      />

      <VaultPreview
        open={!!previewItem}
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onRestore={(it) => {
          setPreviewItem(null);
          askRestore([it]);
        }}
        onDelete={(it) => {
          setPreviewItem(null);
          askDelete([it]);
        }}
        onToggleFavorite={(it) => {
          toggleFavorite(it.id);
          setPreviewItem((prev) => (prev ? { ...prev, favorite: !prev.favorite } : null));
        }}
      />

      <RestorePrompt
        items={restoreCandidates}
        onCancel={() => setRestoreCandidates(null)}
        onOriginal={() => restoreCandidates && runRestore(restoreCandidates)}
        onPickTarget={() => setRestoreTargetOpen(true)}
      />

      <DestinationPicker
        open={restoreTargetOpen}
        title="Restaurer vers…"
        initial={null}
        onCancel={() => setRestoreTargetOpen(false)}
        onConfirm={(dest) => {
          if (restoreCandidates) runRestore(restoreCandidates, dest);
        }}
      />

      <ConfirmDialog
        open={!!deleteCandidates}
        title="Supprimer définitivement ?"
        description={
          <>
            Cette opération supprime pour de bon{" "}
            <strong>
              {deleteCandidates?.length === 1
                ? `« ${deleteCandidates[0].name} »`
                : `${deleteCandidates?.length ?? 0} élément(s)`}
            </strong>{" "}
            du coffre-fort. Aucune restauration ne sera possible.
          </>
        }
        confirmLabel="Supprimer"
        danger
        onCancel={() => setDeleteCandidates(null)}
        onConfirm={() => {
          if (deleteCandidates) return runDelete(deleteCandidates);
        }}
      />

      <VaultSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onWipe={async () => {
          await wipeVault();
          resetCredential();
          lockSession("manual");
          router.navigate({ to: "/outils" });
        }}
      />

      {confirm.dialog}
    </AppShell>
  );
}

/* ---------------- pieces ---------------- */

function FilterChip({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Folder;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 transition-colors ${
        active
          ? "border-primary/60 bg-primary/12 text-primary"
          : "border-border bg-surface text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

function SortMenu({
  sort,
  onChange,
}: {
  sort: { key: VaultSortKey; order: VaultSortOrder };
  onChange: (s: { key: VaultSortKey; order: VaultSortOrder }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const options: { key: VaultSortKey; label: string; icon: typeof ArrowDownAZ }[] = [
    { key: "date", label: "Date d'ajout", icon: Clock },
    { key: "name", label: "Nom", icon: ArrowDownAZ },
    { key: "size", label: "Taille", icon: ArrowUpDown },
    { key: "type", label: "Type", icon: FileTextIcon },
  ];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Trier"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:text-foreground"
      >
        <ArrowUpDown className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface shadow-soft">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange({
                  key: o.key,
                  order: sort.key === o.key ? (sort.order === "asc" ? "desc" : "asc") : "asc",
                });
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-secondary/60 ${
                sort.key === o.key ? "text-primary" : "text-foreground"
              }`}
            >
              <o.icon className="h-3.5 w-3.5" /> {o.label}
              {sort.key === o.key ? (
                <span className="ml-auto text-[10px] uppercase tracking-wide">{sort.order}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FolderTile({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: VaultFolder;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="gf-card group relative flex items-center gap-3 p-3.5">
      <button type="button" onClick={onOpen} className="flex flex-1 items-center gap-3 text-left">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Folder className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{folder.name}</p>
          <p className="text-[10.5px] text-muted-foreground">Dossier privé</p>
        </div>
      </button>
      <div className="flex flex-col gap-1 opacity-70 group-hover:opacity-100">
        <button
          type="button"
          aria-label="Renommer"
          onClick={onRename}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Supprimer"
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  selected,
  anySelected,
  onOpen,
  onLongPress,
  onToggleSelect,
  onMore,
}: {
  item: VaultItem;
  selected: boolean;
  anySelected: boolean;
  onOpen: () => void;
  onLongPress: () => void;
  onToggleSelect: () => void;
  onMore: () => void;
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPress = () => {
    pressTimer.current = setTimeout(() => onLongPress(), 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
        selected ? "bg-primary/10" : "hover:bg-secondary/40"
      }`}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
    >
      <button
        type="button"
        onClick={() => (anySelected ? onToggleSelect() : onOpen())}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <FileIcon kind={item.kind} path={item.vaultAbsolutePath ?? item.originalPath} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            {item.name}
            {item.favorite ? (
              <Star className="ml-1 inline h-3 w-3 text-amber-400" fill="currentColor" />
            ) : null}
          </p>
          <p className="text-[10.5px] text-muted-foreground">
            {formatSize(item.size)} · {formatDate(item.addedAt)}
          </p>
        </div>
      </button>
      <button
        type="button"
        aria-label="Actions"
        onClick={onMore}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function SelectionBar({
  count,
  onClear,
  onRestore,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[520px] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2">
      <div className="glass-panel pointer-events-auto flex items-center gap-2 rounded-2xl border border-border-strong px-3 py-2 shadow-soft animate-in-up">
        <button
          type="button"
          onClick={onClear}
          aria-label="Quitter la sélection"
          className="rounded-lg border border-border bg-surface p-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <span className="text-[12px] font-medium text-foreground">
          {count} sélectionné{count > 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onRestore}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Undo2 className="h-3.5 w-3.5" /> Restaurer
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/20"
          >
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemActionSheet({
  item,
  onClose,
  onRestore,
  onDelete,
  onFavorite,
  onMove,
}: {
  item: VaultItem | null;
  onClose: () => void;
  onRestore: (it: VaultItem) => void;
  onDelete: (it: VaultItem) => void;
  onFavorite: (it: VaultItem) => void;
  onMove: (it: VaultItem) => void;
}) {
  return (
    <BottomSheet open={!!item} onClose={onClose}>
      {item ? (
        <>
          <div className="mb-3 flex items-center gap-3 px-1">
            <FileIcon kind={item.kind} path={item.vaultAbsolutePath ?? item.originalPath} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{item.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatSize(item.size)} · Ajouté {formatDate(item.addedAt)}
              </p>
            </div>
          </div>
          <div className="flex flex-col">
            <ActionRow
              icon={Star}
              label={item.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              onClick={() => onFavorite(item)}
            />
            <ActionRow
              icon={Folder}
              label="Déplacer dans un dossier…"
              onClick={() => onMove(item)}
            />
            <ActionRow icon={Undo2} label="Restaurer…" onClick={() => onRestore(item)} />
            <ActionRow
              icon={Trash2}
              label="Supprimer définitivement"
              onClick={() => onDelete(item)}
              danger
            />
          </div>
        </>
      ) : null}
    </BottomSheet>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Star;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[13px] transition-colors hover:bg-secondary/60 ${
        danger ? "text-red-400" : "text-foreground"
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
          danger ? "bg-red-500/12 text-red-400" : "bg-primary/12 text-primary"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span>{label}</span>
    </button>
  );
}

function RestorePrompt({
  items,
  onCancel,
  onOriginal,
  onPickTarget,
}: {
  items: VaultItem[] | null;
  onCancel: () => void;
  onOriginal: () => void;
  onPickTarget: () => void;
}) {
  return (
    <BottomSheet open={!!items} onClose={onCancel} title="Restaurer">
      {items ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-muted-foreground">
            Où souhaitez-vous restaurer {items.length === 1 ? "cet élément" : "ces éléments"} ?
          </p>
          <button
            type="button"
            onClick={onOriginal}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:!border-primary/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <RotateCcw className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[13px] font-medium">Emplacement d'origine</p>
              <p className="text-[11px] text-muted-foreground">
                Retour à l'endroit où se trouvaient les fichiers avant protection.
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={onPickTarget}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:!border-primary/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Folder className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[13px] font-medium">Choisir un emplacement…</p>
              <p className="text-[11px] text-muted-foreground">
                Restaurer dans un dossier public de votre appareil.
              </p>
            </div>
          </button>
        </div>
      ) : null}
    </BottomSheet>
  );
}

function VaultSettings({
  open,
  onClose,
  onWipe,
}: {
  open: boolean;
  onClose: () => void;
  onWipe: () => Promise<void>;
}) {
  const [autoLock, setAutoLock] = useState(() => loadAutoLockMs());
  const [background, setBackground] = useState(() => loadLockOnBackground());
  const [bioOn, setBioOn] = useState(() => isBiometricEnabled());
  const [bioReady, setBioReady] = useState(false);
  const [askWipe, setAskWipe] = useState(false);
  useEffect(() => {
    if (open) {
      setAutoLock(loadAutoLockMs());
      setBackground(loadLockOnBackground());
      setBioOn(isBiometricEnabled());
      isBiometricAvailable().then(setBioReady);
    }
  }, [open]);
  return (
    <>
      <BottomSheet open={open && !askWipe} onClose={onClose} title="Paramètres du coffre-fort">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Verrouillage automatique
            </p>
            <select
              value={autoLock}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                setAutoLock(v);
                saveAutoLockMs(v);
              }}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px]"
            >
              {AUTO_LOCK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
            <div>
              <p className="text-[13px] font-medium">Verrouiller en arrière-plan</p>
              <p className="text-[11px] text-muted-foreground">
                Ferme le coffre-fort dès que GeniusFiles passe en arrière-plan.
              </p>
            </div>
            <input
              type="checkbox"
              checked={background}
              onChange={(e) => {
                setBackground(e.target.checked);
                saveLockOnBackground(e.target.checked);
              }}
            />
          </label>
          <label
            className={`flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 ${
              bioReady ? "" : "opacity-60"
            }`}
          >
            <div>
              <p className="text-[13px] font-medium">Déverrouillage biométrique</p>
              <p className="text-[11px] text-muted-foreground">
                {bioReady
                  ? "Utiliser l'empreinte ou le visage comme raccourci."
                  : "Non disponible sur cet appareil."}
              </p>
            </div>
            <input
              type="checkbox"
              checked={bioOn}
              disabled={!bioReady}
              onChange={(e) => {
                setBioOn(e.target.checked);
                setBiometricEnabled(e.target.checked);
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => setAskWipe(true)}
            className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-400 hover:bg-red-500/20"
          >
            Réinitialiser le coffre-fort
          </button>
        </div>
      </BottomSheet>
      <ConfirmDialog
        open={askWipe}
        title="Tout effacer ?"
        description="Cette action supprime définitivement tout le contenu du coffre-fort et le code d'accès."
        confirmLabel="Réinitialiser"
        danger
        onCancel={() => setAskWipe(false)}
        onConfirm={async () => {
          await onWipe();
          setAskWipe(false);
        }}
      />
    </>
  );
}

/* ---------------- home shortcut ---------------- */

// Note : un export au niveau module empêche le code-splitting automatique
// du composant de route (le compilateur ne peut pas extraire le composant
// dans un chunk séparé si un autre symbole du même fichier est exporté).
// Ce raccourci est donc rendu directement via <Link to="/coffre-fort" />
// depuis /outils — pas besoin d'un composant dédié ici.
