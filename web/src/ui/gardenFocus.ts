// Where the 3D walk opens: on one plant ("View in garden").
export type Focus = { at: "plant"; id: string };

let pending: Focus | null = null;

export const focusPlant = (id: string) => void (pending = { at: "plant", id });

/** Where to open, once. */
export function takeFocus(): Focus | null {
  const f = pending;
  pending = null;
  return f;
}
