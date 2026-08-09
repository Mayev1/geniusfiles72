/**
 * Dashboard recommendations engine.
 *
 * Purely informative for now — every recommendation points the user
 * to the right screen but never triggers an action automatically.
 */
import type { StorageStats } from "@/lib/native/use-storage-stats";
import type { ScanResult } from "./analyzer";
import type { FreeSnapshot } from "./snapshots";
import { formatSize } from "./format";

export type RecommendationSeverity = "info" | "warn" | "danger";

export type Recommendation = {
  id: string;
  severity: RecommendationSeverity;
  title: string;
  description: string;
  ctaLabel?: string;
  to?: string;
};

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export function buildRecommendations(
  stats: StorageStats | null,
  scan: ScanResult | null,
  snapshots: FreeSnapshot[],
  trash?: { count: number; bytes: number } | null,
): Recommendation[] {
  const recs: Recommendation[] = [];

  if (stats) {
    if (stats.usedPct >= 92) {
      recs.push({
        id: "storage-critical",
        severity: "danger",
        title: "Stockage presque plein",
        description: `Il ne reste que ${formatSize(stats.free)} libres sur ${formatSize(
          stats.total,
        )}. Libérez de l'espace pour préserver les performances de votre téléphone.`,
        ctaLabel: "Libérer",
        to: "/outils",
      });
    } else if (stats.usedPct >= 80) {
      recs.push({
        id: "storage-warn",
        severity: "warn",
        title: "Stockage bien rempli",
        description: `${Math.round(stats.usedPct)}% du stockage est utilisé. Un nettoyage préventif est recommandé.`,
        ctaLabel: "Analyser",
        to: "/outils",
      });
    }
  }

  if (snapshots.length >= 3) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const delta = first.free - last.free;
    // >2 Go perdus sur la fenêtre = tendance à surveiller.
    if (delta > 2 * GB) {
      recs.push({
        id: "trend-down",
        severity: "warn",
        title: "Espace libre en baisse",
        description: `Vous avez utilisé environ ${formatSize(delta)} sur les derniers jours. Vérifiez ce qui prend de la place.`,
        ctaLabel: "Voir la répartition",
      });
    }
  }

  if (scan && scan.totalFiles > 0) {
    const apk = scan.categories.apk;
    if (apk.bytes > 300 * MB) {
      recs.push({
        id: "apk",
        severity: "info",
        title: `${apk.count} fichier${apk.count > 1 ? "s" : ""} d'installation (APK)`,
        description: `${formatSize(apk.bytes)} occupés par des APK. Supprimez ceux que vous n'utilisez plus après installation.`,
        ctaLabel: "Ouvrir",
        to: "/",
      });
    }
    const archive = scan.categories.archive;
    if (archive.bytes > GB) {
      recs.push({
        id: "archive",
        severity: "info",
        title: "Archives volumineuses",
        description: `${formatSize(archive.bytes)} d'archives détectées. Décompressez celles dont vous avez besoin et supprimez les autres.`,
      });
    }
    const video = scan.categories.video;
    if (video.bytes > 5 * GB) {
      recs.push({
        id: "video",
        severity: "info",
        title: "Vidéos volumineuses",
        description: `Vos vidéos représentent ${formatSize(video.bytes)}. Envisagez de déplacer les plus anciennes vers la carte SD ou un disque externe pour libérer de la place.`,
      });
    }
  }
  if (trash && trash.bytes > 500 * MB) {
    recs.push({
      id: "trash-large",
      severity: "info",
      title: "La Corbeille prend de la place",
      description: `${formatSize(trash.bytes)} sont conservés dans la Corbeille (${trash.count} élément${trash.count > 1 ? "s" : ""}). Videz-la pour récupérer immédiatement cet espace.`,
      ctaLabel: "Ouvrir la Corbeille",
      to: "/corbeille",
    });
  }

  if (recs.length === 0) {
    recs.push({
      id: "all-good",
      severity: "info",
      title: "Tout est en ordre",
      description:
        "Aucune action prioritaire détectée. Le tableau de bord vous alertera dès qu'une optimisation sera pertinente.",
    });
  }

  return recs;
}
