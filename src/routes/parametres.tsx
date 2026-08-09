/**
 * Paramètres — version essentielle.
 *
 * Cinq catégories seulement (Apparence, Stockage, Notifications,
 * Corbeille, À propos), présentées en cartes repliables. Aucun réglage
 * technique, expérimental ou destiné aux développeurs.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  Eraser,
  FileText,
  HardDrive,
  Info,
  Mail,
  MonitorSmartphone,
  Moon,
  Palette,
  Shield,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/common/PageHeader";
import {
  SettingsAction,
  SettingsCard,
  SettingsItem,
  SettingsLink,
} from "@/components/settings/SettingsCard";
import { SelectRow, Toggle } from "@/components/settings/controls";
import {
  TRASH_RETENTION_OPTIONS,
  loadTrashRetention,
  saveTrashRetention,
  type TrashRetentionDays,
} from "@/lib/files/preferences";
import { DEFAULT_PREFS, usePrefs, type ThemeMode } from "@/lib/personalization";
import { clearThumbnailCache } from "@/lib/native/thumbnails";
import { sweepTempFiles } from "@/lib/native/temp-sweep";

const APP_VERSION = "0.1.0";

export const Route = createFileRoute("/parametres")({
  head: () => ({
    meta: [
      { title: "Paramètres — GeniusFiles" },
      {
        name: "description",
        content:
          "Réglez l'essentiel de GeniusFiles : thème, langue, stockage, notifications, corbeille et informations sur l'application.",
      },
      { property: "og:title", content: "Paramètres — GeniusFiles" },
      {
        property: "og:description",
        content: "Les réglages essentiels de GeniusFiles, simples et clairs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [prefs, setPrefs] = usePrefs();
  const [hydrated, setHydrated] = useState(false);
  const [retention, setRetention] = useState<TrashRetentionDays>(30);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setHydrated(true);
    setRetention(loadTrashRetention());
  }, []);

  const setShowHidden = (showHidden: boolean) =>
    setPrefs((p) => ({ ...p, files: { ...p.files, showHidden } }));

  const setNotifications = (enabled: boolean) =>
    setPrefs((p) => ({ ...p, notifications: { ...p.notifications, enabled } }));

  const clearCache = async () => {
    setClearing(true);
    try {
      const thumbs = await clearThumbnailCache().catch(() => ({ deleted: 0, bytesFreed: 0 }));
      const temp = await sweepTempFiles(0).catch(() => null);
      const bytes = thumbs.bytesFreed + (temp?.bytesReclaimed ?? 0);
      toast.success("Cache vidé", {
        description: bytes > 0 ? `${formatBytes(bytes)} libérés.` : "Aucune donnée à supprimer.",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <AppShell>
      <PageHeader title="Paramètres" subtitle="L'essentiel, rien de plus." />

      <div className="animate-page-in flex flex-col gap-3 pb-6">
        <SettingsCard icon={Palette} title="Apparence" description="Thème et langue de l'interface">
          <SettingsItem
            label="Thème"
            desc="Automatique suit Android. Votre choix est conservé après fermeture."
          >
            <ThemePicker
              value={hydrated ? prefs.appearance.theme : DEFAULT_PREFS.appearance.theme}
              onChange={(theme) => {
                setPrefs((p) => ({ ...p, appearance: { ...p.appearance, theme } }));
              }}
            />
          </SettingsItem>
          <SettingsItem label="Langue" desc="Langue de l'interface.">
            <SelectRow
              ariaLabel="Langue"
              value="fr"
              onChange={() => undefined}
              options={[{ value: "fr", label: "Français" }]}
            />
          </SettingsItem>
        </SettingsCard>

        <SettingsCard
          icon={HardDrive}
          title="Stockage"
          description="Fichiers cachés et cache"
          defaultOpen={false}
        >
          <SettingsItem
            label="Afficher les fichiers cachés"
            desc="Dossiers et fichiers commençant par un point."
          >
            <Toggle
              checked={prefs.files.showHidden}
              onChange={setShowHidden}
              ariaLabel="Afficher les fichiers cachés"
            />
          </SettingsItem>
          <SettingsItem
            label="Vider le cache"
            desc="Miniatures et fichiers temporaires. Vos fichiers ne sont pas supprimés."
          >
            <SettingsAction icon={Eraser} onClick={clearCache} disabled={clearing}>
              {clearing ? "Nettoyage…" : "Vider"}
            </SettingsAction>
          </SettingsItem>
        </SettingsCard>

        <SettingsCard
          icon={Bell}
          title="Notifications"
          description="Alertes de l'application"
          defaultOpen={false}
        >
          <SettingsItem
            label="Activer les notifications"
            desc="Transferts, sauvegardes et nettoyages terminés."
          >
            <Toggle
              checked={prefs.notifications.enabled}
              onChange={setNotifications}
              ariaLabel="Activer les notifications"
            />
          </SettingsItem>
        </SettingsCard>

        <SettingsCard
          icon={Trash2}
          title="Corbeille"
          description="Durée de conservation"
          defaultOpen={false}
        >
          <SettingsItem
            label="Conserver les éléments"
            desc="Passé ce délai, ils sont supprimés définitivement."
          >
            <SelectRow
              ariaLabel="Durée de conservation"
              value={retention}
              onChange={(v) => {
                setRetention(v as TrashRetentionDays);
                saveTrashRetention(v as TrashRetentionDays);
                toast.success("Durée de conservation mise à jour.");
              }}
              options={TRASH_RETENTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </SettingsItem>
        </SettingsCard>

        <SettingsCard
          icon={Info}
          title="À propos"
          description={`Version ${APP_VERSION}`}
          defaultOpen={false}
        >
          <SettingsItem label="Version">
            <span className="text-[13px] text-muted-foreground">v{APP_VERSION}</span>
          </SettingsItem>
          <SettingsLink
            icon={Shield}
            label="Politique de confidentialité"
            desc="Vos fichiers restent sur votre appareil."
            href="https://geniusfiles.lovable.app/confidentialite"
          />
          <SettingsLink
            icon={FileText}
            label="Conditions d'utilisation"
            href="https://geniusfiles.lovable.app/conditions"
          />
          <SettingsLink
            icon={Mail}
            label="Nous contacter"
            desc="support@geniusfiles.app"
            href="mailto:support@geniusfiles.app"
          />
        </SettingsCard>
      </div>

      <p className="pb-4 text-center text-[11px] text-muted-foreground/70">
        GeniusFiles · Conçu pour Android · v{APP_VERSION}
      </p>
    </AppShell>
  );
}

/**
 * Sélecteur de thème — trois modes, retour visuel immédiat.
 * Le changement est appliqué instantanément par l'applier (aucun
 * rechargement, aucun écran noir).
 */
function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}) {
  const options: { value: ThemeMode; label: string; icon: typeof Moon }[] = [
    { value: "system", label: "Auto", icon: MonitorSmartphone },
    { value: "light", label: "Clair", icon: Sun },
    { value: "dark", label: "Sombre", icon: Moon },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Thème de l'application"
      suppressHydrationWarning
      className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface-2 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            suppressHydrationWarning
            aria-checked={active}
            onClick={() => {
              if (!active) {
                onChange(o.value);
                toast.success(`Thème ${o.label.toLowerCase()} activé.`);
              }
            }}
            className={`gf-press flex h-9 min-w-0 items-center justify-center gap-1 rounded-xl px-2 text-[12px] font-semibold transition-colors ${
              active ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground"
            }`}
          >
            <o.icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
