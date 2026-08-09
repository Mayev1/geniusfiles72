/**
 * Smooth Android-style page transitions.
 *
 * Uses the View Transitions API when available (Chromium / Android
 * WebView 111+) so the browser cross-fades the DOM between old and new
 * routes without a keyed remount (no scroll-jump, no state loss, no
 * flash). Falls back to a no-op elsewhere so routes still render
 * instantly.
 *
 * Hooked to TanStack Router via `router.subscribe('onBeforeNavigate')`
 * from the root component.
 */
import type { AnyRouter } from "@tanstack/react-router";

type ViewTransitionCapableDocument = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
};

let installed = false;

export function installPageTransitions(router: AnyRouter) {
  if (installed || typeof window === "undefined") return;
  const doc = document as ViewTransitionCapableDocument;
  if (typeof doc.startViewTransition !== "function") return;
  installed = true;

  // Detect prefers-reduced-motion — respect the OS/browser setting.
  const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (mq?.matches) return;

  router.subscribe("onBeforeNavigate", (event) => {
    // Skip when it's a hash-only or same-URL navigation.
    if (event.fromLocation?.pathname === event.toLocation.pathname) return;

    // The browser starts the transition; we don't await the promise
    // returned by the callback — TanStack updates React synchronously
    // during the tick after navigation resolves, which the View
    // Transitions API captures for us.
    const cb = () => {
      // Nothing to do here: the router will re-render the tree in the
      // same microtask, and the browser diffs before/after snapshots.
    };
    try {
      doc.startViewTransition?.(cb);
    } catch {
      /* older browsers or already inside a transition */
    }
  });
}
