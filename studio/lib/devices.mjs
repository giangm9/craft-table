// Device sizes for MOBILE frames on the board: a mobile frame fits one phone instead of running on forever, with a
// control to switch phone models. Long content scrolls INSIDE the frame.
// Default iPhone 14 (390 wide) — matches the coordinates of older marks (recorded at a width of 390).
// "Whole page": the frame is as tall as its content (see it all at once), capped at FULL_MAX_H. Pure file (shared
// with the UI).
// Ids are neutral URL values (dev=…); old bookmarks (dev=ca-trang, dev=android-nho) are read through
// lib/legacy-values.mjs. `name` is the English fallback: the studio shows names from studio/src/i18n/values.ts.
import { urlValue } from "./legacy-values.mjs";

export const DEVICES = [
  { id: "iphone-se", name: "iPhone SE", w: 375, h: 667 },
  { id: "iphone-14", name: "iPhone 14", w: 390, h: 844 },
  { id: "iphone-15-pro-max", name: "iPhone 15 Pro Max", w: 430, h: 932 },
  { id: "galaxy-s23", name: "Galaxy S23", w: 360, h: 780 },
  { id: "pixel-8", name: "Pixel 8", w: 412, h: 915 },
  { id: "android-small", name: "Small Android", w: 360, h: 640 },
];
export const DEFAULT_DEVICE = "iphone-14";
/** The "whole page" choice of the phone select: frames as tall as their content. */
export const FULL_DEVICE = "full";
const FULL = { id: FULL_DEVICE, name: "Whole page", w: 390, h: null };

export function deviceOf(id0) {
  const id = urlValue("dev", id0);
  if (id === FULL.id) return { ...FULL };
  const d = DEVICES.find((x) => x.id === id) ?? DEVICES.find((x) => x.id === DEFAULT_DEVICE);
  return { ...d };
}

// DESKTOP frames are fixed too (a screen using "as tall as the screen" would make a frame that grows with its content
// without end) — 1280×800, the same size as the frame shots Claude looks at (shots.mjs). "Whole
// page" (picked in the device select) → both are as tall as their content.
export const DESKTOP = { w: 1280, h: 800 };
/** Height cap for "Whole page" — stops the ever-growing measure loop of screens using 100vh/min-h-screen. */
export const FULL_MAX_H = 6000;

/** Frame size on the board: h = null → as tall as the content (measured in the frame, clamped by fullHeight). */
export function frameSize(viewport, deviceId) {
  if (viewport === "desktop") return { w: DESKTOP.w, h: urlValue("dev", deviceId) === FULL.id ? null : DESKTOP.h };
  const d = deviceOf(deviceId);
  return { w: d.w, h: d.h };
}

/** Measured height of a "Whole page" frame: ≥ max(120, the screen's minHeight), ≤ FULL_MAX_H. */
export function fullHeight(measured, minH) {
  const v = Number.isFinite(measured) ? Math.ceil(measured) : 0;
  return Math.min(FULL_MAX_H, Math.max(minH || 0, 120, v));
}
