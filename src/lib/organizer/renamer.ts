/**
 * Renommage intelligent.
 *
 * Aucune modification directe. Produit une liste de `RenameProposal`
 * éditables. Signaux exploités : docType, keywords, artiste/album/titre
 * pour l'audio, mtime, dimensions image, mots-clés OCR pour captures.
 *
 * Fondation prête pour un fournisseur IA plus riche (voir `reserved.ts`).
 */
import { getAnalysis } from "@/lib/analysis";
import type { FileEntry, PathRef } from "@/lib/files/types";
import type { RenameProposal } from "./types";

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatDate(mtime?: number): string | undefined {
  if (!mtime) return undefined;
  const d = new Date(mtime);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

export function proposeRename(entry: FileEntry, parent: PathRef): RenameProposal | null {
  if (entry.isDirectory) return null;
  const rec = getAnalysis(parent, entry);
  const ext = extOf(entry.name);
  const signals: string[] = [];
  let proposed = "";
  let reason = "";

  // Audio → « Artiste - Titre »
  if (entry.kind === "audio" && (rec?.media?.title || rec?.media?.artist)) {
    const artist = rec.media.artist?.trim();
    const title = rec.media.title?.trim();
    if (artist && title) {
      proposed = `${artist} - ${title}${ext}`;
      reason = "Titre et artiste détectés dans les métadonnées.";
      signals.push("artist", "title");
    } else if (title) {
      proposed = `${title}${ext}`;
      reason = "Titre détecté dans les métadonnées.";
      signals.push("title");
    }
  }

  // Documents → type + date
  if (!proposed && rec?.content?.docType && rec.content.docType !== "inconnu") {
    const date = formatDate(entry.mtime) ?? "";
    const kw = rec.content.keywords?.[0];
    const parts = [rec.content.docType, kw, date].filter(Boolean);
    proposed = `${parts.join(" — ")}${ext}`;
    reason = `Type de document détecté : ${rec.content.docType}.`;
    signals.push("docType", "mtime");
  }

  // Images de type reçu/facture/carte
  if (!proposed && rec?.image) {
    const img = rec.image;
    const date = formatDate(entry.mtime) ?? "";
    if (img.isReceipt) {
      proposed = `Recu ${date}${ext}`;
      reason = "Reçu détecté sur l'image.";
      signals.push("isReceipt");
    } else if (img.isInvoice) {
      proposed = `Facture ${date}${ext}`;
      reason = "Facture détectée sur l'image.";
      signals.push("isInvoice");
    } else if (img.isBusinessCard) {
      proposed = `Carte de visite ${date}${ext}`;
      reason = "Carte de visite détectée.";
      signals.push("isBusinessCard");
    } else if (img.isScreenshot) {
      proposed = `Capture ${date}${ext}`;
      reason = "Capture d'écran détectée.";
      signals.push("isScreenshot");
    } else if (img.isDocument) {
      proposed = `Document scanné ${date}${ext}`;
      reason = "Document numérisé détecté.";
      signals.push("isDocument");
    }
  }

  // Fallback : nom générique (IMG_1234, DSC_...) → date + kind
  if (!proposed && /^(img|dsc|dcim|photo|vid|screenshot)[_-]?\d/i.test(entry.name)) {
    const date = formatDate(entry.mtime) ?? "";
    const label = entry.kind === "image" ? "Photo" : entry.kind === "video" ? "Vidéo" : "Fichier";
    proposed = date ? `${label} ${date}${ext}` : `${label}${ext}`;
    reason = "Nom générique remplacé par un intitulé lisible.";
    signals.push("mtime", "genericName");
  }

  if (!proposed) return null;
  // Nettoie : pas de double espace, pas de séparateur en trop
  proposed = proposed.replace(/\s+/g, " ").replace(/[/\\]/g, "-").trim();
  if (proposed === entry.name) return null;

  return {
    entryName: entry.name,
    parent,
    proposed,
    selected: true,
    reason,
    signals,
  };
}

export function proposeBatchRename(
  entries: { entry: FileEntry; parent: PathRef }[],
): RenameProposal[] {
  const out: RenameProposal[] = [];
  const usedByFolder = new Map<string, Set<string>>();
  for (const { entry, parent } of entries) {
    const p = proposeRename(entry, parent);
    if (!p) continue;
    const key = `${parent.rootId}:${parent.segments.join("/")}`;
    const used = usedByFolder.get(key) ?? new Set<string>();
    // évite collisions à l'intérieur du même dossier
    let candidate = p.proposed;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      const dot = p.proposed.lastIndexOf(".");
      candidate =
        dot > 0
          ? `${p.proposed.slice(0, dot)} (${n})${p.proposed.slice(dot)}`
          : `${p.proposed} (${n})`;
      n++;
    }
    used.add(candidate.toLowerCase());
    usedByFolder.set(key, used);
    out.push({ ...p, proposed: candidate });
    void slug; // exporté logiquement pour extensions futures
  }
  return out;
}

export const _internal = { slug };
