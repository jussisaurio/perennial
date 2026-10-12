import { SproutMark } from "./icons";

/** Between screens (session check, opening the device store, first sync): the page
 *  background, and a small sprout only if it takes a moment (see .settling). */
export function Settling() {
  return (
    <div className="settling" role="status" aria-label="Loading">
      <SproutMark size={28} />
    </div>
  );
}
