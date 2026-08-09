/**
 * Thin wrapper around @tanstack/react-virtual for window-scrolled lists.
 *
 * The app uses a single scroll container (the document / <main>), so we
 * always window-virtualize. Consumers pass a FIXED row height and the item
 * count: fixed rows keep scrolling perfectly stable (no re-measure, no
 * "dancing" items) even when flinging through 100k entries.
 *
 * `scrollMargin` is tracked from the list's document offset — without it the
 * virtualizer maps window scroll to the wrong item range, which is what makes
 * rows jump or blank out mid-scroll.
 */
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type WindowVirtualOptions = {
  count: number;
  estimateSize: number;
  overscan?: number;
  gap?: number;
  /** Below this item count, virtualization is skipped. */
  threshold?: number;
};

export function useWindowVirtualList(opts: WindowVirtualOptions) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const threshold = opts.threshold ?? 30;
  const enabled = opts.count > threshold;
  const [scrollMargin, setScrollMargin] = useState(0);

  const virtualizer = useWindowVirtualizer({
    count: enabled ? opts.count : 0,
    estimateSize: () => opts.estimateSize,
    overscan: opts.overscan ?? 8,
    gap: opts.gap ?? 0,
    scrollMargin,
  });

  // Track the list's offset from the top of the document. Changes whenever
  // the header height, filters, or route chrome above the list changes.
  useIsoLayoutEffect(() => {
    if (!enabled) return;
    const el = parentRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const node = parentRef.current;
        if (!node) return;
        const top = Math.round(node.getBoundingClientRect().top + window.scrollY);
        setScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    if (document.body) ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);

  return { enabled, parentRef, virtualizer, scrollMargin };
}
