import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Trash2,
  FileText,
  Shield,
  Share2,
  AppWindow,
  Zap,
  ChevronRight,
  Home,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AnalysisProgressPanel } from "@/components/analysis/AnalysisProgressPanel";

export const Route = createFileRoute("/outils")({
  head: () => ({
    meta: [
      { title: "Outils — GeniusFiles" },
      {
        name: "description",
        content: "Nettoyeur, coffre-fort, outils PDF, transfert et plus encore.",
      },
    ],
  }),
  component: ToolsPage,
});

type Tool = {
  label: string;
  desc: string;
  icon: LucideIcon;
  featured?: boolean;
  to: string;
};

const OTHER_TOOLS: Tool[] = [
  {
    label: "Nettoyeur",
    desc: "Doublons, gros fichiers, APK anciens",
    icon: Trash2,
    featured: true,
    to: "/nettoyeur",
  },
  {
    label: "Corbeille",
    desc: "Restaurer ou supprimer définitivement",
    icon: Trash2,
    featured: true,
    to: "/corbeille",
  },
  {
    label: "Coffre-fort",
    desc: "Espace privé, PIN, mot de passe, biométrie",
    icon: Shield,
    featured: true,
    to: "/coffre-fort",
  },
  {
    label: "Transfert entre appareils",
    desc: "Envoi P2P hors ligne, QR et reprise",
    icon: Share2,
    featured: true,
    to: "/transfert",
  },
  {
    label: "Gestionnaire d'applications",
    desc: "APK, permissions, taille",
    icon: AppWindow,
    to: "/applications",
  },
];

const NAV_SHORTCUTS: Tool[] = [
  { label: "Accueil", desc: "Vue d'ensemble et fichiers récents", icon: Home, to: "/" },
  { label: "Genius AI", desc: "Assistant intelligent", icon: Sparkles, to: "/assistant" },
  {
    label: "Automatisations",
    desc: "Règles, déclencheurs, actions",
    icon: Zap,
    to: "/automatisations",
  },
  {
    label: "Outils PDF",
    desc: "Fusion, split, scanner, compression",
    icon: FileText,
    to: "/pdf-outils",
  },
];

function ToolRow({ tool }: { tool: Tool }) {
  return (
    <Link
      to={tool.to}
      className="group flex w-full items-center gap-3 px-1 py-3 text-left transition-colors active:bg-secondary/40"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          tool.featured ? "bg-primary/12 text-primary" : "bg-secondary/60 text-muted-foreground"
        }`}
      >
        <tool.icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-foreground">{tool.label}</p>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground/80">{tool.desc}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}

function ToolsList({ tools }: { tools: Tool[] }) {
  return (
    <div className="divide-y divide-border/50">
      {tools.map((t) => (
        <ToolRow key={t.label} tool={t} />
      ))}
    </div>
  );
}

function ShortcutRow({ tool }: { tool: Tool }) {
  return (
    <Link
      to={tool.to}
      className="flex w-full items-center gap-3 px-1 py-2.5 text-left opacity-60 transition-opacity active:bg-secondary/30 hover:opacity-100"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/50 text-muted-foreground">
        <tool.icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-muted-foreground">{tool.label}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </Link>
  );
}

function ToolsPage() {
  return (
    <AppShell>
      <AnalysisProgressPanel />

      <SectionHeader title="Autres outils" />
      <ToolsList tools={OTHER_TOOLS} />

      <SectionHeader title="Déjà accessibles depuis la navigation" />
      <div className="divide-y divide-border/40">
        {NAV_SHORTCUTS.map((t) => (
          <ShortcutRow key={t.label} tool={t} />
        ))}
      </div>
    </AppShell>
  );
}
