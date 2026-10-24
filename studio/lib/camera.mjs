// Camera of the infinite board. {x, y, z}: world point (wx, wy) shows on screen at (x + wx*z, y + wy*z) — i.e. CSS
// `translate(x,y) scale(z)` with origin 0 0.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;
export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Screen coordinates (inside the canvas) → world coordinates. */
export const toWorld = (cam, p) => ({ x: (p.x - cam.x) / cam.z, y: (p.y - cam.y) / cam.z });

/** Zoom by `factor` around screen point p — the point under the cursor stays still. */
export function zoomAt(cam, p, factor) {
  const z = clampZoom(cam.z * factor);
  if (z === cam.z) return cam;
  const w = toWorld(cam, p);
  return { x: p.x - w.x * z, y: p.y - w.y * z, z };
}

/** Fit the content's width (with margins), never above 100%, centred horizontally, stuck to the top edge. */
export function fitCamera(content, view, pad = 40) {
  const z = clampZoom(Math.min(1, (view.w - pad * 2) / content.w));
  return { x: Math.max(pad, (view.w - content.w * z) / 2), y: pad, z };
}
