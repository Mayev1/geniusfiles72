/**
 * API haut niveau du module Transfert.
 *
 * Sert de façade unifiée entre l'UI (`/transfert`) et les briques :
 *  - découverte (`discovery.ts`)
 *  - moteur (`engine.ts`)
 *  - historique (`history.ts`)
 *
 * Elle permet de construire un plan à partir d'un ensemble d'entrées
 * du gestionnaire de fichiers, puis de lancer / reprendre / annuler
 * un transfert. Toute la logique fonctionne offline.
 */
import type { FileEntry } from "@/lib/files/types";
import { extOf } from "@/lib/files/format";
import type { ConflictPolicy, DeviceInfo, TransferItem, TransferPlan } from "./types";

export function defaultInboxPath(): string {
  return "/storage/emulated/0/Download/GeniusFiles";
}

export function buildPlanFromEntries(input: {
  entries: FileEntry[];
  peer: DeviceInfo;
  destinationPath?: string;
  conflictPolicy?: ConflictPolicy;
  verify?: boolean;
}): TransferPlan {
  const items: TransferItem[] = input.entries.map((e) => ({
    source: e.path ?? e.name,
    relPath: e.name,
    size: Math.max(0, e.size ?? 0),
    isDirectory: e.kind === "folder",
  }));

  const totalBytes = items.reduce((s, it) => s + it.size, 0);
  return {
    items,
    totalFiles: items.length,
    totalBytes,
    destinationDeviceId: input.peer.id,
    destinationDeviceName: input.peer.name,
    destinationPath: input.destinationPath ?? defaultInboxPath(),
    conflictPolicy: input.conflictPolicy ?? "rename",
    verify: input.verify ?? true,
  };
}

/** Petit helper pour libeller un ensemble de fichiers dans les résumés. */
export function summarizePlan(plan: TransferPlan): string {
  const n = plan.totalFiles;
  const ext = plan.items[0] ? extOf(plan.items[0].relPath) : "";
  if (n === 1) return `1 fichier${ext ? ` .${ext}` : ""}`;
  return `${n} fichiers`;
}

export const CONFLICT_POLICIES: readonly {
  value: ConflictPolicy;
  label: string;
  desc: string;
}[] = [
  {
    value: "rename",
    label: "Renommer automatiquement",
    desc: "Ajoute un suffixe (2), (3)… pour éviter tout écrasement.",
  },
  {
    value: "replace",
    label: "Remplacer les fichiers existants",
    desc: "Le fichier reçu écrase la version présente.",
  },
  {
    value: "keep-both",
    label: "Conserver les deux versions",
    desc: "Ajoute la date au nom du fichier reçu.",
  },
  {
    value: "skip",
    label: "Ignorer les doublons",
    desc: "N'écrit pas le fichier s'il existe déjà.",
  },
  {
    value: "ask",
    label: "Demander à chaque fois",
    desc: "Une confirmation sera demandée au récepteur.",
  },
] as const;
