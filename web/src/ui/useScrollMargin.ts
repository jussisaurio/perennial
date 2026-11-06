import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * How far down the page a window-scrolled virtual list starts: its scrollMargin.
 * Banners above the list can appear or change size later, and then the page
 * does too. A ResizeObserver on the page reads the offset after layout, so it
 * costs no extra layout: reading it after every render forced one per scroll
 * step (perf/ui.ts, #453).
 */
export function useScrollMargin(list: RefObject<HTMLElement | null>): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const el = list.current!; // !: layout effects run after the list mounts
    const ro = new ResizeObserver(() => setOffset(el.getBoundingClientRect().top + window.scrollY));
    ro.observe(el.parentElement!); // !: the list is always inside the page
    return () => ro.disconnect();
  }, [list]);
  return offset;
}
