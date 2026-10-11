// "View in garden": the 2D garden asks the 3D walk to open on one plant.
let pending: string | null = null;

export const focusPlant = (id: string) => void (pending = id);

/** The plant to open on, once. */
export function takeFocus(): string | null {
  const id = pending;
  pending = null;
  return id;
}
