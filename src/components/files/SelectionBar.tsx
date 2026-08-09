import {
  ArrowLeftRight,
  CheckCheck,
  Copy,
  FolderInput,
  MoreHorizontal,
  Share2,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { Portal } from "@/components/common/Portal";

/**
 * SelectionActionRow — contenu Material 3 de la *seule* première ligne
 * (App Bar) pendant une sélection :
 *
 *   [X]   «N sélectionné(s)»   [Tout] [Intervalle]
 *
 * Rendue **en flux**, à la place de la ligne d'actions normale, avec la même
 * hauteur : la deuxième ligne (fil d'Ariane / onglets) reste donc visible, à
 * la même position, sans recouvrement ni décalage.
 */
export function SelectionActionRow({
  count,
  sizeLabel,
  onClear,
  onSelectAll,
  onSelectRange,
}: {
  count: number;
  /** Taille totale réelle (« 482 Mo ») ou « Calcul… » pendant la mesure. */
  sizeLabel?: string | null;
  onClear: () => void;
  onSelectAll: () => void;
  onSelectRange?: () => void;
}) {
  return (
    <div
      className="grid h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 px-1.5"
      style={{ animation: "gf-bar-in-top 180ms cubic-bezier(0.2, 0, 0, 1) both" }}
    >
      <button
        type="button"
        onClick={onClear}
        aria-label="Quitter la sélection"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors active:bg-secondary/60"
      >
        <X className="h-[22px] w-[22px]" strokeWidth={2.1} />
      </button>
      <span className="flex min-w-0 flex-col justify-center px-1 leading-tight">
        <span className="truncate text-[16px] font-semibold text-foreground">
          {count} sélectionné{count > 1 ? "s" : ""}
        </span>
        {sizeLabel ? (
          <span className="truncate text-[11.5px] font-medium text-muted-foreground">
            {sizeLabel}
          </span>
        ) : null}
      </span>
      <div className="flex shrink-0 items-center gap-3 pr-1">
        <TopAction icon={CheckCheck} label="Tout" onClick={onSelectAll} />
        {onSelectRange ? (
          <TopAction icon={ArrowLeftRight} label="Intervalle" onClick={onSelectRange} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * SelectionTopBar — en-tête collant autonome pour les écrans sans fil
 * d'Ariane (catégories, recherche…). Même hauteur que la barre d'actions
 * normale ; les éventuels enfants (deuxième ligne) restent visibles.
 */
export function SelectionTopBar({
  count,
  sizeLabel,
  onClear,
  onSelectAll,
  onSelectRange,
  children,
}: {
  count: number;
  sizeLabel?: string | null;
  onClear: () => void;
  onSelectAll: () => void;
  onSelectRange?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-border/60 bg-background/95 pt-safe backdrop-blur">
      <div className="pl-safe pr-safe">
        <SelectionActionRow
          count={count}
          sizeLabel={sizeLabel}
          onClear={onClear}
          onSelectAll={onSelectAll}
          onSelectRange={onSelectRange}
        />
        {children}
      </div>
    </header>
  );
}

function TopAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof CheckCheck;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex min-w-[52px] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1 text-[10.5px] font-medium leading-none text-muted-foreground transition-colors hover:text-foreground active:bg-secondary/60"
    >
      <Icon className="h-[21px] w-[21px]" strokeWidth={2} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/**
 * Bottom Action Bar fixe — toujours visible, jamais dans le flux de la
 * liste, positionnée juste au-dessus de la barre de navigation principale
 * et respectant les insets Android. Un espaceur en flux évite qu'elle
 * masque la fin du contenu.
 */
export function SelectionBar({
  count,
  onCopy,
  onMove,
  onDelete,
  onRename,
  onShare,
  onMore,
}: {
  count: number;
  /** @deprecated conservé pour compat ; ignoré. */
  singleName?: string;
  /** @deprecated déplacé vers SelectionTopBar ; ignoré. */
  onClear?: () => void;
  /** @deprecated déplacé vers SelectionTopBar ; ignoré. */
  onSelectAll?: () => void;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRename: () => void;
  onShare?: () => void;
  onMore: () => void;
}) {
  const canRename = count === 1;
  return (
    <>
      {/* Espaceur : la barre est `fixed`, elle ne doit rien recouvrir. */}
      <div aria-hidden className="h-24 w-full shrink-0" />
      <Portal>
        <nav
          className="fixed inset-x-0 z-[55] mx-auto max-w-[560px] px-3 pl-safe pr-safe"
          aria-label="Actions de sélection"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
            animation: "gf-bar-in-bottom 220ms cubic-bezier(0.2, 0, 0, 1) both",
          }}
        >
          <div className="grid grid-cols-6 items-stretch gap-0.5 rounded-[22px] border border-border bg-surface px-1 py-1.5 shadow-elevated">
            <BarAction icon={Share2} label="Partager" onClick={onShare ?? onMore} />
            <BarAction icon={SquarePen} label="Renommer" onClick={onRename} disabled={!canRename} />
            <BarAction icon={Copy} label="Copier" onClick={onCopy} />
            <BarAction icon={FolderInput} label="Déplacer" onClick={onMove} />
            <BarAction icon={Trash2} label="Supprimer" onClick={onDelete} danger />
            <BarAction icon={MoreHorizontal} label="Plus" onClick={onMore} />
          </div>
        </nav>
      </Portal>
    </>
  );
}

function BarAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl py-2 text-[11px] font-medium leading-none transition-colors disabled:opacity-40 ${
        danger
          ? "text-destructive active:bg-destructive/10"
          : "text-muted-foreground active:bg-secondary/60 hover:text-foreground"
      }`}
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}
