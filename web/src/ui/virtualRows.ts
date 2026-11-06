import { measureElement, windowScroll, type Virtualizer } from "@tanstack/react-virtual";

/**
 * Options for a window virtualizer that never forces a layout when a list mounts (#525).
 * Each forced layout lays out the whole new screen: at CPU 10× the row measures
 * cost about 24 ms and the opening scroll about 15 ms of one task.
 */
export const noForcedLayout = {
  // A new row takes its last known size, or the estimate; its ResizeObserver
  // entry, which comes after the browser's own layout, gives the real one.
  measureElement: (el: Element, entry: ResizeObserverEntry | undefined, v: Virtualizer<Window, Element>) =>
    entry ? measureElement(el, entry, v) : (v.itemSizeCache.get(v.options.getItemKey(v.indexFromElement(el))) ?? v.options.estimateSize(v.indexFromElement(el))),
  // The first scroll is the mount's: to window.scrollY, read in the first render,
  // so the page is already there. Later scrolls (size corrections) run.
  scrollToFn: (offset: number, options: { adjustments?: number; behavior?: ScrollBehavior }, v: Virtualizer<Window, Element>) => {
    if (!mounted.has(v)) {
      mounted.add(v);
      return;
    }
    windowScroll(offset, options, v);
  },
};

const mounted = new WeakSet<Virtualizer<Window, Element>>();
