import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  CircleAlert,
  CircleX,
  Download,
  FileSearch,
  FileText,
  FileX,
  Files,
  Folder,
  HardDrive,
  Image,
  Music,
  Search,
  ShieldAlert,
  Star,
  Trash2,
  Video,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { emptyIllustrationCopy, type EmptyIllustrationId } from "@/lib/copy/empty-illustrations";

/**
 * État vide de GeniusFiles.
 *
 * Aucune illustration, aucune ressource graphique : une icône du système
 * d'icônes déjà utilisé partout dans l'application, un titre et une
 * description localisés, éventuellement une action. Le rendu est donc
 * identique — et parfaitement contrasté — en thème clair et en thème
 * sombre, et l'écran reste extrêmement léger.
 */
const ICONS: Record<EmptyIllustrationId, LucideIcon> = {
  files: Files,
  documents: FileText,
  images: Image,
  videos: Video,
  audio: Music,
  downloads: Download,
  favorites: Star,
  trash: Trash2,
  search: Search,
  folder: Folder,
  storage: HardDrive,
  permission: ShieldAlert,
  network: WifiOff,
  notFound: FileSearch,
  openFailed: FileX,
  lowSpace: HardDrive,
  unknownError: CircleAlert,
  operationFailed: CircleX,
};

export function IllustratedEmptyState({
  id,
  title,
  description,
  action,
  tone = "default",
  className = "",
}: {
  id: EmptyIllustrationId;
  /** Surcharge facultative (chaînes déjà localisées). */
  title?: string;
  description?: string;
  action?: ReactNode;
  /** « inverted » : posé sur un fond sombre de lecteur (contraste inversé). */
  tone?: "default" | "inverted";
  className?: string;
}) {
  const copy = useMemo(() => emptyIllustrationCopy(id), [id]);
  const Icon = ICONS[id];

  return (
    <div
      className={`flex min-h-[42vh] w-full flex-col items-center justify-center px-6 pb-[8vh] pt-6 text-center sm:min-h-[58vh] sm:pb-[12vh] ${className}`}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.5}
        className={`h-12 w-12 shrink-0 ${
          tone === "inverted" ? "text-reader-backdrop-foreground/70" : "text-muted-foreground"
        }`}
      />
      <div className="gf-empty-copy mt-4 flex max-w-[320px] shrink-0 flex-col items-center gap-1.5">
        <p
          className={`text-[17px] font-semibold leading-snug ${
            tone === "inverted" ? "text-reader-backdrop-foreground" : "text-foreground"
          }`}
        >
          {title ?? copy.title}
        </p>
        <p
          className={`text-[13.5px] leading-relaxed ${
            tone === "inverted" ? "text-reader-backdrop-foreground/70" : "text-muted-foreground"
          }`}
        >
          {description ?? copy.description}
        </p>
        {action ? <div className="pt-3">{action}</div> : null}
      </div>
    </div>
  );
}
