/**
 * Écran de diagnostic clavier.
 *
 * Affiche en temps réel les propriétés clavier appliquées au champ actif
 * et les événements reçus, pour vérifier depuis l'APK / AAB Android que
 * Gboard (ou tout autre IME) reçoit bien les indices attendus :
 * suggestions, correction, majuscule automatique, ponctuation
 * intelligente, langue, etc.
 *
 * Route accessible via /diagnostic-clavier.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/common/PageHeader";

export const Route = createFileRoute("/diagnostic-clavier")({
  component: KeyboardDiagnosticsPage,
  head: () => ({
    meta: [
      { title: "Test du clavier — GeniusFiles" },
      {
        name: "description",
        content:
          "Vérifiez que le clavier Android affiche bien les suggestions, la correction et les majuscules attendues.",
      },
      { property: "og:title", content: "Test du clavier — GeniusFiles" },
      {
        property: "og:description",
        content: "Vérifiez le comportement du clavier Android dans GeniusFiles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type FieldKind = "text" | "search" | "sentence" | "words" | "multiline" | "password";

const PRESETS: Record<
  FieldKind,
  {
    label: string;
    autoCorrect: string;
    autoCapitalize: "off" | "sentences" | "words" | "characters" | "none";
    spellCheck: boolean;
    enterKeyHint: string;
    inputMode: string;
    type: string;
  }
> = {
  text: {
    label: "Texte (nom de dossier, renommage)",
    autoCorrect: "on",
    autoCapitalize: "sentences",
    spellCheck: true,
    enterKeyHint: "done",
    inputMode: "text",
    type: "text",
  },
  search: {
    label: "Recherche",
    autoCorrect: "on",
    autoCapitalize: "sentences",
    spellCheck: true,
    enterKeyHint: "search",
    inputMode: "search",
    type: "text",
  },
  sentence: {
    label: "Conversation (notes, commentaires)",
    autoCorrect: "on",
    autoCapitalize: "sentences",
    spellCheck: true,
    enterKeyHint: "send",
    inputMode: "text",
    type: "text",
  },
  words: {
    label: "Nom propre / titre court",
    autoCorrect: "on",
    autoCapitalize: "words",
    spellCheck: true,
    enterKeyHint: "done",
    inputMode: "text",
    type: "text",
  },
  multiline: {
    label: "Commentaire multiligne",
    autoCorrect: "on",
    autoCapitalize: "sentences",
    spellCheck: true,
    enterKeyHint: "enter",
    inputMode: "text",
    type: "textarea",
  },
  password: {
    label: "Mot de passe (comparaison)",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    enterKeyHint: "done",
    inputMode: "text",
    type: "password",
  },
};

function KeyboardDiagnosticsPage() {
  const [kind, setKind] = useState<FieldKind>("sentence");
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [lang, setLang] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const preset = PRESETS[kind];

  useEffect(() => {
    setLang(navigator.language || (navigator.languages && navigator.languages[0]) || "?");
  }, []);

  const log = (label: string) =>
    setEvents((e) => [`${new Date().toLocaleTimeString()} · ${label}`, ...e].slice(0, 40));

  const commonHandlers = {
    onFocus: () => {
      setFocused(true);
      log("focus");
    },
    onBlur: () => {
      setFocused(false);
      log("blur");
    },
    onKeyDown: (e: React.KeyboardEvent) => log(`keydown "${e.key}"`),
    onCompositionStart: () => log("saisie en cours (clavier prédictif actif)"),
    onCompositionEnd: (e: React.CompositionEvent) => log(`compositionend "${e.data}"`),
    onBeforeInput: (e: React.FormEvent) => {
      const ie = e as unknown as InputEvent;
      log(`beforeinput ${ie.inputType ?? ""} "${ie.data ?? ""}"`);
    },
  };

  return (
    <AppShell>
      <PageHeader
        title="Test du clavier"
        subtitle="Vérifiez que le clavier Android réagit correctement selon le type de champ"
      />

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Type de champ
          </label>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FieldKind);
              setValue("");
              setEvents([]);
            }}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
          >
            {(Object.keys(PRESETS) as FieldKind[]).map((k) => (
              <option key={k} value={k}>
                {PRESETS[k].label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Champ de test
          </label>
          {preset.type === "textarea" ? (
            <textarea
              ref={(n) => {
                inputRef.current = n;
              }}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoCorrect={preset.autoCorrect}
              autoCapitalize={preset.autoCapitalize}
              spellCheck={preset.spellCheck}
              enterKeyHint={
                preset.enterKeyHint as React.HTMLAttributes<HTMLElement>["enterKeyHint"]
              }
              inputMode={preset.inputMode as React.HTMLAttributes<HTMLElement>["inputMode"]}
              rows={4}
              placeholder="Tapez ici pour tester le clavier…"
              {...commonHandlers}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
            />
          ) : (
            <input
              ref={(n) => {
                inputRef.current = n;
              }}
              type={preset.type}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoCorrect={preset.autoCorrect}
              autoCapitalize={preset.autoCapitalize}
              spellCheck={preset.spellCheck}
              enterKeyHint={
                preset.enterKeyHint as React.HTMLAttributes<HTMLElement>["enterKeyHint"]
              }
              inputMode={preset.inputMode as React.HTMLAttributes<HTMLElement>["inputMode"]}
              placeholder="Tapez ici pour tester le clavier…"
              {...commonHandlers}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
            />
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-3 text-[12px] leading-relaxed">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Comportement attendu pour ce champ
          </div>
          <Row k="Type de champ" v={preset.label} />
          <Row
            k="Correction automatique"
            v={preset.autoCorrect === "on" ? "activée" : "désactivée"}
          />
          <Row
            k="Majuscule automatique"
            v={preset.autoCapitalize === "none" ? "désactivée" : "activée"}
          />
          <Row k="Suggestions attendues" v={preset.spellCheck ? "oui" : "non"} />
          <Row k="Langue détectée" v={lang || "non détectée"} />
          <Row k="Champ actif" v={focused ? "oui" : "non"} />
          <Row k="Caractères saisis" v={String(value.length)} />
        </div>

        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Activité du clavier
            </div>
            <button
              type="button"
              onClick={() => setEvents([])}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Vider
            </button>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto text-[11px] font-mono text-muted-foreground">
            {events.length === 0 ? (
              <div className="opacity-60">Aucun événement pour le moment.</div>
            ) : (
              events.map((e, i) => <div key={i}>{e}</div>)
            )}
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Astuce : si les suggestions ou la majuscule automatique ne s'affichent pas sur cet écran,
          le problème vient du clavier système lui-même (paramètres Gboard/SwiftKey), pas de
          l'application.
        </p>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate font-mono text-foreground">{v}</span>
    </div>
  );
}
