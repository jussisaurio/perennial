// Where the 3D walk opens: on one plant ("View in garden"), or by the bowl,
// where prints lead to what a guest left (#335: the way in from Today's strip).
export type Focus = { at: "plant"; id: string } | { at: "bowl" };

let pending: Focus | null = null;

export const focusPlant = (id: string) => void (pending = { at: "plant", id });
export const focusBowl = () => void (pending = { at: "bowl" });

/** Where to open, once. */
export function takeFocus(): Focus | null {
  const f = pending;
  pending = null;
  return f;
}
