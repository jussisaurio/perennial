// Gifted seeds (#213): a learner gives a known word to a friend as a link,
// `/?seed=<deck word id>` (deck ids start with their language, "es.w.93eb423hjf").
// The friend's course takes that word as its next new word. The link carries
// only the word: no names, no account, no progress. It waits on this device
// until the friend starts.

import { COURSE_LANGUAGES } from "../content/languages";

export interface Gift {
  lang: string;
  wordId: string;
}

const KEY = "perennial-seed";
const PARAM = "seed";

/** The share link for a word. */
export function giftLink(wordId: string): string {
  return `${location.origin}/?${PARAM}=${encodeURIComponent(wordId)}`;
}

/** A deck word id → a gift, or null when the shape is wrong or the language is not a course here. */
export function parseGift(value: string | null): Gift | null {
  const m = value?.match(/^([a-z]{2,3})\.w\.[a-z0-9]{4,24}$/);
  if (!m || !COURSE_LANGUAGES.some((l) => l.code === m[1])) return null;
  return { lang: m[1], wordId: m[0] };
}

/**
 * On page load: keep a gift from the address on this device, and take it out
 * of the address so a reload or a shared tab does not bring it again.
 */
export function takeGiftFromUrl(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return;
  const gift = parseGift(url.searchParams.get(PARAM));
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  if (!gift) return; // A broken or foreign link: nothing to keep.
  try {
    localStorage.setItem(KEY, JSON.stringify(gift));
  } catch {
    // No storage: the gift is lost on this device. Nothing else to do.
  }
}

export function pendingGift(): Gift | null {
  try {
    const raw = localStorage.getItem(KEY);
    // Stored by takeGiftFromUrl; parsed again so a hand-edited value cannot get through.
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<Gift>;
    return parseGift(g.wordId ?? null);
  } catch {
    return null; // No storage, or not JSON: no gift.
  }
}

export function clearGift(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // No storage: nothing was kept.
  }
}
