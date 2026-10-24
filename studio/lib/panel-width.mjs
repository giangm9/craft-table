// Width of the right-hand panel (Conversation / History) when its left edge is dragged.
export const PANEL_DEFAULT = 360;
export const PANEL_MIN = 300;
const PANEL_MAX_SHARE = 0.6; // never more than 60% of the screen — the board must keep some room

/** Clamp the width to [minimum, 60% of the screen]; a broken value → the default. */
export function clampPanelWidth(w, viewport) {
  const max = Math.max(PANEL_MIN, Math.round(viewport * PANEL_MAX_SHARE));
  const n = Number(w);
  const v = w == null || !Number.isFinite(n) ? PANEL_DEFAULT : Math.round(n);
  return Math.min(max, Math.max(PANEL_MIN, v));
}

/** The panel sits on the right: dragging its left edge to the left (x decreasing) widens it. */
export function dragPanelWidth(startW, startX, x, viewport) {
  return clampPanelWidth(startW + (startX - x), viewport);
}
