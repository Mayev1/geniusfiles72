import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Transitions de page fluides (View Transitions API) : plus aucun
    // changement brusque entre deux écrans.
    defaultViewTransition: true,
    // Empêche le clignotement d'un état de chargement trop court.
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
    // Précharge la route dès que l'utilisateur survole/pointe un lien
    // (~50 ms), rendant la navigation quasi-instantanée.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
