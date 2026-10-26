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

// Width of the board list on the left (the sidebar) when its right edge is dragged.
export const SIDEBAR_DEFAULT = 224;
export const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
const SIDEBAR_MAX_SHARE = 0.4; // the list never takes more than 40% of the screen

/** Clamp the width to [minimum, min(520 px, 40% of the screen)]; a broken value → the default. */
export function clampSidebarWidth(w, viewport) {
  const max = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(viewport * SIDEBAR_MAX_SHARE)));
  const n = Number(w);
  const v = w == null || !Number.isFinite(n) ? SIDEBAR_DEFAULT : Math.round(n);
  return Math.min(max, Math.max(SIDEBAR_MIN, v));
}

/** The list sits on the left: dragging its right edge to the right (x increasing) widens it. */
export function dragSidebarWidth(startW, startX, x, viewport) {
  return clampSidebarWidth(startW + (x - startX), viewport);
}
