// Geometry of marks on a design frame. Pure — no DOM, so node --test can test it. Convention: "view" = px on the
// studio screen (the scaled-down frame), "doc" = real px in the frame's document (the iframe is as tall as its
// content and does not scroll on its own → doc coordinates are stable, and Puppeteer crops the right region with
// these very numbers).

/** Two corners of a mouse drag in any direction → {x,y} top-left corner, positive w,h. */
export function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** A region on the scaled-down frame (scale) → real px in the document, rounded. */
export function toDocRect(r, scale) {
  return {
    x: Math.round(r.x / scale),
    y: Math.round(r.y / scale),
    w: Math.round(r.w / scale),
    h: Math.round(r.h / scale),
  };
}

/** The reverse: real px → where to draw on the scaled-down frame. */
export function toViewRect(r, scale) {
  return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
}

/** A region smaller than `min` px (doc) counts as a misclick: no comment box opens. */
export function isUsableRect(r, min = 8) {
  return r.w >= min && r.h >= min;
}

/**
 * Text of the elements inside the region — sent with the note so Claude knows what the person is pointing at
 * without guessing from coordinates.
 * items: [{text, x, y, w, h}] (doc px). Takes the items whose CENTRE is inside the region.
 */
export function textsInRect(items, rect, { limit = 20, maxLen = 80 } = {}) {
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const t = String(it.text ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    if (cx < rect.x || cx > rect.x + rect.w || cy < rect.y || cy > rect.y + rect.h) continue;
    const s = t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A mark drawn on the board layer: `sel` and the frames are all in screen px (relative to the board).
 * Picks the frame that overlaps the mark most, clips the region to the frame's edges, and converts it to the
 * frame's document px: (screen − frame corner) / zoom. No frame overlapped → null.
 */
export function pickTarget(sel, frames, zoom) {
  let best = null;
  for (const f of frames) {
    const x1 = Math.max(sel.x, f.x), y1 = Math.max(sel.y, f.y);
    const x2 = Math.min(sel.x + sel.w, f.x + f.w), y2 = Math.min(sel.y + sel.h, f.y + f.h);
    const area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (area > 0 && (!best || area > best.area)) best = { f, area, x1, y1, x2, y2 };
  }
  if (!best) return null;
  const { f, x1, y1, x2, y2 } = best;
  return {
    key: f.key,
    rect: {
      x: Math.round((x1 - f.x) / zoom),
      y: Math.round((y1 - f.y) / zoom),
      w: Math.round((x2 - x1) / zoom),
      h: Math.round((y2 - y1) / zoom),
    },
  };
}
