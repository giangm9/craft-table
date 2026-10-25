// The conversation panel as a FLOATING window (src/FloatingPanel.tsx): its place and size, kept inside the browser window.
// Pure: every function takes the window size (vw × vh) and gives back a rectangle { x, y, w, h } in pixels.
export const FLOAT_MIN = { w: 320, h: 360 };
const MARGIN = 16;

/** Never smaller than FLOAT_MIN (unless the window is), never larger than the window, never outside it. */
export function clampFloatRect(r, vw, vh) {
  const w = Math.min(Math.max(Math.round(r.w), FLOAT_MIN.w), Math.max(vw, FLOAT_MIN.w));
  const h = Math.min(Math.max(Math.round(r.h), FLOAT_MIN.h), Math.max(vh, FLOAT_MIN.h));
  return {
    x: Math.min(Math.max(Math.round(r.x), 0), Math.max(vw - w, 0)),
    y: Math.min(Math.max(Math.round(r.y), 0), Math.max(vh - h, 0)),
    w,
    h,
  };
}

/** First place: bottom right, a margin from the edges. */
export function defaultFloatRect(vw, vh) {
  const w = Math.min(380, vw - 2 * MARGIN);
  const h = Math.max(FLOAT_MIN.h, Math.min(620, vh - 80));
  return clampFloatRect({ x: vw - w - MARGIN, y: vh - h - MARGIN, w, h }, vw, vh);
}

/** Dragging the title bar by (dx, dy) from `r`. */
export const dragFloatRect = (r, dx, dy, vw, vh) => clampFloatRect({ ...r, x: r.x + dx, y: r.y + dy }, vw, vh);

/** Dragging the bottom right corner by (dx, dy): the top left stays. */
export function resizeFloatRect(r, dx, dy, vw, vh) {
  const w = Math.min(Math.max(r.w + dx, FLOAT_MIN.w), Math.max(vw - r.x, FLOAT_MIN.w));
  const h = Math.min(Math.max(r.h + dy, FLOAT_MIN.h), Math.max(vh - r.y, FLOAT_MIN.h));
  return clampFloatRect({ x: r.x, y: r.y, w, h }, vw, vh);
}
