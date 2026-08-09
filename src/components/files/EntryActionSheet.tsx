import {
  Copy,
  ExternalLink,
  Eye,
  FileArchive,
  FolderInput,
  Info,
  Package,
  PackageOpen,
  Share2,
  SquarePen,
  Trash2,
  Clapperboard,
  Waves,
} from "lucide-react";
import type { FileEntry } from "@/lib/files/types";
import { FileIcon } from "./FileIcon";
import { BottomSheet } from "./BottomSheet";
import { canReadArchive } from "@/lib/files/archive";
import { canOpenInViewer, canPreview } from "@/lib/viewer/kinds";

export type EntryAction =
  | "info"
  | "rename"
  | "share"
  | "copy"
  | "move"
  | "delete"
  | "compress"
  | "openArchive"
  | "extract"
  | "open"
  | "openWith"
  | "editAudio"
  | "editVideo";

/**
 * Long-press / more-menu action sheet for a single entry.
 *
 * Canonical action order (identical across the app so users build muscle
 * memory) : Ouvrir · Ouvrir avec… · Partager · Renommer · Copier ·
 * Déplacer · Compresser · Informations · Supprimer. Archive-specific
 * actions are grouped at the top when the entry is an archive.
 */
export function EntryActionSheet({
  open,
  entry,
  onClose,
  onAction,
}: {
  open: boolean;
  entry: FileEntry | null;
  onClose: () => void;
  onAction: (action: EntryAction) => void;
}) {
  const isArchive = entry ? canReadArchive(entry) : false;
  const showOpen = entry ? canOpenInViewer(entry) && canPreview(entry) : false;
  const showOpenWith = entry ? !entry.isDirectory : false;
  const showEditAudio = entry ? !entry.isDirectory && entry.kind === "audio" : false;
  const showEditVideo = entry ? !entry.isDirectory && entry.kind === "video" : false;
  return (
    <BottomSheet open={open && !!entry} onClose={onClose}>
      {entry ? (
        <>
          <div className="mb-3 flex items-center gap-3">
            <FileIcon kind={entry.kind} path={entry.path} />
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{entry.name}</p>
          </div>
          <div className="flex flex-col">
            {isArchive ? (
              <>
                <ActionRow
                  icon={PackageOpen}
                  label="Ouvrir l'archive"
                  onClick={() => onAction("openArchive")}
                />
                <ActionRow icon={Package} label="Extraire…" onClick={() => onAction("extract")} />
                <div className="my-1 h-px bg-border/40" />
              </>
            ) : null}
            {showOpen ? (
              <ActionRow
                icon={Eye}
                label="Ouvrir avec GeniusFiles"
                onClick={() => onAction("open")}
              />
            ) : null}
            {showOpenWith ? (
              <ActionRow
                icon={ExternalLink}
                label="Ouvrir avec une autre application"
                onClick={() => onAction("openWith")}
              />
            ) : null}
            {showEditAudio ? (
              <ActionRow
                icon={Waves}
                label="Modifier l'audio"
                onClick={() => onAction("editAudio")}
              />
            ) : null}
            {showEditVideo ? (
              <ActionRow
                icon={Clapperboard}
                label="Modifier la vidéo"
                onClick={() => onAction("editVideo")}
              />
            ) : null}
            {!entry.isDirectory ? (
              <ActionRow icon={Share2} label="Partager" onClick={() => onAction("share")} />
            ) : null}
            <ActionRow icon={SquarePen} label="Renommer" onClick={() => onAction("rename")} />
            <ActionRow icon={Copy} label="Copier vers…" onClick={() => onAction("copy")} />
            <ActionRow icon={FolderInput} label="Déplacer vers…" onClick={() => onAction("move")} />
            <ActionRow
              icon={FileArchive}
              label="Compresser…"
              onClick={() => onAction("compress")}
            />
            <ActionRow icon={Info} label="Informations" onClick={() => onAction("info")} />
            <div className="my-1 h-px bg-border/40" />
            <ActionRow icon={Trash2} label="Supprimer" onClick={() => onAction("delete")} danger />
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
  icon: typeof Info;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-left text-[13.5px] transition-colors active:bg-secondary/60 hover:bg-secondary/60 ${
        danger ? "text-red-400" : "text-foreground"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          danger ? "bg-red-500/12 text-red-400" : "bg-secondary/60 text-muted-foreground"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
