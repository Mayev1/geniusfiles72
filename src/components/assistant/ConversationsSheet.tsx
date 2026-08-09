/**
 * Historique des conversations Genius AI (recherche, ouverture,
 * renommage, suppression, création).
 */
import { useMemo, useState } from "react";
import { MessageSquare, Search, Trash2, Pencil, Plus, Check, X } from "lucide-react";
import { BottomSheet } from "@/components/files/BottomSheet";
import {
  deleteConversation,
  formatDay,
  listConversations,
  renameConversation,
  type ConversationMeta,
} from "@/lib/ai/conversations";

export function ConversationsSheet({
  open,
  onClose,
  activeId,
  onOpenConversation,
  onNewConversation,
}: {
  open: boolean;
  onClose: () => void;
  activeId: string;
  onOpenConversation: (id: string) => void;
  onNewConversation: () => void;
}) {
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const items = useMemo<ConversationMeta[]>(() => {
    if (!open) return [];
    void tick;
    const all = listConversations();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
    );
  }, [open, query, tick]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Conversations">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            onNewConversation();
            onClose();
          }}
          className="flex w-full items-center gap-2.5 rounded-2xl bg-primary px-4 py-3 text-[14px] font-medium text-primary-foreground transition-transform duration-150 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" />
          Nouvelle conversation
        </button>

        <div className="flex h-11 items-center gap-2.5 rounded-2xl bg-surface-2 px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une conversation…"
            aria-label="Rechercher une conversation"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {items.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            {query
              ? "Aucune conversation ne correspond à cette recherche."
              : "Aucune conversation pour l'instant. Écrivez à Genius AI pour en commencer une."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((c) => {
              const editing = editingId === c.id;
              return (
                <li
                  key={c.id}
                  className={`rounded-2xl border px-3 py-2.5 transition-colors ${
                    c.id === activeId
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-surface"
                  }`}
                >
                  {editing ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="Nouveau nom"
                        className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2 text-[14px] focus:outline-none"
                      />
                      <button
                        type="button"
                        aria-label="Valider"
                        onClick={() => {
                          renameConversation(c.id, draft);
                          setEditingId(null);
                          setTick((t) => t + 1);
                        }}
                        className="rounded-xl bg-primary/15 p-2 text-primary"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Annuler"
                        onClick={() => setEditingId(null)}
                        className="rounded-xl bg-surface-2 p-2 text-muted-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenConversation(c.id);
                          onClose();
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <MessageSquare className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-foreground">
                            {c.title}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {formatDay(c.updatedAt)} · {c.preview || "—"}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Renommer ${c.title}`}
                        onClick={() => {
                          setEditingId(c.id);
                          setDraft(c.title);
                        }}
                        className="rounded-xl p-2 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Supprimer ${c.title}`}
                        onClick={() => {
                          deleteConversation(c.id);
                          setTick((t) => t + 1);
                        }}
                        className="rounded-xl p-2 text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
