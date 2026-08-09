import {
  ArrowUpFromLine,
  ExternalLink,
  FileArchive,
  FileText,
  Info,
  Lock,
  PinOff,
  Pin,
  Scissors,
  Share2,
  Home,
  EyeOff,
  type LucideIcon,
} from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import type { MoreAction, MoreActionId } from "@/lib/files/selection-actions";

const ICONS: Record<MoreActionId, LucideIcon> = {
  share: Share2,
  openWith: ExternalLink,
  compress: FileArchive,
  moveToVault: Lock,
  openAs: FileText,
  properties: Info,
  cut: Scissors,
  pin: Pin,
  hide: EyeOff,
  addToHome: Home,
};

/**
 * Renders the "Plus" sheet for a selection. The list of actions is
 * computed upstream by the selection-actions rules engine so this
 * component only handles presentation. No disabled items are shown —
 * upstream must omit unavailable actions.
 */
export function MoreActionsSheet({
  open,
  actions,
  onClose,
  isPinned,
}: {
  open: boolean;
  actions: MoreAction[];
  onClose: () => void;
  isPinned?: boolean;
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col">
        {actions.map((a) => {
          let Icon: LucideIcon = ICONS[a.id];
          if (a.id === "pin" && isPinned) Icon = PinOff;
          if (a.id === "addToHome") Icon = ArrowUpFromLine;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onClose();
                a.onClick();
              }}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-left text-[13.5px] transition-colors active:bg-secondary/60 hover:bg-secondary/60 ${
                a.danger ? "text-red-400" : "text-foreground"
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  a.danger ? "bg-red-500/12 text-red-400" : "bg-secondary/60 text-muted-foreground"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
            </button>
          );
        })}
        {actions.length === 0 ? (
          <p className="px-2 py-4 text-center text-[12px] text-muted-foreground">
            Aucune action supplémentaire disponible.
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}
