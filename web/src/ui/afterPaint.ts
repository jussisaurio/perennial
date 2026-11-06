/**
 * Runs `fn` in its own task once the next frame is painted. For work that
 * need not be in that frame: done in the input's task, it makes the frame
 * late (#457). Returns a function that cancels it.
 */
export function afterPaint(fn: () => void): () => void {
  let timer = 0;
  // A timeout queued from the frame's callback runs after that frame is painted.
  const frame = requestAnimationFrame(() => (timer = window.setTimeout(fn)));
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
