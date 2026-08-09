import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Home, Zap, Settings, Sparkles, FileText } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PlayerHost } from "@/components/player/PlayerHost";
import { QuickScrollFab } from "@/components/common/QuickScrollFab";
import { TransferTracker } from "@/components/jobs/TransferTracker";
import { useReaderMode } from "@/lib/viewer/reader-mode";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
};

const NAV: NavItem[] = [
  { to: "/", label: "Accueil", icon: Home },
  { to: "/assistant", label: "Assistant", icon: Sparkles },
  { to: "/automatisations", label: "Automatisations", icon: Zap },
  { to: "/pdf-outils", label: "Outils PDF", icon: FileText },
  { to: "/parametres", label: "Paramètres", icon: Settings },
];

export function AppShell({ children }: { children?: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  /* Pendant la lecture d'un document, la navigation principale est
     entièrement retirée de l'arbre : aucune hauteur, aucun événement. */
  const reader = useReaderMode();
  const isHome = pathname === "/";
  /* Écrans dotés d'un en-tête collant (FilesTopBar ou PageHeader) : ils
     absorbent eux-mêmes l'inset supérieur. Un padding ici laisserait une
     bande vide au-dessus du titre. */
  const ownsSafeArea =
    isHome ||
    ["/categorie", "/parametres", "/automatisations", "/pdf-outils", "/outils"].some((p) =>
      pathname.startsWith(p),
    );
  /* La conversation gère elle-même sa hauteur et son espace bas (nav + clavier). */
  const isChat = pathname.startsWith("/assistant");


  return (
    <div
      /* overflow-x-clip (et non hidden) : « hidden » crée un conteneur de
         défilement qui casse position:sticky des en-têtes. */
      className={`mx-auto flex w-full max-w-[560px] flex-col overflow-x-clip bg-background ${
        isChat ? "h-dvh overflow-y-hidden" : "min-h-dvh"
      }`}
    >
      <main
        className={
          isChat
            ? "flex min-h-0 flex-1 flex-col px-0 pb-0 pt-0"
            : `flex-1 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] ${
                ownsSafeArea ? "pt-0" : "pt-safe"
              }`
        }
      >
        {/* Aucune clé sur le conteneur : une clé par chemin remonterait
            tout l'écran à chaque navigation (perte d'état, de position de
            défilement et clignotement au retour). */}
        <div className={isChat ? "gf-page flex min-h-0 flex-1 flex-col" : "gf-page"}>
          {children ?? <Outlet />}
        </div>
      </main>
      <PlayerHost />
      {/* Navigation verticale rapide : la fenêtre est le conteneur défilant
          de tous les écrans de listes. Masquée en mode lecture (le lecteur
          monte sa propre pastille sur son contenu) et en conversation. */}
      {isChat || reader ? null : <QuickScrollFab topInset={72} bottomInset={96} />}
      {/* Transferts en arrière-plan : suivi permanent (sans interface). */}
      <TransferTracker />
      {reader ? null : <BottomNav pathname={pathname} />}
      {/* Écran opaque de la barre d'état : garantit qu'aucun contenu
          scrollé ne puisse apparaître derrière elle, sur toutes les pages
          (le lecteur plein écran a sa propre barre opaque). */}
      {reader ? null : (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-50 h-safe-top bg-background"
        />
      )}
    </div>
  );
}


function BottomNav({ pathname }: { pathname: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const activeTo =
    NAV.find(({ to }) => (to === "/" ? pathname === "/" : pathname.startsWith(to)))?.to ?? null;

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const el = activeTo ? itemRefs.current[activeTo] : null;
      if (!container || !el) {
        setPill(null);
        return;
      }
      const c = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setPill({ left: r.left - c.left, width: r.width });
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 220);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [activeTo, pathname]);

  return (
    <nav
      className="animate-fade-in pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[560px] justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pl-safe pr-safe"
      aria-label="Navigation principale"
    >
      <div
        ref={containerRef}
        className="pointer-events-auto relative flex w-full items-center justify-between gap-0.5 rounded-full bg-nav-bar px-1.5 py-2 shadow-[0_12px_32px_-8px_rgb(11_63_143/0.45)]"
      >
        {pill ? (
          <span
            aria-hidden
            className="absolute top-2 bottom-2 rounded-full bg-nav-pill transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ left: pill.left, width: pill.width }}
          />
        ) : null}

        {NAV.map(({ to, label, icon: Icon }) => {
          const active = to === activeTo;
          return (
            <Link
              key={to}
              to={to}
              ref={(el) => {
                itemRefs.current[to] = el;
              }}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              className={`relative z-10 flex h-12 min-w-10 items-center justify-center gap-1.5 rounded-full px-1.5 transition-[flex-grow,padding,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95 ${
                active ? "grow px-3" : "grow-0"
              }`}
            >
              <Icon
                className={`h-[20px] w-[20px] shrink-0 transition-colors duration-200 ${
                  active ? "text-nav-pill-foreground" : "text-nav-inactive"
                }`}
                strokeWidth={active ? 2.4 : 2}
              />
              {active ? (
                <span className="animate-fade-in whitespace-nowrap text-[12px] font-semibold leading-none text-nav-pill-foreground">
                  {label}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
